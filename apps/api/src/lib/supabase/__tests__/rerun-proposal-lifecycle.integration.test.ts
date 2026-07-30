import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { callbackTokenHash } from "../../orchestrator/rerun-lifecycle-service.js";

const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const integrationTest = runLocalIntegration ? test : test.skip;

function client(): SupabaseClient {
  return createClient(localUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function noError(error: { message: string } | null, operation: string): void {
  assert.equal(error, null, `${operation}: ${error?.message ?? "unknown error"}`);
}

async function fixture(label: string) {
  const service = client();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  noError((await service.from("workspaces").insert({
    id: workspaceId,
    name: `__rerun_lifecycle_${label}_${randomUUID()}`,
  })).error, "workspace");
  noError((await service.from("projects").insert({
    id: projectId,
    workspace_id: workspaceId,
    name: `Rerun lifecycle ${label}`,
    visibility: "private",
  })).error, "project");
  return {
    service,
    workspaceId,
    projectId,
    cleanup: async () => {
      noError((await service.from("workspaces").delete().eq("id", workspaceId)).error, "cleanup");
    },
  };
}

function proposal(input: {
  projectId: string;
  rootRunId: string | null;
  maxCostUsd?: number;
  storySnapshots?: unknown[];
  selectedWork?: unknown[];
}) {
  return {
    schema_version: "action_proposal.v1",
    schemaVersion: "RerunProposal.v2",
    projectId: input.projectId,
    rootRunId: input.rootRunId,
    source: "request_changes",
    userIntent: "Revise the selected media.",
    targets: [{ kind: "project", projectId: input.projectId }],
    inspectedAssetIds: [],
    candidateAffectedAssetIds: [],
    preservedAssetIds: [],
    checklist: [],
    pins: {
      assets: [],
      selections: [],
      storySnapshots: input.storySnapshots ?? [],
    },
    estimate: {
      costUsd: input.maxCostUsd ?? 0,
      maxCostUsd: input.maxCostUsd ?? 0,
      latencyClass: "interactive",
    },
    risk: "low",
    requiresApproval: true,
    rationale: "DB lifecycle integration fixture.",
    userFacingSummary: "Revise selected media.",
    outcome: "revision",
    selectedWork: input.selectedWork ?? [],
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
  };
}

async function insertProposal(input: {
  service: SupabaseClient;
  projectId: string;
  rootRunId: string | null;
  proposal: Record<string, unknown>;
}) {
  const actionId = randomUUID();
  noError((await input.service.from("actions").insert({
    id: actionId,
    project_id: input.projectId,
    orchestrator_run_id: input.rootRunId,
    tool: "rerun_proposal",
    status: "proposed",
    params: { schema_version: "action_params.v1" },
    proposal: input.proposal,
    input_asset_ids: [],
    output_asset_ids: [],
    job_ids: [],
  })).error, "proposal");
  const approvalActionId = randomUUID();
  const approvalFingerprint = `approval:${actionId}`;
  const approval = await input.service.rpc("approve_rerun_proposal", {
    p_project_id: input.projectId,
    p_proposal_action_id: actionId,
    p_approval_action_id: approvalActionId,
    p_actor_id: "integration-test",
    p_approved_max_cost_usd:
      (input.proposal.estimate as { maxCostUsd: number }).maxCostUsd,
    p_approval_fingerprint: approvalFingerprint,
    p_autonomous: false,
  });
  noError(approval.error, "approval");
  assert.equal(approval.data[0].stale, false);
  return { actionId, approvalActionId, approvalFingerprint };
}

integrationTest(
  "concurrent execute admission creates one post-approval root and stable replay",
  async () => {
    const f = await fixture("concurrency");
    try {
      const created = await insertProposal({
        ...f,
        rootRunId: null,
        proposal: proposal({ projectId: f.projectId, rootRunId: null }),
      });
      const request = {
        p_project_id: f.projectId,
        p_proposal_action_id: created.actionId,
        p_approval_action_id: created.approvalActionId,
        p_idempotency_key: `execute:${created.actionId}`,
        p_request_fingerprint: `fingerprint:${created.actionId}`,
        p_approved_max_cost_usd: 0,
        p_approval_fingerprint: created.approvalFingerprint,
      };
      const attempts = await Promise.all(
        Array.from({ length: 10 }, () =>
          f.service.rpc("reserve_rerun_proposal_execution", request))
      );
      attempts.forEach((attempt, index) => noError(attempt.error, `reserve ${index}`));
      const rows = attempts.map((attempt) => attempt.data[0]);
      assert.equal(new Set(rows.map((row) => row.reservation_id)).size, 1);
      assert.equal(new Set(rows.map((row) => row.root_run_id)).size, 1);
      assert.equal(rows.filter((row) => row.replayed === false).length, 1);

      const { data: roots, error: rootError } = await f.service
        .from("orchestrator_runs")
        .select("id, agent_role, root_execution_profile, status")
        .eq("project_id", f.projectId);
      noError(rootError, "roots");
      assert.deepEqual(roots, [{
        id: rows[0].root_run_id,
        agent_role: "creative_director",
        root_execution_profile: "creative_director",
        status: "running",
      }]);
      const approvalMismatch = await f.service.rpc(
        "reserve_rerun_proposal_execution",
        { ...request, p_approval_fingerprint: "wrong-approval-fingerprint" }
      );
      assert.ok(approvalMismatch.error?.message.includes("replay_mismatch"));

      const conflict = await f.service.rpc("reserve_rerun_proposal_execution", {
        ...request,
        p_idempotency_key: `different:${created.actionId}`,
      });
      assert.ok(conflict.error?.message.includes("idempotency_conflict"));
    } finally {
      await f.cleanup();
    }
  }
);

integrationTest(
  "null-root refresh is causally idempotent and never creates a ghost run",
  async () => {
    const f = await fixture("refresh");
    try {
      const priorActionId = randomUUID();
      const nextProposal = proposal({ projectId: f.projectId, rootRunId: null });
      noError((await f.service.from("actions").insert({
        id: priorActionId,
        project_id: f.projectId,
        orchestrator_run_id: null,
        tool: "rerun_proposal",
        status: "proposed",
        params: { schema_version: "action_params.v1" },
        proposal: nextProposal,
        input_asset_ids: [],
        output_asset_ids: [],
        job_ids: [],
      })).error, "prior proposal");
      const successorActionId = randomUUID();
      const request = {
        p_project_id: f.projectId,
        p_prior_action_id: priorActionId,
        p_successor_action_id: successorActionId,
        p_request_fingerprint: "refresh-fingerprint",
        p_cause: "refresh",
        p_orchestrator_run_id: null,
        p_params: {
          schemaVersion: "rerun_proposal_request.v2",
          message: "Refresh it.",
        },
        p_proposal: nextProposal,
        p_input_asset_ids: [],
        p_rationale: "Refreshed context.",
        p_successor_status: "proposed",
      };
      const first = await f.service.rpc("create_rerun_proposal_successor", request);
      noError(first.error, "create successor");
      const replay = await f.service.rpc("create_rerun_proposal_successor", request);
      noError(replay.error, "replay successor");
      assert.equal(replay.data[0].replayed, true);
      const mismatch = await f.service.rpc("create_rerun_proposal_successor", {
        ...request,
        p_request_fingerprint: "different-refresh-fingerprint",
      });
      assert.ok(mismatch.error?.message.includes("replay_mismatch"));
      const { count } = await f.service.from("orchestrator_runs")
        .select("*", { count: "exact", head: true }).eq("project_id", f.projectId);
      assert.equal(count, 0);
    } finally {
      await f.cleanup();
    }
  }
);

integrationTest(
  "proposal ceilings serialize against one root budget and actuals come from settled children",
  async () => {
    const f = await fixture("budget");
    try {
      const rootRunId = randomUUID();
      noError((await f.service.from("orchestrator_runs").insert({
        id: rootRunId,
        project_id: f.projectId,
        status: "queued",
        input_summary: "Budget integration root",
        budget_usd: 1,
        root_execution_profile: "creative_director",
      })).error, "root");
      const pair = await Promise.all([0, 1].map(() =>
        insertProposal({
          ...f,
          rootRunId,
          proposal: proposal({ projectId: f.projectId, rootRunId, maxCostUsd: 0.75 }),
        })));
      const admissions = await Promise.all(pair.map((created, index) =>
        f.service.rpc("reserve_rerun_proposal_execution", {
          p_project_id: f.projectId,
          p_proposal_action_id: created.actionId,
          p_approval_action_id: created.approvalActionId,
          p_idempotency_key: `budget:${index}:${created.actionId}`,
          p_request_fingerprint: `budget:${index}:${created.actionId}`,
          p_approved_max_cost_usd: 0.75,
          p_approval_fingerprint: created.approvalFingerprint,
        })));
      assert.equal(admissions.filter((result) => result.error === null).length, 1);
      assert.equal(
        admissions.filter((result) =>
          result.error?.message.includes("root_family_budget_exhausted")).length,
        1
      );
      const { data: sharedRoot } = await f.service.from("orchestrator_runs")
        .select("status").eq("id", rootRunId).single();
      assert.equal(sharedRoot?.status, "queued");

      const selectedWork = [{
        workItemId: "cost-work",
        owner: "visuals",
        kind: "revise_visuals",
        targets: [{ kind: "project", projectId: f.projectId }],
        requiredOutputs: [],
      }];
      const costProposal = await insertProposal({
        ...f,
        rootRunId: null,
        proposal: proposal({
          projectId: f.projectId,
          rootRunId: null,
          maxCostUsd: 0.5,
          selectedWork,
        }),
      });
      const admitted = await f.service.rpc("reserve_rerun_proposal_execution", {
        p_project_id: f.projectId,
        p_proposal_action_id: costProposal.actionId,
        p_approval_action_id: costProposal.approvalActionId,
        p_idempotency_key: `actual:${costProposal.actionId}`,
        p_request_fingerprint: `actual:${costProposal.actionId}`,
        p_approved_max_cost_usd: 0.5,
        p_approval_fingerprint: costProposal.approvalFingerprint,
      });
      noError(admitted.error, "actual admit");
      const reservation = admitted.data[0];
      const lease = await f.service.rpc("claim_rerun_execution_lease", {
        p_project_id: f.projectId,
        p_reservation_id: reservation.reservation_id,
        p_lease_seconds: 60,
      });
      noError(lease.error, "actual lease");
      const dispatchActionId = randomUUID();
      noError((await f.service.rpc("reserve_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: reservation.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_work_item_id: "cost-work",
        p_request_fingerprint: `cost-work:${costProposal.actionId}`,
        p_dispatch_action_id: dispatchActionId,
        p_dispatch_params: { schemaVersion: "RerunWorkDispatch.v1" },
        p_callback_fences: [],
      })).error, "actual work");
      const reservationKey = `rerun-cost:${costProposal.actionId}`;
      noError((await f.service.rpc("reserve_rerun_child_budget", {
        p_project_id: f.projectId,
        p_execution_reservation_id: reservation.reservation_id,
        p_work_item_id: "cost-work",
        p_child_run_id: null,
        p_action_id: dispatchActionId,
        p_job_id: null,
        p_reservation_key: reservationKey,
        p_estimated_usd: 0.4,
      })).error, "child budget");
      noError((await f.service.rpc("settle_orchestrator_run_budget", {
        p_project_id: f.projectId,
        p_reservation_key: reservationKey,
        p_actual_usd: 0.3,
        p_billing_user_id: null,
        p_billable_usd: 0,
      })).error, "settle child");
      const childRunId = randomUUID();
      const childDispatch = await f.service.rpc("create_domain_run_dispatch", {
        p_idempotency_scope: `rerun-child:${reservation.reservation_id}`,
        p_idempotency_key: "invalid-causation",
        p_request_hash: "invalid-causation-hash",
        p_run_id: childRunId,
        p_project_id: f.projectId,
        p_domain: "visuals",
        p_input_summary: "Invalid approval causation fixture",
        p_budget_usd: 0,
        p_task_kind: "visuals_revision",
        p_task_params: {
          schemaVersion: "DomainTask.v1",
          domain: "visuals",
          taskKind: "visuals_revision",
          objective: "Test causation.",
          instruction: "Produce nothing.",
          targets: [{ kind: "project", projectId: f.projectId }],
          requiredOutputs: [],
          allowedOutputKinds: [],
          creativeConstraints: {},
          preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
          candidateAffectedAssetIds: [],
          budgetUsd: 0,
          approvalContext: {
            proposalActionId: randomUUID(),
            approvalActionId: costProposal.approvalActionId,
            executionReservationId: reservation.reservation_id,
            approvedBudgetUsd: 0.5,
            approvalFingerprint: "wrong-proposal",
          },
          acceptanceCriteria: [],
          origin: {
            kind: "creative_director",
            rootRunId: reservation.root_run_id,
            rootActionId: dispatchActionId,
            creatorMessageId: "integration",
          },
          responseRecipient: { kind: "creative_director" },
        },
        p_origin_kind: "creative_director",
        p_parent_run_id: reservation.root_run_id,
        p_root_action_id: dispatchActionId,
        p_origin_actor_id: null,
        p_origin_request: null,
        p_continues_run_id: null,
        p_pins: null,
        p_gate_stage: null,
        p_enqueue: false,
        p_max_children_per_root: 20,
        p_max_continuation_chain: 10,
        p_max_session_turns: 20,
        p_max_blocked_reports_per_requirement: 3,
      });
      noError(childDispatch.error, "invalid causation child");
      noError((await f.service.from("orchestrator_runs").update({
        status: "succeeded",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }).eq("id", childRunId)).error, "complete invalid child");
      const invalidReportActionId = randomUUID();
      noError((await f.service.from("actions").insert({
        id: invalidReportActionId,
        project_id: f.projectId,
        orchestrator_run_id: childRunId,
        tool: "domain_report",
        status: "applied",
        params: {
          schemaVersion: "DomainReport.v1",
          outcome: {
            outcome: "done",
            outputs: [],
            changedSelections: [],
            acceptanceEvidence: [],
            sessionSummary: "Invalid causation fixture.",
          },
        },
        input_asset_ids: [],
        output_asset_ids: [],
        job_ids: [],
      })).error, "invalid report");
      const invalidCompletion = await f.service.rpc("complete_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: reservation.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_work_item_id: "cost-work",
        p_child_run_id: childRunId,
        p_report_action_id: invalidReportActionId,
        p_reconciliation_action_id: null,
        p_binding_results: [],
        p_primitive_action_ids: [],
        p_budget_reservation_keys: [reservationKey],
      });
      assert.ok(invalidCompletion.error?.message.includes("causation"));
      noError((await f.service.rpc("complete_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: reservation.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_work_item_id: "cost-work",
        p_child_run_id: null,
        p_report_action_id: null,
        p_reconciliation_action_id: null,
        p_binding_results: [],
        p_primitive_action_ids: [],
        p_budget_reservation_keys: [reservationKey],
      })).error, "complete cost work");

      const arbitraryActionId = randomUUID();
      noError((await f.service.from("actions").insert({
        id: arbitraryActionId,
        project_id: f.projectId,
        orchestrator_run_id: reservation.root_run_id,
        tool: "unrelated_action",
        status: "applied",
        params: { schema_version: "action_params.v1" },
        input_asset_ids: [],
        output_asset_ids: [],
        job_ids: [],
      })).error, "arbitrary action");
      const rejected = await f.service.rpc("finalize_rerun_execution", {
        p_project_id: f.projectId,
        p_reservation_id: reservation.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_execution_action_id: randomUUID(),
        p_outcome: "applied",
        p_reconciliation_action_id: arbitraryActionId,
        p_error: null,
      });
      assert.ok(rejected.error?.message.includes("terminal root reconciliation"));

      const reconciliationActionId = randomUUID();
      noError((await f.service.from("actions").insert({
        id: reconciliationActionId,
        project_id: f.projectId,
        orchestrator_run_id: reservation.root_run_id,
        tool: "rerun_reconciliation",
        status: "applied",
        params: {
          schema_version: "action_params.v1",
          schemaVersion: "RerunReconciliation.v1",
          proposalActionId: costProposal.actionId,
          executionReservationId: reservation.reservation_id,
        },
        input_asset_ids: [],
        output_asset_ids: [],
        job_ids: [],
      })).error, "reconciliation");
      const executionActionId = randomUUID();
      noError((await f.service.rpc("finalize_rerun_execution", {
        p_project_id: f.projectId,
        p_reservation_id: reservation.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_execution_action_id: executionActionId,
        p_outcome: "applied",
        p_reconciliation_action_id: reconciliationActionId,
        p_error: null,
      })).error, "finalize actual");
      const { data: execution } = await f.service.from("actions")
        .select("params").eq("id", executionActionId).single();
      assert.ok(execution);
      assert.equal(execution.params.actualCostUsd, 0.3);
    } finally {
      await f.cleanup();
    }
  }
);

integrationTest(
  "a pin changed after approval terminalizes stale before reservation or dispatch",
  async () => {
    const f = await fixture("stale");
    try {
      const storyboardId = randomUUID();
      noError((await f.service.from("story_blueprints").insert({
        id: storyboardId,
        workspace_id: f.workspaceId,
        project_id: f.projectId,
        status: "draft",
        snapshot: { schema_version: "storyBlueprintSnapshot.v1" },
      })).error, "story blueprint");
      const created = await insertProposal({
        ...f,
        rootRunId: null,
        proposal: proposal({
          projectId: f.projectId,
          rootRunId: null,
          storySnapshots: [{
            rowKind: "storyboard",
            rowId: storyboardId,
            expectedSnapshotAssetId: null,
          }],
        }),
      });
      const assetId = randomUUID();
      noError((await f.service.from("assets").insert({
        id: assetId,
        workspace_id: f.workspaceId,
        project_id: f.projectId,
        kind: "plan",
        media: "data",
        content: { schema_version: "plan.v1" },
        filename: "plan.json",
        source: {},
      })).error, "asset");
      noError((await f.service.from("story_blueprints").update({
        provenance: {
          schema_version: "storyBlueprintProvenance.v1",
          planAssetId: assetId,
        },
      }).eq("id", storyboardId)).error, "move storyboard pin");
      const reserved = await f.service.rpc("reserve_rerun_proposal_execution", {
        p_project_id: f.projectId,
        p_proposal_action_id: created.actionId,
        p_approval_action_id: created.approvalActionId,
        p_idempotency_key: `stale:${created.actionId}`,
        p_request_fingerprint: `stale:${created.actionId}`,
        p_approved_max_cost_usd: 0,
        p_approval_fingerprint: created.approvalFingerprint,
      });
      noError(reserved.error, "stale admission");
      assert.equal(reserved.data[0].status, "failed");
      assert.equal(reserved.data[0].reservation_id, null);
      const { data: action } = await f.service.from("actions")
        .select("status, error").eq("id", created.actionId).single();
      assert.ok(action);
      assert.equal(action.status, "failed");
      assert.equal(action.error.kind, "stale_proposal");
      const { count } = await f.service.from("rerun_execution_reservations")
        .select("*", { count: "exact", head: true }).eq("proposal_action_id", created.actionId);
      assert.equal(count, 0);
    } finally {
      await f.cleanup();
    }
  }
);

integrationTest(
  "lease takeover, callback replay, failure release, and reconciliation causation are fenced",
  async () => {
    const f = await fixture("fences");
    try {
      const workItemId = "visual-work";
      const selectedWork = [{
        workItemId,
        owner: "visuals",
        kind: "revise_visuals",
        targets: [{ kind: "project", projectId: f.projectId }],
        requiredOutputs: [],
      }];
      const created = await insertProposal({
        ...f,
        rootRunId: null,
        proposal: proposal({ projectId: f.projectId, rootRunId: null, selectedWork }),
      });
      const admitted = await f.service.rpc("reserve_rerun_proposal_execution", {
        p_project_id: f.projectId,
        p_proposal_action_id: created.actionId,
        p_approval_action_id: created.approvalActionId,
        p_idempotency_key: `fence:${created.actionId}`,
        p_request_fingerprint: `fence:${created.actionId}`,
        p_approved_max_cost_usd: 0,
        p_approval_fingerprint: created.approvalFingerprint,
      });
      noError(admitted.error, "admit");
      const reservationId = admitted.data[0].reservation_id;
      const first = await f.service.rpc("claim_rerun_execution_lease", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_lease_seconds: 60,
      });
      noError(first.error, "first lease");
      noError((await f.service.from("rerun_execution_reservations").update({
        lease_expires_at: new Date(Date.now() - 1000).toISOString(),
      }).eq("id", reservationId)).error, "expire lease");
      const second = await f.service.rpc("claim_rerun_execution_lease", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_lease_seconds: 60,
      });
      noError(second.error, "second lease");
      assert.equal(second.data[0].lease_generation, first.data[0].lease_generation + 1);

      const dispatchActionId = randomUUID();
      const callbackToken = randomUUID();
      const callbackHash = callbackTokenHash(callbackToken);
      const unusedCallbackToken = randomUUID();
      const unusedCallbackHash = callbackTokenHash(unusedCallbackToken);
      const work = await f.service.rpc("reserve_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_lease_token: second.data[0].lease_token,
        p_lease_generation: second.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_request_fingerprint: `work:${created.actionId}`,
        p_dispatch_action_id: dispatchActionId,
        p_dispatch_params: {
          schemaVersion: "RerunWorkDispatch.v1",
          proposalActionId: created.actionId,
          executionReservationId: reservationId,
        },
        p_callback_fences: [{
          executorId: "fake:image",
          tokenHash: callbackHash,
          generation: 1,
        }, {
          executorId: "fake:unused",
          tokenHash: unusedCallbackHash,
          generation: 1,
        }],
      });
      noError(work.error, "reserve work");
      const callback = {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_work_item_id: workItemId,
        p_executor_id: "fake:image",
        p_callback_token: callbackToken,
        p_callback_generation: 1,
        p_outcome: "completed",
        p_result: { schemaVersion: "RerunCallback.v1", outputs: [] },
      };
      noError((await f.service.rpc("record_rerun_executor_callback", callback)).error,
        "callback before park");
      const oldFence = await f.service.rpc("fail_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_lease_token: first.data[0].lease_token,
        p_lease_generation: first.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_error: { kind: "must_fail" },
      });
      assert.ok(oldFence.error?.message.includes("stale_rerun_execution_lease"));

      noError((await f.service.rpc("park_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_lease_token: second.data[0].lease_token,
        p_lease_generation: second.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_accepted_callbacks: [{
          executorId: "fake:image",
          tokenHash: callbackHash,
          generation: 1,
          jobIds: [],
        }],
        p_completed_callbacks: null,
        p_blocked_precondition: null,
        p_partial_binding_results: [],
        p_primitive_action_ids: [],
        p_budget_reservation_keys: [],
      })).error, "park work");
      const replay = await f.service.rpc("record_rerun_executor_callback", callback);
      noError(replay.error, "callback replay");
      assert.equal(replay.data, true);

      noError((await f.service.rpc("park_rerun_execution", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_lease_token: second.data[0].lease_token,
        p_lease_generation: second.data[0].lease_generation,
      })).error, "park execution");
      const third = await f.service.rpc("claim_rerun_execution_lease", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_lease_seconds: 60,
      });
      noError(third.error, "callback-ready lease");
      noError((await f.service.rpc("record_rerun_executor_callback", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_work_item_id: workItemId,
        p_executor_id: "fake:unused",
        p_callback_token: unusedCallbackToken,
        p_callback_generation: 1,
        p_outcome: "completed",
        p_result: { schemaVersion: "RerunCallback.v1", outputs: [] },
      })).error, "resume untouched callback step");
      const replayedWork = await f.service.rpc("reserve_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_lease_token: third.data[0].lease_token,
        p_lease_generation: third.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_request_fingerprint: `work:${created.actionId}`,
        p_dispatch_action_id: dispatchActionId,
        p_dispatch_params: {},
        p_callback_fences: [],
      });
      noError(replayedWork.error, "load callback result");
      assert.equal(replayedWork.data[0].callback_results.length, 2);
      assert.ok(replayedWork.data[0].callback_results.every(
        (result: { status: string }) => result.status === "completed"
      ));
      noError((await f.service.rpc("complete_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: reservationId,
        p_lease_token: third.data[0].lease_token,
        p_lease_generation: third.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_child_run_id: null,
        p_report_action_id: null,
        p_reconciliation_action_id: null,
        p_binding_results: [],
        p_primitive_action_ids: [],
        p_budget_reservation_keys: [],
      })).error, "complete callback work");
      const executionActionId = randomUUID();
      noError((await f.service.rpc("cancel_rerun_execution", {
        p_project_id: f.projectId,
        p_proposal_action_id: created.actionId,
        p_execution_action_id: executionActionId,
        p_reason: "creator canceled after callback",
      })).error, "cancel execution");
      const { data: ceiling } = await f.service.from("orchestrator_budget_reservations")
        .select("status").eq("id", admitted.data[0].budget_reservation_id).single();
      assert.ok(ceiling);
      assert.equal(ceiling.status, "released");
      const canceledReplay = await f.service.rpc("cancel_rerun_execution", {
        p_project_id: f.projectId,
        p_proposal_action_id: created.actionId,
        p_execution_action_id: randomUUID(),
        p_reason: "duplicate creator cancellation",
      });
      noError(canceledReplay.error, "terminal cancel replay");
      assert.equal(canceledReplay.data, executionActionId);
      const terminalCallbackReplay = await f.service.rpc(
        "record_rerun_executor_callback", callback
      );
      noError(terminalCallbackReplay.error, "terminal callback exact replay");
      assert.equal(terminalCallbackReplay.data, true);
      const terminalCallbackMismatch = await f.service.rpc(
        "record_rerun_executor_callback",
        { ...callback, p_result: { schemaVersion: "RerunCallback.v1", outputs: ["changed"] } }
      );
      assert.ok(terminalCallbackMismatch.error?.message.includes("replay_mismatch"));
      const { data: ownedRoot } = await f.service.from("orchestrator_runs")
        .select("status").eq("id", admitted.data[0].root_run_id).single();
      assert.equal(ownedRoot?.status, "canceled");
    } finally {
      await f.cleanup();
    }
  }
);

integrationTest(
  "blocked work terminalizes durably and releases its child commitment",
  async () => {
    const f = await fixture("blocked");
    try {
      const workItemId = "blocked-work";
      const created = await insertProposal({
        ...f,
        rootRunId: null,
        proposal: proposal({
          projectId: f.projectId,
          rootRunId: null,
          maxCostUsd: 0.25,
          selectedWork: [{
            workItemId,
            owner: "visuals",
            kind: "revise_visuals",
            targets: [{ kind: "project", projectId: f.projectId }],
            requiredOutputs: [],
          }],
        }),
      });
      const admitted = await f.service.rpc("reserve_rerun_proposal_execution", {
        p_project_id: f.projectId,
        p_proposal_action_id: created.actionId,
        p_approval_action_id: created.approvalActionId,
        p_idempotency_key: `blocked:${created.actionId}`,
        p_request_fingerprint: `blocked:${created.actionId}`,
        p_approved_max_cost_usd: 0.25,
        p_approval_fingerprint: created.approvalFingerprint,
      });
      noError(admitted.error, "blocked admission");
      const execution = admitted.data[0];
      const lease = await f.service.rpc("claim_rerun_execution_lease", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_seconds: 60,
      });
      noError(lease.error, "blocked lease");
      const dispatchActionId = randomUUID();
      const workRequest = {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_request_fingerprint: `blocked-work:${created.actionId}`,
        p_dispatch_action_id: dispatchActionId,
        p_dispatch_params: {
          schemaVersion: "RerunWorkDispatch.v1",
          proposalActionId: created.actionId,
          executionReservationId: execution.reservation_id,
          workItemId,
        },
        p_callback_fences: [],
      };
      noError((await f.service.rpc("reserve_rerun_work_item", workRequest)).error,
        "reserve blocked work");
      const budgetKey = `blocked-budget:${created.actionId}`;
      noError((await f.service.rpc("reserve_rerun_child_budget", {
        p_project_id: f.projectId,
        p_execution_reservation_id: execution.reservation_id,
        p_work_item_id: workItemId,
        p_child_run_id: null,
        p_action_id: dispatchActionId,
        p_job_id: null,
        p_reservation_key: budgetKey,
        p_estimated_usd: 0.2,
      })).error, "reserve blocked budget");
      noError((await f.service.rpc("park_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_accepted_callbacks: null,
        p_completed_callbacks: null,
        p_blocked_precondition: { kind: "missing_anchor" },
        p_partial_binding_results: [],
        p_primitive_action_ids: [],
        p_budget_reservation_keys: [budgetKey],
      })).error, "terminalize blocked work");
      const replay = await f.service.rpc("reserve_rerun_work_item", workRequest);
      noError(replay.error, "replay blocked work");
      assert.equal(replay.data[0].work_status, "failed");
      const { data: budget } = await f.service.from("orchestrator_budget_reservations")
        .select("status").eq("reservation_key", budgetKey).single();
      assert.equal(budget?.status, "released");
      const executionActionId = randomUUID();
      noError((await f.service.rpc("finalize_rerun_execution", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_execution_action_id: executionActionId,
        p_outcome: "failed",
        p_reconciliation_action_id: null,
        p_error: { kind: "blocked_precondition" },
      })).error, "finalize blocked execution");
      const { data: root } = await f.service.from("orchestrator_runs")
        .select("status").eq("id", execution.root_run_id).single();
      assert.equal(root?.status, "failed");
    } finally {
      await f.cleanup();
    }
  }
);

integrationTest(
  "expired worker leases repark behind live provider callbacks until callback expiry",
  async () => {
    const f = await fixture("callback-lease");
    try {
      const workItemId = "async-work";
      const created = await insertProposal({
        ...f,
        rootRunId: null,
        proposal: proposal({
          projectId: f.projectId,
          rootRunId: null,
          selectedWork: [{
            workItemId,
            owner: "visuals",
            kind: "revise_visuals",
            targets: [{ kind: "project", projectId: f.projectId }],
            requiredOutputs: [],
          }],
        }),
      });
      const admitted = await f.service.rpc("reserve_rerun_proposal_execution", {
        p_project_id: f.projectId,
        p_proposal_action_id: created.actionId,
        p_approval_action_id: created.approvalActionId,
        p_idempotency_key: `callback-lease:${created.actionId}`,
        p_request_fingerprint: `callback-lease:${created.actionId}`,
        p_approved_max_cost_usd: 0,
        p_approval_fingerprint: created.approvalFingerprint,
      });
      noError(admitted.error, "callback lease admission");
      const execution = admitted.data[0];
      const lease = await f.service.rpc("claim_rerun_execution_lease", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_seconds: 60,
      });
      noError(lease.error, "callback lease");
      const callbackToken = randomUUID();
      const dispatchActionId = randomUUID();
      noError((await f.service.rpc("reserve_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_request_fingerprint: `async:${created.actionId}`,
        p_dispatch_action_id: dispatchActionId,
        p_dispatch_params: {},
        p_callback_fences: [{
          executorId: "fake:async",
          tokenHash: callbackTokenHash(callbackToken),
          generation: 1,
          requiredOutputs: [],
        }],
      })).error, "reserve async work");
      noError((await f.service.rpc("park_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_accepted_callbacks: [{
          executorId: "fake:async",
          tokenHash: callbackTokenHash(callbackToken),
          generation: 1,
          jobIds: [randomUUID()],
        }],
        p_completed_callbacks: null,
        p_blocked_precondition: null,
        p_partial_binding_results: [],
        p_primitive_action_ids: [],
        p_budget_reservation_keys: [],
      })).error, "accept async work");
      noError((await f.service.from("rerun_execution_reservations").update({
        lease_expires_at: new Date(Date.now() - 1_000).toISOString(),
      }).eq("id", execution.reservation_id)).error, "expire worker lease");
      const parked = await f.service.rpc("claim_rerun_execution_lease", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_seconds: 60,
      });
      noError(parked.error, "repark expired worker");
      assert.equal(parked.data[0].parked, true);
      assert.equal(parked.data[0].lease_token, null);
      const prematureRecovery = await f.service.rpc("recover_rerun_execution", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_execution_action_id: randomUUID(),
        p_reason: "worker_expired",
      });
      assert.ok(prematureRecovery.error?.message.includes("not recoverable yet"));
      noError((await f.service.from("rerun_execution_callbacks").update({
        expires_at: new Date(Date.now() - 1_000).toISOString(),
      }).eq("execution_reservation_id", execution.reservation_id)).error,
      "expire provider callback");
      noError((await f.service.rpc("recover_rerun_execution", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_execution_action_id: randomUUID(),
        p_reason: "callback_expired",
      })).error, "recover expired callback");
      const { data: ceiling } = await f.service.from("orchestrator_budget_reservations")
        .select("status").eq("id", execution.budget_reservation_id).single();
      assert.equal(ceiling?.status, "released");
    } finally {
      await f.cleanup();
    }
  }
);

integrationTest(
  "two executor child steps persist independently and fan in exact primitive budgets",
  async () => {
    const f = await fixture("step-fan-in");
    try {
      const workItemId = "fan-in-work";
      const outputs = [0, 1].map((ordinal) => ({
        bindingId: `binding-${ordinal}`,
        workItemId,
        target: { kind: "project", projectId: f.projectId },
        kind: "image",
        role: `step-${ordinal}`,
        ordinal,
      }));
      const created = await insertProposal({
        ...f,
        rootRunId: null,
        proposal: proposal({
          projectId: f.projectId,
          rootRunId: null,
          maxCostUsd: 0.4,
          selectedWork: [{
            workItemId,
            owner: "visuals",
            kind: "revise_visuals",
            targets: [{ kind: "project", projectId: f.projectId }],
            requiredOutputs: outputs,
          }],
        }),
      });
      const admitted = await f.service.rpc("reserve_rerun_proposal_execution", {
        p_project_id: f.projectId,
        p_proposal_action_id: created.actionId,
        p_approval_action_id: created.approvalActionId,
        p_idempotency_key: `fan-in:${created.actionId}`,
        p_request_fingerprint: `fan-in:${created.actionId}`,
        p_approved_max_cost_usd: 0.4,
        p_approval_fingerprint: created.approvalFingerprint,
      });
      noError(admitted.error, "fan-in admission");
      const execution = admitted.data[0];
      const lease = await f.service.rpc("claim_rerun_execution_lease", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_seconds: 60,
      });
      noError(lease.error, "fan-in lease");
      const dispatchActionId = randomUUID();
      const tokens = [randomUUID(), randomUUID()];
      const workRequest = {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_request_fingerprint: `fan-in-work:${created.actionId}`,
        p_dispatch_action_id: dispatchActionId,
        p_dispatch_params: {},
        p_callback_fences: outputs.map((output, index) => ({
          executorId: `fake:step-${index}`,
          tokenHash: callbackTokenHash(tokens[index]!),
          generation: 1,
          requiredOutputs: [output],
        })),
      };
      noError((await f.service.rpc("reserve_rerun_work_item", workRequest)).error,
        "reserve fan-in work");
      const reconciliationActionId = randomUUID();
      noError((await f.service.from("actions").insert({
        id: reconciliationActionId,
        project_id: f.projectId,
        orchestrator_run_id: execution.root_run_id,
        tool: "rerun_reconciliation",
        status: "applied",
        params: {
          schemaVersion: "RerunReconciliation.v1",
          proposalActionId: created.actionId,
          executionReservationId: execution.reservation_id,
          workItemId,
        },
        input_asset_ids: [],
        output_asset_ids: [],
        job_ids: [],
      })).error, "step reconciliation");
      const bindings: Record<string, unknown>[] = [];
      const primitiveIds: string[] = [];
      const budgetKeys: string[] = [];
      for (const [index, output] of outputs.entries()) {
        const childRunId = randomUUID();
        const child = await f.service.rpc("create_domain_run_dispatch", {
          p_idempotency_scope: `fan-in:${execution.reservation_id}`,
          p_idempotency_key: `step-${index}`,
          p_request_hash: `step-${index}`,
          p_run_id: childRunId,
          p_project_id: f.projectId,
          p_domain: "visuals",
          p_input_summary: `Fan-in child ${index}`,
          p_budget_usd: 0.2,
          p_task_kind: "visuals_revision",
          p_task_params: {
            schemaVersion: "DomainTask.v1",
            domain: "visuals",
            taskKind: "visuals_revision",
            objective: `Produce step ${index}.`,
            instruction: `Produce step ${index}.`,
            targets: [{ kind: "project", projectId: f.projectId }],
            requiredOutputs: [output],
            allowedOutputKinds: ["image"],
            creativeConstraints: {},
            preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
            candidateAffectedAssetIds: [],
            budgetUsd: 0.2,
            approvalContext: {
              proposalActionId: created.actionId,
              approvalActionId: created.approvalActionId,
              executionReservationId: execution.reservation_id,
              approvedBudgetUsd: 0.4,
              approvalFingerprint: created.approvalFingerprint,
            },
            acceptanceCriteria: [],
            origin: {
              kind: "creative_director",
              rootRunId: execution.root_run_id,
              rootActionId: dispatchActionId,
              creatorMessageId: "integration",
            },
            responseRecipient: { kind: "creative_director" },
          },
          p_origin_kind: "creative_director",
          p_parent_run_id: execution.root_run_id,
          p_root_action_id: dispatchActionId,
          p_origin_actor_id: null,
          p_origin_request: null,
          p_continues_run_id: null,
          p_pins: null,
          p_gate_stage: null,
          p_enqueue: false,
          p_max_children_per_root: 20,
          p_max_continuation_chain: 10,
          p_max_session_turns: 20,
          p_max_blocked_reports_per_requirement: 3,
        });
        noError(child.error, `create child ${index}`);
        const assetId = randomUUID();
        noError((await f.service.from("assets").insert({
          id: assetId,
          workspace_id: f.workspaceId,
          project_id: f.projectId,
          kind: "image",
          media: "image",
          role: output.role,
          filename: `step-${index}.png`,
          source: {},
        })).error, `asset ${index}`);
        const primitiveActionId = randomUUID();
        noError((await f.service.from("actions").insert({
          id: primitiveActionId,
          project_id: f.projectId,
          orchestrator_run_id: childRunId,
          tool: "generate_image",
          status: "applied",
          params: { schema_version: "action_params.v1" },
          input_asset_ids: [],
          output_asset_ids: [assetId],
          job_ids: [],
        })).error, `primitive ${index}`);
        noError((await f.service.from("action_assets").insert({
          project_id: f.projectId,
          action_id: primitiveActionId,
          asset_id: assetId,
          direction: "output",
          role: output.role,
          ordinal: 0,
        })).error, `primitive attribution ${index}`);
        const budgetKey = `fan-in-budget:${created.actionId}:${index}`;
        noError((await f.service.rpc("reserve_rerun_child_budget", {
          p_project_id: f.projectId,
          p_execution_reservation_id: execution.reservation_id,
          p_work_item_id: workItemId,
          p_child_run_id: childRunId,
          p_action_id: primitiveActionId,
          p_job_id: null,
          p_reservation_key: budgetKey,
          p_estimated_usd: 0.2,
        })).error, `child budget ${index}`);
        noError((await f.service.rpc("settle_orchestrator_run_budget", {
          p_project_id: f.projectId,
          p_reservation_key: budgetKey,
          p_actual_usd: 0.1,
          p_billing_user_id: null,
          p_billable_usd: 0,
        })).error, `settle child budget ${index}`);
        const binding = {
          ...output,
          assetId,
          intrinsicRole: output.role,
        };
        bindings.push(binding);
        const reportActionId = randomUUID();
        noError((await f.service.from("actions").insert({
          id: reportActionId,
          project_id: f.projectId,
          orchestrator_run_id: childRunId,
          tool: "domain_report",
          status: "applied",
          params: {
            schemaVersion: "DomainReport.v1",
            outcome: { outputs: [binding] },
          },
          input_asset_ids: [],
          output_asset_ids: [assetId],
          job_ids: [],
        })).error, `report ${index}`);
        noError((await f.service.from("orchestrator_runs").update({
          status: "succeeded",
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }).eq("id", childRunId)).error, `complete child ${index}`);
        primitiveIds.push(primitiveActionId);
        budgetKeys.push(budgetKey);
        noError((await f.service.rpc("park_rerun_work_item", {
          p_project_id: f.projectId,
          p_reservation_id: execution.reservation_id,
          p_lease_token: lease.data[0].lease_token,
          p_lease_generation: lease.data[0].lease_generation,
          p_work_item_id: workItemId,
          p_accepted_callbacks: null,
          p_completed_callbacks: [{
            executorId: `fake:step-${index}`,
            tokenHash: callbackTokenHash(tokens[index]!),
            generation: 1,
            result: {
              outputs: [binding],
              childRunId,
              reportActionId,
              ...(index === 1 ? { reconciliationActionId } : {}),
              primitiveActionIds: [primitiveActionId],
              budgetReservationKeys: [budgetKey],
            },
          }],
          p_blocked_precondition: null,
          p_partial_binding_results: bindings,
          p_primitive_action_ids: [primitiveActionId],
          p_budget_reservation_keys: [budgetKey],
        })).error, `persist step ${index}`);
        if (index === 0) {
          const crashReplay = await f.service.rpc("reserve_rerun_work_item", workRequest);
          noError(crashReplay.error, "crash replay after first step");
          assert.equal(crashReplay.data[0].callback_results[0].status, "completed");
          assert.equal(crashReplay.data[0].callback_results[1].status, "pending");
          assert.equal(crashReplay.data[0].callback_results[0].result.childRunId, childRunId);
        }
      }
      noError((await f.service.rpc("complete_rerun_work_item", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_work_item_id: workItemId,
        p_child_run_id: null,
        p_report_action_id: null,
        p_reconciliation_action_id: reconciliationActionId,
        p_binding_results: bindings,
        p_primitive_action_ids: primitiveIds,
        p_budget_reservation_keys: budgetKeys,
      })).error, "complete step fan-in");
      const executionActionId = randomUUID();
      noError((await f.service.rpc("finalize_rerun_execution", {
        p_project_id: f.projectId,
        p_reservation_id: execution.reservation_id,
        p_lease_token: lease.data[0].lease_token,
        p_lease_generation: lease.data[0].lease_generation,
        p_execution_action_id: executionActionId,
        p_outcome: "applied",
        p_reconciliation_action_id: reconciliationActionId,
        p_error: null,
      })).error, "finalize step fan-in");
      const { data: terminalExecution } = await f.service
        .from("rerun_execution_reservations")
        .select("status, execution_result_action_id")
        .eq("id", execution.reservation_id)
        .single();
      assert.equal(terminalExecution?.status, "completed");
      assert.equal(terminalExecution?.execution_result_action_id, executionActionId);
    } finally {
      await f.cleanup();
    }
  }
);
