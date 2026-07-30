import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { ApiError } from "@/core/errors";
import { ensureRerunReconciliation } from "@/lib/api/v1/rerun-lifecycle-store";
import {
  cancelExecutionTransaction,
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
      const dispatchOutput = {
        ...requiredOutput,
        bindingId: "binding-dispatch",
        workItemId: "dispatch-success-work",
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
          workItemId: "dispatch-success-work",
          owner: "visuals",
          kind: "revise_visuals",
          targets: [target],
          requiredOutputs: [dispatchOutput],
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
      const dispatchActionId = randomUUID();
      await reserveWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "dispatch-success-work",
        requestFingerprint: "dispatch-success-work",
        dispatchActionId,
        dispatchParams: {},
        callbackFences: [],
      });
      const dispatchBudgetKey = "dispatch-success-budget";
      await reserveChildBudgetTransaction({
        projectId,
        executionReservationId: negative.reservation.reservation_id,
        workItemId: "dispatch-success-work",
        actionId: dispatchActionId,
        reservationKey: dispatchBudgetKey,
        estimatedUsd: 0,
      });
      const dispatchAssetId = randomUUID();
      await admin.query(
        `insert into public.assets(
           id,workspace_id,project_id,kind,media,role,filename,source
         ) values ($1,$2,$3,'image','image','revised-shot','dispatch.png','{}')`,
        [dispatchAssetId, workspaceId, projectId]
      );
      await admin.query(
        `insert into public.action_assets(
           project_id,action_id,asset_id,direction,role,ordinal
         ) values ($1,$2,$3,'output','revised-shot',0)`,
        [projectId, dispatchActionId, dispatchAssetId]
      );
      await admin.query(
        `update public.actions
            set status='applied',output_asset_ids=array[$2]::uuid[]
          where id=$1`,
        [dispatchActionId, dispatchAssetId]
      );
      const prematurelyFinalized = await admin.query<{ status: string }>(
        "select status from public.actions where id=$1",
        [dispatchActionId]
      );
      assert.equal(prematurelyFinalized.rows[0]?.status, "running");
      await admin.query(
        `select * from public.settle_orchestrator_run_budget($1,$2,0,null,0)`,
        [projectId, dispatchBudgetKey]
      );
      const dispatchBinding = {
        ...dispatchOutput,
        intrinsicRole: "revised-shot",
        assetId: dispatchAssetId,
      };
      await parkWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "dispatch-success-work",
        primitiveActionIds: [dispatchActionId],
        budgetReservationKeys: [dispatchBudgetKey],
        bindingResults: [dispatchBinding],
      });
      await completeWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "dispatch-success-work",
        bindingResults: [dispatchBinding],
        primitiveActionIds: [dispatchActionId],
        budgetReservationKeys: [dispatchBudgetKey],
      });
      const completedDispatch = await admin.query<{
        status: string;
        output_asset_ids: string[];
      }>(
        "select status,output_asset_ids from public.actions where id=$1",
        [dispatchActionId]
      );
      assert.equal(completedDispatch.rows[0]?.status, "applied");
      assert.deepEqual(completedDispatch.rows[0]?.output_asset_ids, [dispatchAssetId]);
      context.diagnostic(
        "running dispatch action became applied inside fenced work completion"
      );
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

      const positiveOutput = {
        bindingId: "binding-positive",
        workItemId: "positive-work",
        target,
        kind: "image",
        role: "revised-shot",
        ordinal: 0,
      };
      const positiveProposalId = await insertProposal(admin, projectId, [{
        workItemId: "positive-work",
        owner: "visuals",
        kind: "revise_visuals",
        targets: [target],
        requiredOutputs: [positiveOutput],
      }]);
      const positive = await approveAndClaim(
        projectId, positiveProposalId, "positive-causation"
      );
      const positiveDispatchId = randomUUID();
      const positiveTokenHash = createHash("sha256")
        .update("positive-callback-token").digest("hex");
      await reserveWorkTransaction({
        projectId,
        lease: positive.lease,
        workItemId: "positive-work",
        requestFingerprint: "positive-work",
        dispatchActionId: positiveDispatchId,
        dispatchParams: {},
        callbackFences: [{
          executorId: "positive-visuals",
          tokenHash: positiveTokenHash,
          generation: 1,
          requiredOutputs: [positiveOutput],
        }],
      });
      const childRunId = randomUUID();
      const taskParams = {
        schemaVersion: "DomainTask.v1",
        domain: "visuals",
        taskKind: "visuals_revision",
        objective: "Prove rerun child visibility.",
        instruction: "Produce the required image.",
        targets: [target],
        requiredOutputs: [positiveOutput],
        allowedOutputKinds: ["image"],
        creativeConstraints: {},
        preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
        candidateAffectedAssetIds: [],
        budgetUsd: 0,
        approvalContext: {
          proposalActionId: positiveProposalId,
          approvalActionId: positive.executionRequest.approvalActionId,
          executionReservationId: positive.reservation.reservation_id,
          approvedBudgetUsd: 0,
          approvalFingerprint: positive.executionRequest.approvalFingerprint,
        },
        acceptanceCriteria: [],
        origin: {
          kind: "creative_director",
          rootRunId: positive.reservation.root_run_id,
          rootActionId: positiveDispatchId,
          creatorMessageId: "direct-integration",
        },
        responseRecipient: { kind: "creative_director" },
      };
      await admin.query(
        `select * from public.create_domain_run_dispatch(
          p_idempotency_scope => $1, p_idempotency_key => $2,
          p_request_hash => $3, p_run_id => $4, p_project_id => $5,
          p_domain => 'visuals', p_input_summary => $6, p_budget_usd => 0,
          p_task_kind => 'visuals_revision', p_task_params => $7::jsonb,
          p_origin_kind => 'creative_director', p_parent_run_id => $8,
          p_root_action_id => $9, p_origin_actor_id => null,
          p_origin_request => null, p_continues_run_id => null,
          p_pins => null, p_gate_stage => null, p_enqueue => false,
          p_max_children_per_root => 20, p_max_continuation_chain => 10,
          p_max_session_turns => 20,
          p_max_blocked_reports_per_requirement => 3
        )`,
        [
          `rerun-direct:${positive.reservation.reservation_id}`,
          "positive-child", "positive-child-hash", childRunId, projectId,
          "Positive rerun child visibility", JSON.stringify(taskParams),
          positive.reservation.root_run_id, positiveDispatchId,
        ]
      );
      const assetId = randomUUID();
      const primitiveActionId = randomUUID();
      await admin.query(
        `insert into public.assets(
           id,workspace_id,project_id,kind,media,role,filename,source
         ) values ($1,$2,$3,'image','image',$4,'positive.png','{}')`,
        [assetId, workspaceId, projectId, positiveOutput.role]
      );
      await admin.query(
        `insert into public.actions(
           id,schema_version,project_id,orchestrator_run_id,tool,status,params,
           input_asset_ids,output_asset_ids,job_ids
         ) values ($1,'action.v1',$2,$3,'generate_image','running',
           '{"schema_version":"action_params.v1"}'::jsonb,'{}',$4::uuid[],'{}')`,
        [primitiveActionId, projectId, childRunId, [assetId]]
      );
      await admin.query(
        `insert into public.action_assets(
           project_id,action_id,asset_id,direction,role,ordinal
         ) values ($1,$2,$3,'output',$4,0)`,
        [projectId, primitiveActionId, assetId, positiveOutput.role]
      );
      const budgetKey = `positive-budget:${positiveProposalId}`;
      await reserveChildBudgetTransaction({
        projectId,
        executionReservationId: positive.reservation.reservation_id,
        workItemId: "positive-work",
        childRunId,
        actionId: primitiveActionId,
        reservationKey: budgetKey,
        estimatedUsd: 0,
      });
      await admin.query(
        "select * from public.settle_orchestrator_run_budget($1,$2,0,null,0)",
        [projectId, budgetKey]
      );
      const binding = {
        ...positiveOutput,
        assetId,
        intrinsicRole: positiveOutput.role,
      };
      const reportActionId = randomUUID();
      await admin.query(
        "update public.actions set status='applied' where id=$1",
        [primitiveActionId]
      );
      await admin.query(
        `update public.orchestrator_runs
            set status='succeeded',started_at=now(),completed_at=now()
          where id=$1`,
        [childRunId]
      );
      await admin.query(
        `insert into public.actions(
           id,schema_version,project_id,orchestrator_run_id,tool,status,params,
           input_asset_ids,output_asset_ids,job_ids
         ) values ($1,'action.v1',$2,$3,'domain_report','applied',$4::jsonb,
           '{}',$5::uuid[],'{}')`,
        [
          reportActionId, projectId, childRunId,
          JSON.stringify({
            schemaVersion: "DomainReport.v1",
            outcome: { outputs: [binding] },
          }),
          [assetId],
        ]
      );
      await parkWorkTransaction({
        projectId,
        lease: positive.lease,
        workItemId: "positive-work",
        completedCallbacks: [{
          executorId: "positive-visuals",
          tokenHash: positiveTokenHash,
          generation: 1,
          result: {
            outputs: [binding],
            childRunId,
            reportActionId,
            primitiveActionIds: [primitiveActionId],
            budgetReservationKeys: [budgetKey],
          },
        }],
        primitiveActionIds: [primitiveActionId],
        budgetReservationKeys: [budgetKey],
        bindingResults: [binding],
      });
      await completeWorkTransaction({
        projectId,
        lease: positive.lease,
        workItemId: "positive-work",
        bindingResults: [binding],
        primitiveActionIds: [primitiveActionId],
        budgetReservationKeys: [budgetKey],
      });
      context.diagnostic(
        "causally bound specialist child and primitive were readable by popcorn_api"
      );

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
      const lateCancellation = await cancelExecutionTransaction({
        projectId,
        proposalActionId: successProposalId,
        executionActionId: randomUUID(),
        reason: "creator canceled after success",
      });
      assert.deepEqual(lateCancellation, {
        executionActionId,
        status: "applied",
        canceled: false,
      });
      context.diagnostic("late cancellation preserved the successful outcome");
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
