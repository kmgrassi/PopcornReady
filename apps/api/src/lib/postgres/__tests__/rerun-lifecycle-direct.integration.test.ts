import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { ApiError } from "@/core/errors";
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
  selectedWork: unknown[] = [],
  proposalOverride?: Record<string, unknown>
): Promise<string> {
  const actionId = randomUUID();
  await admin.query(
    `insert into public.actions (
       id,schema_version,project_id,tool,status,params,proposal,
       input_asset_ids,output_asset_ids,job_ids
     ) values ($1,'action.v1',$2,'rerun_proposal','proposed',
       '{"schema_version":"action_params.v1"}'::jsonb,$3::jsonb,'{}','{}','{}')`,
    [
      actionId,
      projectId,
      JSON.stringify(proposalOverride ?? proposal(projectId, selectedWork)),
    ]
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
      assert.deepEqual(
        await cancelExecutionTransaction({
          projectId,
          proposalActionId: expiredProposalId,
          executionActionId: randomUUID(),
          reason: "late creator cancellation",
        }),
        {
          executionActionId: recoveryActionId,
          status: "failed",
          canceled: false,
        }
      );
      context.diagnostic("expired fence rejected and recovery finalized");

      const canceledProposalId = await insertProposal(admin, projectId);
      const canceled = await approveAndClaim(
        projectId,
        canceledProposalId,
        "creator-canceled"
      );
      const canceledActionId = randomUUID();
      assert.deepEqual(
        await cancelExecutionTransaction({
          projectId,
          proposalActionId: canceledProposalId,
          executionActionId: canceledActionId,
          reason: "creator_canceled",
        }),
        {
          executionActionId: canceledActionId,
          status: "canceled",
          canceled: true,
        }
      );
      const canceledState = await admin.query<{
        reservation_status: string;
        proposal_status: string;
        execution_error_kind: string;
        budget_status: string;
        root_status: string;
      }>(
        `select reservation.status as reservation_status,
                proposal.status as proposal_status,
                execution.error->>'kind' as execution_error_kind,
                budget.status as budget_status,
                root.status as root_status
           from public.rerun_execution_reservations reservation
           join public.actions proposal
             on proposal.id=reservation.proposal_action_id
           join public.actions execution
             on execution.id=reservation.execution_result_action_id
           join public.orchestrator_budget_reservations budget
             on budget.id=reservation.budget_reservation_id
           join public.orchestrator_runs root
             on root.id=reservation.root_run_id
          where reservation.id=$1`,
        [canceled.reservation.reservation_id]
      );
      assert.deepEqual(canceledState.rows[0], {
        reservation_status: "canceled",
        proposal_status: "failed",
        execution_error_kind: "execution_canceled",
        budget_status: "released",
        root_status: "canceled",
      });
      context.diagnostic("creator cancellation persisted distinct terminal state");

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
      const dispatchCallbackTokenHash = createHash("sha256")
        .update("dispatch-success-token")
        .digest("hex");
      await reserveWorkTransaction({
        projectId,
        lease: negative.lease,
        workItemId: "dispatch-success-work",
        requestFingerprint: "dispatch-success-work",
        dispatchActionId,
        dispatchParams: {},
        callbackFences: [{
          executorId: "dispatch-success",
          tokenHash: dispatchCallbackTokenHash,
          generation: 1,
          requiredOutputs: [dispatchOutput],
        }],
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
        completedCallbacks: [{
          executorId: "dispatch-success",
          tokenHash: dispatchCallbackTokenHash,
          generation: 1,
          result: {
            outputs: [dispatchBinding],
            primitiveActionIds: [dispatchActionId],
            budgetReservationKeys: [dispatchBudgetKey],
          },
        }],
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

integrationTest(
  "atomic graph application commits mixed moves and rolls every move back on a stale story CAS",
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
      await admin.query("grant popcorn_api to postgres");
      process.env.DATABASE_URL = roleUrl.toString();
      await admin.query(
        "insert into public.workspaces(id,name) values ($1,$2)",
        [workspaceId, `Rerun graph ${workspaceId}`]
      );
      await admin.query(
        `insert into public.projects(id,workspace_id,name,visibility)
         values ($1,$2,$3,'private')`,
        [projectId, workspaceId, `Rerun graph ${projectId}`]
      );

      const runScenario = async (staleStory: boolean) => {
        const slotRole = staleStory ? "poster-stale" : "poster-success";
        const oldImageId = randomUUID();
        const newImageId = randomUUID();
        const oldStoryId = randomUUID();
        const newStoryId = randomUUID();
        const concurrentStoryId = randomUUID();
        await admin.query(
          `insert into public.assets(
           id,workspace_id,project_id,kind,media,status,role,content
           ) values
             ($1,$4,$5,'image','image','ready','poster',null),
             ($2,$4,$5,'story_blueprint','data','ready','story_blueprint',
                '{"schema_version":"storyBlueprint.v1","title":"old"}'),
             ($3,$4,$5,'story_blueprint','data','ready','story_blueprint',
                '{"schema_version":"storyBlueprint.v1","title":"concurrent"}')`,
          [
            oldImageId,
            oldStoryId,
            concurrentStoryId,
            workspaceId,
            projectId,
          ]
        );
        const blueprintId = randomUUID();
        await admin.query(
          `insert into public.story_blueprints(
             id,workspace_id,project_id,asset_id,snapshot,provenance
           ) values (
             $1,$2,$3,$4,
             '{"schema_version":"storyBlueprint.v1","title":"old"}',
             '{"schema_version":"storyBlueprintProvenance.v1"}'
           )`,
          [blueprintId, workspaceId, projectId, oldStoryId]
        );
        await admin.query(
          `insert into public.selections(
             project_id,slot_owner_lineage_id,slot_role,seq,active_asset_id
           ) values ($1,null,$2,1,$3)`,
          [projectId, slotRole, oldImageId]
        );
        const selectionTarget = {
          kind: "selection",
          projectId,
          slotOwnerLineageId: null,
          slotRole,
        };
        const storyTarget = { kind: "project", projectId };
        const imageOutput = {
          bindingId: "image-binding",
          workItemId: "image-work",
          target: selectionTarget,
          kind: "image",
          role: "poster",
          ordinal: 0,
        };
        const storyOutput = {
          bindingId: "story-binding",
          workItemId: "story-work",
          target: storyTarget,
          kind: "story_snapshot",
          role: "story_blueprint",
          ordinal: 0,
        };
        const selectedWork = [{
          workItemId: "image-work",
          owner: "visuals",
          kind: "revise_visuals",
          targets: [selectionTarget],
          requiredOutputs: [imageOutput],
        }, {
          workItemId: "story-work",
          owner: "creative_director",
          kind: "revise_story",
          targets: [storyTarget],
          requiredOutputs: [storyOutput],
        }];
        const value = {
          ...proposal(projectId, selectedWork),
          targets: [selectionTarget, storyTarget],
          pins: {
            assets: [],
            selections: [{
              slotOwnerLineageId: null,
              slotRole,
              expectedActiveAssetId: oldImageId,
              expectedSeq: 1,
            }],
            storySnapshots: [{
              rowKind: "story_blueprint",
              rowId: blueprintId,
              expectedSnapshotAssetId: oldStoryId,
            }],
          },
          plannedSelectionMoves: [{
            bindingId: "image-binding",
            slotOwnerLineageId: null,
            slotRole,
            expectedActiveAssetId: oldImageId,
            expectedSeq: 1,
          }],
          plannedStoryPointerMoves: [{
            bindingId: "story-binding",
            rowKind: "story_blueprint",
            rowId: blueprintId,
            expectedSnapshotAssetId: oldStoryId,
          }],
        };
        const proposalId = await insertProposal(
          admin,
          projectId,
          selectedWork,
          value
        );
        const execution = await approveAndClaim(
          projectId,
          proposalId,
          staleStory ? "graph-stale" : "graph-success"
        );
        const complete = async (
          workItemId: string,
          output: typeof imageOutput | typeof storyOutput,
          assetId: string
        ) => {
          const dispatchActionId = randomUUID();
          const callbackTokenHash = createHash("sha256")
            .update(`graph:${workItemId}`)
            .digest("hex");
          await reserveWorkTransaction({
            projectId,
            lease: execution.lease,
            workItemId,
            requestFingerprint: `graph:${workItemId}`,
            dispatchActionId,
            dispatchParams: {},
            callbackFences: [{
              executorId: `graph:${workItemId}`,
              tokenHash: callbackTokenHash,
              generation: 1,
              requiredOutputs: [output],
            }],
          });
          const budgetKey = `graph-budget:${staleStory ? "stale" : "success"}:${workItemId}`;
          await reserveChildBudgetTransaction({
            projectId,
            executionReservationId: execution.reservation.reservation_id,
            workItemId,
            actionId: dispatchActionId,
            reservationKey: budgetKey,
            estimatedUsd: 0,
          });
          await admin.query(
            `insert into public.assets(
               id,workspace_id,project_id,kind,media,status,role,content,
               created_by_action_id
             ) values (
               $1,$2,$3,$4,$5,'ready',$6,$7::jsonb,$8
             )`,
            [
              assetId,
              workspaceId,
              projectId,
              output.kind === "story_snapshot" ? "story_blueprint" : "image",
              output.kind === "story_snapshot" ? "data" : "image",
              output.role,
              output.kind === "story_snapshot"
                ? JSON.stringify({
                  schema_version: "storyBlueprint.v1",
                  title: "new",
                })
                : null,
              dispatchActionId,
            ]
          );
          await admin.query(
            `insert into public.action_assets(
               project_id,action_id,asset_id,direction,role,ordinal
             ) values ($1,$2,$3,'output',$4,0)`,
            [projectId, dispatchActionId, assetId, output.role]
          );
          await admin.query(
            `select * from public.settle_orchestrator_run_budget($1,$2,0,null,0)`,
            [projectId, budgetKey]
          );
          const binding = {
            ...output,
            assetId,
            intrinsicRole: output.role,
          };
          await parkWorkTransaction({
            projectId,
            lease: execution.lease,
            workItemId,
            completedCallbacks: [{
              executorId: `graph:${workItemId}`,
              tokenHash: callbackTokenHash,
              generation: 1,
              result: {
                outputs: [binding],
                primitiveActionIds: [dispatchActionId],
                budgetReservationKeys: [budgetKey],
              },
            }],
            bindingResults: [binding],
            primitiveActionIds: [dispatchActionId],
            budgetReservationKeys: [budgetKey],
          });
          await completeWorkTransaction({
            projectId,
            lease: execution.lease,
            workItemId,
            bindingResults: [binding],
            primitiveActionIds: [dispatchActionId],
            budgetReservationKeys: [budgetKey],
          });
        };
        await complete("image-work", imageOutput, newImageId);
        await complete("story-work", storyOutput, newStoryId);
        if (staleStory) {
          await admin.query(
            "update public.story_blueprints set asset_id=$2 where id=$1",
            [blueprintId, concurrentStoryId]
          );
        }
        const executionActionId = randomUUID();
        const reconciliationActionId = randomUUID();
        if (staleStory) {
          await assert.rejects(
            finalizeExecutionTransaction({
              projectId,
              lease: execution.lease,
              executionActionId,
              outcome: "applied",
              reconciliationActionId,
            }),
            (error: unknown) =>
              error instanceof ApiError && error.code === "stale_proposal"
          );
          const selection = await admin.query<{ count: string; active_asset_id: string }>(
            `select count(*)::text as count,
                    (array_agg(active_asset_id order by seq desc))[1] as active_asset_id
               from public.selections
              where project_id=$1 and slot_role=$2`,
            [projectId, slotRole]
          );
          assert.equal(selection.rows[0]?.count, "1");
          assert.equal(selection.rows[0]?.active_asset_id, oldImageId);
          assert.equal((await admin.query(
            "select 1 from public.actions where id in ($1,$2)",
            [executionActionId, reconciliationActionId]
          )).rowCount, 0);
          await finalizeExecutionTransaction({
            projectId,
            lease: execution.lease,
            executionActionId,
            outcome: "failed",
            error: { kind: "stale_proposal" },
          });
          return;
        }
        await finalizeExecutionTransaction({
          projectId,
          lease: execution.lease,
          executionActionId,
          outcome: "applied",
          reconciliationActionId,
        });
        const selection = await admin.query<{
          seq: number;
          active_asset_id: string;
          set_by_action_id: string;
        }>(
          `select seq,active_asset_id,set_by_action_id
             from public.selections
            where project_id=$1 and slot_role=$2
            order by seq desc limit 1`,
          [projectId, slotRole]
        );
        assert.deepEqual(selection.rows[0], {
          seq: 2,
          active_asset_id: newImageId,
          set_by_action_id: executionActionId,
        });
        assert.equal(
          (await admin.query<{ asset_id: string }>(
            "select asset_id from public.story_blueprints where id=$1",
            [blueprintId]
          )).rows[0]?.asset_id,
          newStoryId
        );
        const reconciliation = await admin.query<{
          status: string;
          moved_selections: unknown[];
          moved_story_pointers: unknown[];
        }>(
          `select status,
                  params->'movedSelections' as moved_selections,
                  params->'movedStoryPointers' as moved_story_pointers
             from public.actions where id=$1`,
          [reconciliationActionId]
        );
        assert.equal(reconciliation.rows[0]?.status, "applied");
        assert.equal(reconciliation.rows[0]?.moved_selections.length, 1);
        assert.equal(reconciliation.rows[0]?.moved_story_pointers.length, 1);
      };

      await runScenario(false);
      await runScenario(true);
      context.diagnostic("mixed atomic apply and stale rollback both passed");
    } finally {
      await closePostgresPool();
      process.env.DATABASE_URL = originalUrl;
      await admin.query("revoke popcorn_api from postgres").catch(() => undefined);
      await admin.query(
        "delete from public.workspaces where id=$1",
        [workspaceId]
      ).catch(() => undefined);
      await admin.end();
    }
  }
);
