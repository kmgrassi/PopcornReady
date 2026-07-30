import type {
  RerunProposalLifecycleStatus,
  RerunProposalV2,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import { getServiceSupabaseForStore } from "./store";
import { unmarkedJson } from "./store-internal";
import {
  databaseError,
  type SupabaseErrorLike,
  type SupabaseResult,
} from "@/lib/supabase/db-errors";

async function runLifecycleQuery<T>(
  operation: string,
  query: PromiseLike<SupabaseResult<T>>
): Promise<T> {
  const { data, error } = await query;
  if (!error) return data;
  const message = `${error.message ?? ""} ${error.details ?? ""}`;
  if (message.includes("stale_proposal")) {
    throw new ApiError("stale_proposal", "Proposal inputs changed; refresh before continuing.");
  }
  if (
    message.includes("replay_mismatch") ||
    message.includes("idempotency_conflict") ||
    message.includes("unique constraint")
  ) {
    throw new ApiError("idempotency_conflict", "Idempotency key was reused with different input.");
  }
  if (
    message.includes("lease_unavailable") ||
    message.includes("stale_rerun_execution_lease")
  ) {
    throw new ApiError("idempotency_in_progress", "Another execution worker owns the active lease.");
  }
  if (message.includes("budget") || message.includes("ceiling_exhausted")) {
    throw new ApiError("budget_exceeded", "The approved or root budget cannot admit this work.");
  }
  if (error.code === "P0002") {
    throw new ApiError("not_found", "Proposal lifecycle record was not found.");
  }
  throw databaseError(operation, error as SupabaseErrorLike);
}

export interface RerunProposalActionRecord {
  id: string;
  projectId: string;
  rootRunId: string | null;
  status: RerunProposalLifecycleStatus;
  params: Record<string, unknown>;
  proposal: RerunProposalV2;
  inputAssetIds: string[];
  rationale: string | null;
}

interface ActionRow {
  id: string;
  project_id: string;
  orchestrator_run_id: string | null;
  tool: string;
  status: RerunProposalLifecycleStatus;
  params: Record<string, unknown>;
  proposal: Record<string, unknown> | null;
  input_asset_ids: string[];
  rationale: string | null;
}

function mapProposalAction(row: ActionRow): RerunProposalActionRecord {
  const proposal = unmarkedJson(row.proposal) as RerunProposalV2 | undefined;
  if (
    row.tool !== "rerun_proposal" ||
    !proposal ||
    proposal.schemaVersion !== "RerunProposal.v2"
  ) {
    throw new ApiError("validation_failed", "Action is not a RerunProposal.v2 envelope.");
  }
  return {
    id: row.id,
    projectId: row.project_id,
    rootRunId: row.orchestrator_run_id,
    status: row.status,
    params: unmarkedJson(row.params) ?? {},
    proposal,
    inputAssetIds: row.input_asset_ids,
    rationale: row.rationale,
  };
}

export async function getRerunProposalAction(input: {
  projectId: string;
  actionId: string;
}): Promise<RerunProposalActionRecord> {
  const db = getServiceSupabaseForStore();
  const row = await runLifecycleQuery(
    "rerunLifecycleStore.getProposal",
    db.from("actions").select(
      "id, project_id, orchestrator_run_id, tool, status, params, proposal, input_asset_ids, rationale"
    ).eq("id", input.actionId).eq("project_id", input.projectId).maybeSingle()
  ) as ActionRow | null;
  if (!row) throw new ApiError("not_found", `Rerun proposal not found: ${input.actionId}`);
  return mapProposalAction(row);
}

export async function getRerunProposalSuccessor(input: {
  projectId: string;
  priorActionId: string;
  requestFingerprint: string;
  cause: "refresh" | "clarification_answer";
}): Promise<RerunProposalActionRecord | null> {
  const db = getServiceSupabaseForStore();
  const link = await runLifecycleQuery(
    "rerunLifecycleStore.getSuccessor link",
    db.from("rerun_proposal_successors")
      .select("successor_proposal_action_id, request_fingerprint, cause")
      .eq("project_id", input.projectId)
      .eq("prior_proposal_action_id", input.priorActionId)
      .maybeSingle()
  ) as {
    successor_proposal_action_id: string;
    request_fingerprint: string;
    cause: string;
  } | null;
  if (!link) return null;
  if (
    link.request_fingerprint !== input.requestFingerprint ||
    link.cause !== input.cause
  ) {
    throw new ApiError(
      "idempotency_conflict",
      "This proposal already has a successor for different refresh input."
    );
  }
  return getRerunProposalAction({
    projectId: input.projectId,
    actionId: link.successor_proposal_action_id,
  });
}

export async function assertRerunProposalAuthority(
  action: RerunProposalActionRecord
): Promise<void> {
  if (
    action.proposal.projectId !== action.projectId ||
    action.proposal.rootRunId !== action.rootRunId ||
    action.proposal.targets.some((target) => target.projectId !== action.projectId) ||
    action.proposal.selectedWork.some((work) =>
      work.targets.some((target) => target.projectId !== action.projectId) ||
      work.requiredOutputs.some((output) =>
        output.workItemId !== work.workItemId ||
        output.target.projectId !== action.projectId))
  ) {
    throw new ApiError("validation_failed", "Proposal membership crosses its project boundary.");
  }
  const db = getServiceSupabaseForStore();
  if (!action.rootRunId) return;
  const root = await runLifecycleQuery(
    "rerunLifecycleStore.assertAuthority root",
    db.from("orchestrator_runs")
      .select("id, project_id, agent_role, root_execution_profile")
      .eq("id", action.rootRunId)
      .eq("project_id", action.projectId)
      .maybeSingle()
  ) as {
    id: string;
    project_id: string;
    agent_role: string;
    root_execution_profile: string | null;
  } | null;
  if (
    !root ||
    root.agent_role !== "creative_director" ||
    root.root_execution_profile !== "creative_director"
  ) {
    throw new ApiError("validation_failed", "Proposal root is not an authorized Creative Director root.");
  }
}

export async function assertRerunProposalFresh(
  action: RerunProposalActionRecord
): Promise<void> {
  const db = getServiceSupabaseForStore();
  const assetPins = action.proposal.pins.assets;
  if (assetPins.length > 0) {
    const rows = await runLifecycleQuery(
      "rerunLifecycleStore.fresh assets",
      db.from("assets").select("id, project_id, content_hash, inputs_fingerprint")
        .eq("project_id", action.projectId)
        .in("id", assetPins.map((pin) => pin.assetId))
    ) as Array<{
      id: string;
      project_id: string;
      content_hash: string | null;
      inputs_fingerprint: string | null;
    }>;
    if (
      rows.length !== assetPins.length ||
      assetPins.some((pin) => {
        const row = rows.find((candidate) => candidate.id === pin.assetId);
        return !row ||
          row.content_hash !== pin.contentHash ||
          row.inputs_fingerprint !== pin.inputsFingerprint;
      })
    ) {
      throw new ApiError("stale_proposal", "An asset fingerprint changed after proposal creation.");
    }
  }
  for (const pin of action.proposal.pins.selections) {
    let query = db.from("current_selections")
      .select("slot_owner_lineage_id, slot_role, active_asset_id, seq")
      .eq("project_id", action.projectId)
      .eq("slot_role", pin.slotRole);
    query = pin.slotOwnerLineageId === null
      ? query.is("slot_owner_lineage_id", null)
      : query.eq("slot_owner_lineage_id", pin.slotOwnerLineageId);
    const row = await runLifecycleQuery(
      "rerunLifecycleStore.fresh selection",
      query.maybeSingle()
    ) as { active_asset_id: string; seq: number } | null;
    if (
      (row?.active_asset_id ?? null) !== pin.expectedActiveAssetId ||
      (row?.seq ?? 0) !== pin.expectedSeq
    ) {
      throw new ApiError("stale_proposal", "A selection moved after proposal creation.");
    }
  }
  const storyTables = {
    storyboard: ["story_blueprints", "provenance"],
    story_blueprint: ["story_blueprints", "asset_id"],
    story_scene: ["story_blueprint_scenes", "scene_asset_id"],
    story_beat: ["story_beats", "beat_asset_id"],
  } as const;
  for (const pin of action.proposal.pins.storySnapshots) {
    const [table, column] = storyTables[pin.rowKind];
    const row = await runLifecycleQuery(
      `rerunLifecycleStore.fresh ${pin.rowKind}`,
      db.from(table).select(`id, project_id, ${column}`)
        .eq("id", pin.rowId).eq("project_id", action.projectId).maybeSingle()
    ) as Record<string, unknown> | null;
    const currentSnapshotAssetId = pin.rowKind === "storyboard"
      ? ((row?.provenance as { planAssetId?: string } | undefined)?.planAssetId ?? null)
      : (row?.[column] ?? null);
    if (!row || currentSnapshotAssetId !== pin.expectedSnapshotAssetId) {
      throw new ApiError("stale_proposal", "A story snapshot moved after proposal creation.");
    }
  }
}

export async function approveRerunProposal(input: {
  projectId: string;
  proposalActionId: string;
  approvalActionId: string;
  actorId: string;
  approvedMaxCostUsd: number;
  approvalFingerprint: string;
  autonomous: boolean;
}) {
  const rows = await runLifecycleQuery(
    "rerunLifecycleStore.approve",
    getServiceSupabaseForStore().rpc("approve_rerun_proposal", {
      p_project_id: input.projectId,
      p_proposal_action_id: input.proposalActionId,
      p_approval_action_id: input.approvalActionId,
      p_actor_id: input.actorId,
      p_approved_max_cost_usd: input.approvedMaxCostUsd,
      p_approval_fingerprint: input.approvalFingerprint,
      p_autonomous: input.autonomous,
    })
  ) as Array<{
    proposal_status: RerunProposalLifecycleStatus;
    approval_action_id: string | null;
    replayed: boolean;
    stale: boolean;
  }>;
  return rows[0]!;
}

export async function getRerunProposalApproval(input: {
  projectId: string;
  proposalActionId: string;
}): Promise<{
  approvalActionId: string;
  approvedMaxCostUsd: number;
  approvalFingerprint: string;
} | null> {
  const row = await runLifecycleQuery(
    "rerunLifecycleStore.getApproval",
    getServiceSupabaseForStore().from("actions")
      .select("id, params")
      .eq("project_id", input.projectId)
      .eq("tool", "rerun_proposal_approval")
      .eq("params->>proposalActionId", input.proposalActionId)
      .maybeSingle()
  ) as { id: string; params: Record<string, unknown> } | null;
  if (!row) return null;
  const params = unmarkedJson(row.params) ?? {};
  return {
    approvalActionId: row.id,
    approvedMaxCostUsd: Number(params.approvedMaxCostUsd),
    approvalFingerprint: String(params.approvalFingerprint),
  };
}

export async function rejectRerunProposal(input: {
  projectId: string;
  proposalActionId: string;
}) {
  return runLifecycleQuery(
    "rerunLifecycleStore.reject",
    getServiceSupabaseForStore().rpc("reject_rerun_proposal", {
      p_project_id: input.projectId,
      p_proposal_action_id: input.proposalActionId,
    })
  ) as Promise<RerunProposalLifecycleStatus>;
}

export async function createRerunProposalSuccessor(input: {
  projectId: string;
  priorActionId: string;
  successorActionId: string;
  requestFingerprint: string;
  cause: "refresh" | "clarification_answer";
  rootRunId: string | null;
  params: Record<string, unknown>;
  proposal: RerunProposalV2;
  inputAssetIds: string[];
  rationale: string;
}) {
  const rows = await runLifecycleQuery(
    "rerunLifecycleStore.createSuccessor",
    getServiceSupabaseForStore().rpc("create_rerun_proposal_successor", {
      p_project_id: input.projectId,
      p_prior_action_id: input.priorActionId,
      p_successor_action_id: input.successorActionId,
      p_request_fingerprint: input.requestFingerprint,
      p_cause: input.cause,
      p_orchestrator_run_id: input.rootRunId,
      p_params: input.params,
      p_proposal: input.proposal,
      p_input_asset_ids: input.inputAssetIds,
      p_rationale: input.rationale,
      p_successor_status: input.proposal.outcome === "no_op" ? "applied" : "proposed",
    })
  ) as Array<{ successor_action_id: string; replayed: boolean }>;
  return rows[0]!;
}

export interface RerunLease {
  reservationId: string;
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
}

export async function reserveRerunExecution(input: {
  projectId: string;
  proposalActionId: string;
  approvalActionId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  approvedMaxCostUsd: number;
  approvalFingerprint: string;
}) {
  const rows = await runLifecycleQuery(
    "rerunLifecycleStore.reserveExecution",
    getServiceSupabaseForStore().rpc("reserve_rerun_proposal_execution", {
      p_project_id: input.projectId,
      p_proposal_action_id: input.proposalActionId,
      p_approval_action_id: input.approvalActionId,
      p_idempotency_key: input.idempotencyKey,
      p_request_fingerprint: input.requestFingerprint,
      p_approved_max_cost_usd: input.approvedMaxCostUsd,
      p_approval_fingerprint: input.approvalFingerprint,
    })
  ) as Array<{
    reservation_id: string | null;
    budget_reservation_id: string | null;
    root_run_id: string | null;
    status: string;
    lease_generation: number;
    execution_result_action_id: string | null;
    replayed: boolean;
  }>;
  return rows[0]!;
}

export async function claimRerunExecution(input: {
  projectId: string;
  reservationId: string;
}): Promise<RerunLease | null> {
  const rows = await runLifecycleQuery(
    "rerunLifecycleStore.claimExecution",
    getServiceSupabaseForStore().rpc("claim_rerun_execution_lease", {
      p_project_id: input.projectId,
      p_reservation_id: input.reservationId,
      p_lease_seconds: 60,
    })
  ) as Array<{
    reservation_id: string;
    lease_token: string | null;
    lease_generation: number;
    lease_expires_at: string | null;
    parked: boolean;
  }>;
  const row = rows[0]!;
  if (row.parked) return null;
  if (!row.lease_token || !row.lease_expires_at) {
    throw new ApiError("internal_error", "Claimed execution lease is incomplete.");
  }
  return {
    reservationId: row.reservation_id,
    leaseToken: row.lease_token,
    leaseGeneration: row.lease_generation,
    leaseExpiresAt: row.lease_expires_at,
  };
}

export async function renewRerunExecution(input: {
  projectId: string;
  lease: RerunLease;
}): Promise<RerunLease> {
  const leaseExpiresAt = await runLifecycleQuery(
    "rerunLifecycleStore.renewExecution",
    getServiceSupabaseForStore().rpc("renew_rerun_execution_lease", {
      p_project_id: input.projectId,
      p_reservation_id: input.lease.reservationId,
      p_lease_token: input.lease.leaseToken,
      p_lease_generation: input.lease.leaseGeneration,
      p_lease_seconds: 60,
    })
  ) as string;
  return { ...input.lease, leaseExpiresAt };
}

export async function reserveRerunWorkItem(input: {
  projectId: string;
  lease: RerunLease;
  workItemId: string;
  requestFingerprint: string;
  dispatchActionId: string;
  dispatchParams: Record<string, unknown>;
  callbackFences: Array<{
    executorId: string;
    tokenHash: string;
    generation: number;
    requiredOutputs: unknown[];
  }>;
}) {
  const rows = await runLifecycleQuery(
    "rerunLifecycleStore.reserveWork",
    getServiceSupabaseForStore().rpc("reserve_rerun_work_item", {
      p_project_id: input.projectId,
      p_reservation_id: input.lease.reservationId,
      p_lease_token: input.lease.leaseToken,
      p_lease_generation: input.lease.leaseGeneration,
      p_work_item_id: input.workItemId,
      p_request_fingerprint: input.requestFingerprint,
      p_dispatch_action_id: input.dispatchActionId,
      p_dispatch_params: input.dispatchParams,
      p_callback_fences: input.callbackFences,
    })
  ) as Array<{
    work_reservation_id: string;
    work_status: "reserved" | "running" | "completed" | "failed" | "canceled";
    child_run_id: string | null;
    report_action_id: string | null;
    reconciliation_action_id: string | null;
    binding_results: unknown[] | null;
    primitive_action_ids: string[] | null;
    budget_reservation_keys: string[] | null;
    callback_results: Array<{
      executorId: string;
      status: "completed" | "failed" | "canceled" | "pending";
      result: {
        outputs?: unknown[];
        childRunId?: string;
        reportActionId?: string;
        reconciliationActionId?: string;
        primitiveActionIds?: string[];
        budgetReservationKeys?: string[];
      } | null;
      jobIds: string[];
    }>;
    replayed: boolean;
  }>;
  return rows[0]!;
}

export async function completeRerunWorkItem(input: {
  projectId: string;
  lease: RerunLease;
  workItemId: string;
  childRunId?: string;
  reportActionId?: string;
  reconciliationActionId?: string;
  bindingResults: unknown[];
  primitiveActionIds: string[];
  budgetReservationKeys: string[];
}): Promise<void> {
  await runLifecycleQuery(
    "rerunLifecycleStore.completeWork",
    getServiceSupabaseForStore().rpc("complete_rerun_work_item", {
      p_project_id: input.projectId,
      p_reservation_id: input.lease.reservationId,
      p_lease_token: input.lease.leaseToken,
      p_lease_generation: input.lease.leaseGeneration,
      p_work_item_id: input.workItemId,
      p_child_run_id: input.childRunId ?? null,
      p_report_action_id: input.reportActionId ?? null,
      p_reconciliation_action_id: input.reconciliationActionId ?? null,
      p_binding_results: input.bindingResults,
      p_primitive_action_ids: input.primitiveActionIds,
      p_budget_reservation_keys: input.budgetReservationKeys,
    })
  );
}

export async function parkRerunWorkItem(input: {
  projectId: string;
  lease: RerunLease;
  workItemId: string;
  acceptedCallbacks?: Array<{
    executorId: string;
    tokenHash: string;
    generation: number;
    jobIds: string[];
  }>;
  completedCallbacks?: Array<{
    executorId: string;
    tokenHash: string;
    generation: number;
    result: Record<string, unknown>;
  }>;
  blockedPrecondition?: Record<string, unknown>;
  primitiveActionIds: string[];
  budgetReservationKeys: string[];
  bindingResults: unknown[];
}): Promise<void> {
  await runLifecycleQuery(
    "rerunLifecycleStore.parkWork",
    getServiceSupabaseForStore().rpc("park_rerun_work_item", {
      p_project_id: input.projectId,
      p_reservation_id: input.lease.reservationId,
      p_lease_token: input.lease.leaseToken,
      p_lease_generation: input.lease.leaseGeneration,
      p_work_item_id: input.workItemId,
      p_accepted_callbacks: input.acceptedCallbacks ?? null,
      p_completed_callbacks: input.completedCallbacks ?? null,
      p_blocked_precondition: input.blockedPrecondition ?? null,
      p_primitive_action_ids: input.primitiveActionIds,
      p_budget_reservation_keys: input.budgetReservationKeys,
      p_partial_binding_results: input.bindingResults,
    })
  );
}

export async function parkRerunExecution(input: {
  projectId: string;
  lease: RerunLease;
}): Promise<void> {
  await runLifecycleQuery(
    "rerunLifecycleStore.parkExecution",
    getServiceSupabaseForStore().rpc("park_rerun_execution", {
      p_project_id: input.projectId,
      p_reservation_id: input.lease.reservationId,
      p_lease_token: input.lease.leaseToken,
      p_lease_generation: input.lease.leaseGeneration,
    })
  );
}

export async function recordRerunExecutorCallback(input: {
  projectId: string;
  reservationId: string;
  workItemId: string;
  executorId: string;
  callbackToken: string;
  callbackGeneration: number;
  outcome: "completed" | "failed";
  result: Record<string, unknown>;
}): Promise<boolean> {
  return runLifecycleQuery(
    "rerunLifecycleStore.recordCallback",
    getServiceSupabaseForStore().rpc("record_rerun_executor_callback", {
      p_project_id: input.projectId,
      p_reservation_id: input.reservationId,
      p_work_item_id: input.workItemId,
      p_executor_id: input.executorId,
      p_callback_token: input.callbackToken,
      p_callback_generation: input.callbackGeneration,
      p_outcome: input.outcome,
      p_result: input.result,
    })
  ) as Promise<boolean>;
}

export async function reserveRerunChildBudget(input: {
  projectId: string;
  executionReservationId: string;
  workItemId: string;
  actionId: string;
  childRunId?: string;
  jobId?: string;
  reservationKey: string;
  estimatedUsd: number;
}): Promise<{ reservationId: string; replayed: boolean }> {
  const rows = await runLifecycleQuery(
    "rerunLifecycleStore.reserveChildBudget",
    getServiceSupabaseForStore().rpc("reserve_rerun_child_budget", {
      p_project_id: input.projectId,
      p_execution_reservation_id: input.executionReservationId,
      p_work_item_id: input.workItemId,
      p_action_id: input.actionId,
      p_child_run_id: input.childRunId ?? null,
      p_job_id: input.jobId ?? null,
      p_reservation_key: input.reservationKey,
      p_estimated_usd: input.estimatedUsd,
    })
  ) as Array<{ reservation_id: string; replayed: boolean }>;
  const row = rows[0]!;
  return { reservationId: row.reservation_id, replayed: row.replayed };
}

export async function listCompletedRerunBindings(input: {
  projectId: string;
  executionReservationId: string;
}): Promise<unknown[]> {
  const rows = await runLifecycleQuery(
    "rerunLifecycleStore.listCompletedBindings",
    getServiceSupabaseForStore().from("rerun_execution_work_items")
      .select("binding_results")
      .eq("project_id", input.projectId)
      .eq("execution_reservation_id", input.executionReservationId)
      .eq("status", "completed")
  ) as Array<{ binding_results: unknown[] | null }>;
  return rows.flatMap((row) => row.binding_results ?? []);
}

export async function failRerunWorkItem(input: {
  projectId: string;
  lease: RerunLease;
  workItemId: string;
  error: Record<string, unknown>;
}): Promise<void> {
  await runLifecycleQuery(
    "rerunLifecycleStore.failWork",
    getServiceSupabaseForStore().rpc("fail_rerun_work_item", {
      p_project_id: input.projectId,
      p_reservation_id: input.lease.reservationId,
      p_lease_token: input.lease.leaseToken,
      p_lease_generation: input.lease.leaseGeneration,
      p_work_item_id: input.workItemId,
      p_error: input.error,
    })
  );
}

export async function finalizeRerunExecution(input: {
  projectId: string;
  lease: RerunLease;
  executionActionId: string;
  outcome: "applied" | "failed";
  reconciliationActionId?: string;
  error?: Record<string, unknown>;
}): Promise<string> {
  return runLifecycleQuery(
    "rerunLifecycleStore.finalize",
    getServiceSupabaseForStore().rpc("finalize_rerun_execution", {
      p_project_id: input.projectId,
      p_reservation_id: input.lease.reservationId,
      p_lease_token: input.lease.leaseToken,
      p_lease_generation: input.lease.leaseGeneration,
      p_execution_action_id: input.executionActionId,
      p_outcome: input.outcome,
      p_reconciliation_action_id: input.reconciliationActionId ?? null,
      p_error: input.error ?? null,
    })
  ) as Promise<string>;
}

export async function cancelRerunExecution(input: {
  projectId: string;
  proposalActionId: string;
  executionActionId: string;
  reason: string;
}): Promise<string> {
  return runLifecycleQuery(
    "rerunLifecycleStore.cancel",
    getServiceSupabaseForStore().rpc("cancel_rerun_execution", {
      p_project_id: input.projectId,
      p_proposal_action_id: input.proposalActionId,
      p_execution_action_id: input.executionActionId,
      p_reason: input.reason,
    })
  ) as Promise<string>;
}
