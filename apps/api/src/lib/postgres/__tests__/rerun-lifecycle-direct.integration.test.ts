import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { ApiError } from "@/core/errors";
import { ensureRerunReconciliation } from "@/lib/api/v1/rerun-lifecycle-store";
import {
  claimExecutionTransaction,
  finalizeExecutionTransaction,
  recoverExecutionTransaction,
  reserveExecutionTransaction,
} from "../rerun-execution-transactions.js";
import { approveRerunProposalTransaction } from "../rerun-proposal-transactions.js";
import { closePostgresPool } from "../transactions.js";
import {
  completeWorkTransaction,
  failWorkTransaction,
  parkWorkTransaction,
  recordCallbackTransaction,
  reserveChildBudgetTransaction,
  reserveWorkTransaction,
} from "../rerun-work-transactions.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(databaseUrl);
const integrationTest = runLocalIntegration ? test : test.skip;

function proposal(
  projectId: string,
  selectedWork: unknown[] = []
) {
  return {
    schema_version: "action_proposal.v1",
    schemaVersion: "RerunProposal.v2",
    projectId,
    rootRunId: null,
    source: "request_changes",
    userIntent: "Direct lifecycle integration.",
    targets: [{ kind: "project", projectId }],
    inspectedAssetIds: [],
    candidateAffectedAssetIds: [],
    preservedAssetIds: [],
    checklist: [],
    pins: { assets: [], selections: [], storySnapshots: [] },
    estimate: { costUsd: 0, maxCostUsd: 0, latencyClass: "interactive" },
    risk: "low",
    requiresApproval: true,
    rationale: "Direct lifecycle integration.",
    userFacingSummary: "Direct lifecycle integration.",
    outcome: "revision",
    selectedWork,
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
  };
}

async function insertProposal(
  admin: Pool,
  projectId: string,
  selectedWork: unknown[] = []
): Promise<string> {
  const actionId = randomUUID();
  await admin.query(
    `insert into public.actions (
       id,schema_version,project_id,tool,status,params,proposal,
       input_asset_ids,output_asset_ids,job_ids
     ) values ($1,'action.v1',$2,'rerun_proposal','proposed',
       '{"schema_version":"action_params.v1"}'::jsonb,$3::jsonb,'{}','{}','{}')`,
    [actionId, projectId, JSON.stringify(proposal(projectId, selectedWork))]
  );
  return actionId;
}

async function approveAndClaim(
  projectId: string,
  proposalActionId: string,
  suffix: string
) {
  const approvalActionId = randomUUID();
  const approvalFingerprint = `approval:${suffix}`;
  const approval = await approveRerunProposalTransaction({
    projectId,
    proposalActionId,
    approvalActionId,
    actorId: "direct-integration",
    approvedMaxCostUsd: 0,
    approvalFingerprint,
    autonomous: false,
  });
  assert.equal(approval.proposal_status, "approved");
  const executionRequest = {
    projectId,
    proposalActionId,
    approvalActionId,
    idempotencyKey: `direct:${suffix}`,
    requestFingerprint: `request:${suffix}`,
    approvedMaxCostUsd: 0,
    approvalFingerprint,
  };
  const reservation = await reserveExecutionTransaction(executionRequest);
  const lease = await claimExecutionTransaction({
    projectId,
    reservationId: reservation.reservation_id,
  });
  assert.ok(lease);
  return { reservation, lease, executionRequest };
}

integrationTest(
  "popcorn_api rejects expired terminal fences, recovers with a fresh fence, and requires durable reconciliation",
  { concurrency: false, timeout: 60_000 },
  async (context) => {
    const admin = new Pool({ connectionString: databaseUrl, max: 2 });
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const roleUrl = new URL(databaseUrl);
    roleUrl.searchParams.set(
      "options",
      "-c role=popcorn_api -c statement_timeout=5000 -c lock_timeout=3000"
    );
    const originalUrl = process.env.DATABASE_URL;
    try {
      // Local Supabase's postgres role is deliberately non-superuser. Grant
      // test-only membership so the connection startup option can exercise
      // the exact production current_user without changing popcorn_api's
      // LOGIN/NOBYPASSRLS attributes.
      await admin.query("grant popcorn_api to postgres");
      process.env.DATABASE_URL = roleUrl.toString();
      context.diagnostic("configured popcorn_api transaction connection");
      await admin.query(
        "insert into public.workspaces(id,name) values ($1,$2)",
        [workspaceId, `Rerun direct ${workspaceId}`]
      );
      await admin.query(
        `insert into public.projects(id,workspace_id,name,visibility)
         values ($1,$2,$3,'private')`,
        [projectId, workspaceId, `Rerun direct ${projectId}`]
      );
      context.diagnostic("created workspace and project fixture");

      const expiredProposalId = await insertProposal(admin, projectId);
      const expired = await approveAndClaim(
        projectId, expiredProposalId, "expired"
      );
      context.diagnostic("approved and claimed expired-fence fixture");
      await admin.query(
        `update public.rerun_execution_reservations
            set lease_expires_at=now()-interval '1 second'
          where id=$1`,
        [expired.reservation.reservation_id]
      );
      await assert.rejects(
        finalizeExecutionTransaction({
          projectId,
          lease: expired.lease,
          executionActionId: randomUUID(),
          outcome: "failed",
          error: { kind: "expired_worker" },
        }),
        (error: unknown) =>
          error instanceof ApiError && error.code === "idempotency_in_progress"
      );
      const recoveryActionId = randomUUID();
      assert.equal(
        await recoverExecutionTransaction({
          projectId,
          reservationId: expired.reservation.reservation_id,
          executionActionId: recoveryActionId,
          reason: "expired_worker",
        }),
        recoveryActionId
      );
      const recovered = await admin.query<{
        lease_generation: number;
        execution_result_action_id: string;
        status: string;
      }>(
        `select lease_generation,execution_result_action_id,status
           from public.rerun_execution_reservations where id=$1`,
        [expired.reservation.reservation_id]
      );
      assert.equal(
        recovered.rows[0]?.lease_generation,
        expired.lease.leaseGeneration + 1
      );
      assert.equal(recovered.rows[0]?.execution_result_action_id, recoveryActionId);
      assert.equal(recovered.rows[0]?.status, "failed");
      context.diagnostic("expired fence rejected and recovery finalized");

      const target = { kind: "project", projectId };
      const requiredOutput = {
        bindingId: "binding-negative",
        workItemId: "negative-work",
        target,
        kind: "image",
        role: "revised-shot",
        ordinal: 0,
      };
      const callbackOutput = {
        ...requiredOutput,
        bindingId: "binding-callback",
        workItemId: "callback-work",
      };
      const negativeProposalId = await insertProposal(admin, projectId, [
        {
          workItemId: "negative-work",
          owner: "visuals",
          kind: "revise_visuals",
          targets: [target],
          requiredOutputs: [requiredOutput],
        },
        {
          workItemId: "callback-work",
          owner: "visuals",
          kind: "revise_visuals",
          targets: [target],
          requiredOutputs: [callbackOutput],
        },
        {
          workItemId: "expired-callback-work",
          owner: "visuals",
          kind: "revise_visuals",
          targets: [target],
          requiredOutputs: [],
        },
        {
          workItemId: "park-replay-work",
          owner: "visuals",
          kind: "revise_visuals",
          targets: [target],
          requiredOutputs: [],
        },
      ]);
      const negative = await approveAndClaim(
        projectId, negativeProposalId, "negative"
      );
      context.diagnostic("approved and claimed negative-causation fixture");
      const negativeDispatchId = randomUUID();
      await reserveWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "negative-work",
        requestFingerprint: "negative-work",
        dispatchActionId: negativeDispatchId,
        dispatchParams: {},
        callbackFences: [],
      });
      await assert.rejects(
        reserveChildBudgetTransaction({
          projectId,
          executionReservationId: negative.reservation.reservation_id,
          workItemId: "negative-work",
          actionId: randomUUID(),
          reservationKey: "forged-child-budget",
          estimatedUsd: 0,
        }),
        (error: unknown) =>
          error instanceof ApiError && error.code === "validation_failed"
      );
      context.diagnostic("forged child budget and output causation rejected");
      const wrongRoleAssetId = randomUUID();
      await admin.query(
        `insert into public.assets(
           id,workspace_id,project_id,kind,media,role,filename,source
         ) values ($1,$2,$3,'image','image','wrong-role','wrong.png','{}')`,
        [wrongRoleAssetId, workspaceId, projectId]
      );
      await assert.rejects(
        completeWorkTransaction({
          projectId,
          lease: negative.lease,
          workItemId: "negative-work",
          bindingResults: [{
            ...requiredOutput,
            intrinsicRole: "revised-shot",
            assetId: wrongRoleAssetId,
          }],
          primitiveActionIds: [],
          budgetReservationKeys: [],
        }),
        (error: unknown) =>
          error instanceof ApiError && error.code === "validation_failed"
      );
      await failWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "negative-work",
        error: { kind: "failed", details: { alpha: 1, beta: 2 } },
      });
      await failWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "negative-work",
        error: { details: { beta: 2, alpha: 1 }, kind: "failed" },
      });
      await assert.rejects(
        failWorkTransaction({
          projectId,
          lease: negative.lease,
          workItemId: "negative-work",
          error: { kind: "different" },
        }),
        (error: unknown) =>
          error instanceof ApiError && error.code === "idempotency_conflict"
      );
      context.diagnostic("forged output and failure replay mismatch rejected");

      const callbackToken = "callback-token";
      await reserveWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "callback-work",
        requestFingerprint: "callback-work",
        dispatchActionId: randomUUID(),
        dispatchParams: {},
        callbackFences: [{
          executorId: "fake",
          tokenHash: createHash("sha256").update(callbackToken).digest("hex"),
          generation: 1,
          requiredOutputs: [callbackOutput],
        }],
      });
      const callbackRequest = {
        projectId,
        reservationId: negative.reservation.reservation_id,
        workItemId: "callback-work",
        executorId: "fake",
        callbackToken,
        callbackGeneration: 1,
        outcome: "failed" as const,
        result: { providerResult: { alpha: 1, beta: 2 } },
      };
      assert.equal(await recordCallbackTransaction(callbackRequest), false);
      assert.equal(await recordCallbackTransaction({
        ...callbackRequest,
        result: { providerResult: { beta: 2, alpha: 1 } },
      }), true);
      await assert.rejects(
        recordCallbackTransaction({
          ...callbackRequest,
          result: { providerResult: { reason: "different" } },
        }),
        (error: unknown) =>
          error instanceof ApiError && error.code === "idempotency_conflict"
      );
      context.diagnostic("canonical callback replay and mismatch are fenced");

      const expiredCallbackToken = "expired-callback-token";
      const expiredCallbackWork = await reserveWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "expired-callback-work",
        requestFingerprint: "expired-callback-work",
        dispatchActionId: randomUUID(),
        dispatchParams: {},
        callbackFences: [{
          executorId: "expired",
          tokenHash: createHash("sha256")
            .update(expiredCallbackToken).digest("hex"),
          generation: 1,
          requiredOutputs: [],
        }],
      });
      await admin.query(
        `update public.rerun_execution_callbacks
            set expires_at=now()-interval '1 second'
          where work_reservation_id=$1`,
        [expiredCallbackWork.work_reservation_id]
      );
      await assert.rejects(
        recordCallbackTransaction({
          projectId,
          reservationId: negative.reservation.reservation_id,
          workItemId: "expired-callback-work",
          executorId: "expired",
          callbackToken: expiredCallbackToken,
          callbackGeneration: 1,
          outcome: "failed",
          result: { providerResult: { reason: "late" } },
        }),
        (error: unknown) =>
          error instanceof ApiError && error.code === "idempotency_in_progress"
      );

      const parkToken = "park-replay-token";
      const parkTokenHash = createHash("sha256").update(parkToken).digest("hex");
      await reserveWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "park-replay-work",
        requestFingerprint: "park-replay-work",
        dispatchActionId: randomUUID(),
        dispatchParams: {},
        callbackFences: [{
          executorId: "park",
          tokenHash: parkTokenHash,
          generation: 1,
          requiredOutputs: [],
        }],
      });
      const parkResult = {
        providerResult: { alpha: 1, beta: 2 },
        outputs: [],
        primitiveActionIds: [],
        budgetReservationKeys: [],
      };
      await recordCallbackTransaction({
        projectId,
        reservationId: negative.reservation.reservation_id,
        workItemId: "park-replay-work",
        executorId: "park",
        callbackToken: parkToken,
        callbackGeneration: 1,
        outcome: "completed",
        result: parkResult,
      });
      await assert.rejects(
        parkWorkTransaction({
          projectId,
          lease: negative.lease,
          workItemId: "park-replay-work",
          completedCallbacks: [{
            executorId: "park",
            tokenHash: parkTokenHash,
            generation: 1,
            result: {
              ...parkResult,
              providerResult: { alpha: 999 },
            },
          }],
          primitiveActionIds: [],
          budgetReservationKeys: [],
          bindingResults: [],
        }),
        (error: unknown) =>
          error instanceof ApiError && error.code === "idempotency_conflict"
      );
      context.diagnostic("DB-clock expiry and park replay mismatch rejected");

      const successProposalId = await insertProposal(admin, projectId);
      const success = await approveAndClaim(
        projectId, successProposalId, "success"
      );
      context.diagnostic("approved and claimed success fixture");
      const executionActionId = randomUUID();
      await assert.rejects(
        finalizeExecutionTransaction({
          projectId,
          lease: success.lease,
          executionActionId,
          outcome: "applied",
        }),
        (error: unknown) =>
          error instanceof ApiError && error.code === "validation_failed"
      );
      const reconciliationActionId = randomUUID();
      assert.equal(
        await ensureRerunReconciliation({
          projectId,
          proposalActionId: successProposalId,
          rootRunId: success.reservation.root_run_id,
          lease: success.lease,
          reconciliationActionId,
        }),
        reconciliationActionId
      );
      const [replay, finalized] = await Promise.all([
        reserveExecutionTransaction(success.executionRequest),
        finalizeExecutionTransaction({
          projectId,
          lease: success.lease,
          executionActionId,
          outcome: "applied",
          reconciliationActionId,
        }),
      ]);
      assert.equal(replay.reservation_id, success.reservation.reservation_id);
      assert.equal(replay.replayed, true);
      assert.equal(finalized, executionActionId);
      context.diagnostic("concurrent replay and finalization completed");
      const terminal = await admin.query<{
        status: string;
        reconciliation_action_id: string | null;
      }>(
        `select status,params->>'reconciliationActionId' as reconciliation_action_id
           from public.actions where id=$1`,
        [executionActionId]
      );
      assert.equal(terminal.rows[0]?.status, "applied");
      assert.equal(
        terminal.rows[0]?.reconciliation_action_id,
        reconciliationActionId
      );
    } finally {
      await closePostgresPool();
      process.env.DATABASE_URL = originalUrl;
      await admin.query(
        "revoke popcorn_api from postgres"
      ).catch(() => undefined);
      await admin.query(
        "delete from public.workspaces where id=$1",
        [workspaceId]
      ).catch(() => undefined);
      await admin.end();
    }
  }
);
