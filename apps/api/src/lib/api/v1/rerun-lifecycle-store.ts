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
import { withTransaction } from "@/lib/postgres/transactions";
import {
  cancelExecutionTransaction,
  claimExecutionTransaction,
  finalizeExecutionTransaction,
  parkExecutionTransaction,
  renewExecutionTransaction,
  reserveExecutionTransaction,
} from "@/lib/postgres/rerun-execution-transactions";
import {
  completeWorkTransaction,
  failWorkTransaction,
  parkWorkTransaction,
  listReadyRerunExecutionResumes,
  recordCallbackTransaction,
  reserveChildBudgetTransaction,
  reserveWorkTransaction,
} from "@/lib/postgres/rerun-work-transactions";

export { listReadyRerunExecutionResumes };
import {
  approveRerunProposalTransaction,
  createRerunProposalSuccessorDirectTransaction,
  rejectRerunProposalTransaction,
} from "@/lib/postgres/rerun-proposal-transactions";

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
  failure: { code: string; message: string } | null;
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
  error: Record<string, unknown> | null;
}

export function normalizeRerunExecutionFailure(
  value: unknown
): { code: string; message: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawError = unmarkedJson(value as Record<string, unknown>) ?? {};
  const code =
    typeof rawError.code === "string"
      ? rawError.code
      : typeof rawError.kind === "string"
        ? rawError.kind
        : "rerun_execution_failed";
  const messages: Record<string, string> = {
    stale_proposal:
      "The selected work changed before the requested changes could be applied.",
    budget_exceeded:
      "The requested changes could not finish within the approved maximum cost.",
    execution_canceled: "The requested changes were canceled.",
    executor_failed:
      "A generation step could not complete the requested changes.",
    provider_quota:
      "A generation provider could not complete the requested changes right now.",
    reconciliation_failed:
      "The generated changes could not be safely applied to the project.",
  };
  return {
    code,
    message: messages[code] ?? "The requested changes could not be completed.",
  };
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
    failure: normalizeRerunExecutionFailure(row.error),
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
      "id, project_id, orchestrator_run_id, tool, status, params, proposal, input_asset_ids, rationale, error"
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
      .select("id, project_id, agent_role")
      .eq("id", action.rootRunId)
      .eq("project_id", action.projectId)
      .maybeSingle()
  ) as {
    id: string;
    project_id: string;
    agent_role: string;
  } | null;
  if (
    !root ||
    root.agent_role !== "creative_director"
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
  for (const pin of action.proposal.pins.storySnapshots) {
    const query = pin.rowKind === "storyboard"
      ? db.from("story_blueprints").select("id, project_id, provenance")
      : pin.rowKind === "story_blueprint"
        ? db.from("story_blueprints").select("id, project_id, asset_id")
        : pin.rowKind === "story_scene"
          ? db.from("story_blueprint_scenes")
            .select("id, project_id, story_snapshot_asset_id")
          : db.from("story_beats").select("id, project_id, beat_asset_id");
    const row = await runLifecycleQuery(
      `rerunLifecycleStore.fresh ${pin.rowKind}`,
      query
        .eq("id", pin.rowId).eq("project_id", action.projectId).maybeSingle()
    ) as Record<string, unknown> | null;
    const currentSnapshotAssetId = pin.rowKind === "storyboard"
      ? ((row?.provenance as { planAssetId?: string } | undefined)?.planAssetId ?? null)
      : pin.rowKind === "story_blueprint"
        ? (row?.asset_id ?? null)
        : pin.rowKind === "story_scene"
          ? (row?.story_snapshot_asset_id ?? null)
          : (row?.beat_asset_id ?? null);
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
  return approveRerunProposalTransaction(input);
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

interface RerunExecutionRow {
  id: string;
  status:
    | "reserved"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "canceled";
  execution_result_action_id: string | null;
  updated_at: string;
}

interface RerunExecutionReadDeps {
  getReservation: (input: {
    projectId: string;
    proposalActionId: string;
  }) => Promise<RerunExecutionRow | null>;
  getExecutionAction: (input: {
    projectId: string;
    executionActionId: string;
  }) => Promise<{ error: Record<string, unknown> | null } | null>;
}

export async function getLatestRerunExecution(
  input: {
    projectId: string;
    proposalActionId: string;
  },
  overrides: Partial<RerunExecutionReadDeps> = {}
): Promise<{
  reservationId: string;
  status:
    | "reserved"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "canceled";
  executionActionId: string | null;
  updatedAt: string;
  failure: { code: string; message: string } | null;
} | null> {
  const getReservation = overrides.getReservation ?? (async (request) => {
    const db = getServiceSupabaseForStore();
    return runLifecycleQuery(
      "rerunLifecycleStore.getExecution",
      db.from("rerun_execution_reservations")
        .select("id, status, execution_result_action_id, updated_at")
        .eq("project_id", request.projectId)
        .eq("proposal_action_id", request.proposalActionId)
        .maybeSingle()
    ) as Promise<RerunExecutionRow | null>;
  });
  const getExecutionAction = overrides.getExecutionAction ?? (async (request) => {
    const db = getServiceSupabaseForStore();
    return runLifecycleQuery(
      "rerunLifecycleStore.getExecution result",
      db.from("actions")
        .select("error")
        .eq("id", request.executionActionId)
        .eq("project_id", request.projectId)
        .eq("tool", "rerun_execution")
        .maybeSingle()
    ) as Promise<{ error: Record<string, unknown> | null } | null>;
  });
  const row = await getReservation(input);
  if (!row) return null;
  const executionAction = row.execution_result_action_id
    ? await getExecutionAction({
        projectId: input.projectId,
        executionActionId: row.execution_result_action_id,
      })
    : null;
  const failure = normalizeRerunExecutionFailure(executionAction?.error);
  const canceled =
    row.status === "canceled" || failure?.code === "execution_canceled";
  return {
    reservationId: row.id,
    status: canceled ? "canceled" : row.status,
    executionActionId: row.execution_result_action_id,
    updatedAt: row.updated_at,
    failure: canceled ? null : failure,
  };
}

export async function rejectRerunProposal(input: {
  projectId: string;
  proposalActionId: string;
}) {
  return rejectRerunProposalTransaction(input);
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
  return createRerunProposalSuccessorDirectTransaction(input);
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
  return reserveExecutionTransaction(input);
}

export async function claimRerunExecution(input: {
  projectId: string;
  reservationId: string;
}): Promise<RerunLease | null> {
  return claimExecutionTransaction(input);
}

export async function renewRerunExecution(input: {
  projectId: string;
  lease: RerunLease;
}): Promise<RerunLease> {
  return renewExecutionTransaction(input);
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
}): Promise<{
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
}> {
  return reserveWorkTransaction(input);
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
  await completeWorkTransaction(input);
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
  await parkWorkTransaction(input);
}

export async function parkRerunExecution(input: {
  projectId: string;
  lease: RerunLease;
}): Promise<void> {
  await parkExecutionTransaction(input);
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
  return recordCallbackTransaction(input);
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
  return reserveChildBudgetTransaction(input);
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

export async function ensureRerunReconciliation(input: {
  projectId: string;
  proposalActionId: string;
  rootRunId: string;
  lease: RerunLease;
  reconciliationActionId: string;
}): Promise<string> {
  return withTransaction(
    "rerunLifecycleStore.ensureReconciliation",
    async (client) => {
      const execution = await client.query<{
        proposal_action_id: string;
        root_run_id: string;
        status: string;
      }>(
        `select proposal_action_id, root_run_id, status
           from public.rerun_execution_reservations
          where id = $1
            and project_id = $2
            and lease_token = $3
            and lease_generation = $4
            and lease_expires_at > now()
          for update`,
        [
          input.lease.reservationId,
          input.projectId,
          input.lease.leaseToken,
          input.lease.leaseGeneration,
        ]
      );
      const reservation = execution.rows[0];
      if (
        !reservation ||
        reservation.status !== "running" ||
        reservation.proposal_action_id !== input.proposalActionId ||
        reservation.root_run_id !== input.rootRunId
      ) {
        throw new ApiError(
          "idempotency_in_progress",
          "Another execution worker owns the active lease."
        );
      }
      const incomplete = await client.query<{ incomplete: boolean }>(
        `select exists (
           select 1
             from public.rerun_execution_work_items
            where execution_reservation_id = $1
              and status <> 'completed'
         ) as incomplete`,
        [input.lease.reservationId]
      );
      if (incomplete.rows[0]?.incomplete) {
        throw new ApiError(
          "validation_failed",
          "Rerun execution has incomplete bound work."
        );
      }
      const params = {
        schema_version: "action_params.v1",
        schemaVersion: "RerunReconciliation.v1",
        proposalActionId: input.proposalActionId,
        executionReservationId: input.lease.reservationId,
      };
      const existing = await client.query<{
        project_id: string;
        orchestrator_run_id: string;
        tool: string;
        status: string;
        params: Record<string, unknown>;
      }>(
        `select project_id, orchestrator_run_id, tool, status, params
           from public.actions
          where id = $1
          for update`,
        [input.reconciliationActionId]
      );
      if (existing.rows[0]) {
        const action = existing.rows[0];
        if (
          action.project_id !== input.projectId ||
          action.orchestrator_run_id !== input.rootRunId ||
          action.tool !== "rerun_reconciliation" ||
          action.status !== "applied" ||
          action.params.proposalActionId !== input.proposalActionId ||
          action.params.executionReservationId !== input.lease.reservationId
        ) {
          throw new ApiError(
            "idempotency_conflict",
            "Reconciliation action was reused with different input."
          );
        }
        return input.reconciliationActionId;
      }
      await client.query(
        `insert into public.actions (
           id, schema_version, project_id, orchestrator_run_id, tool, status,
           params, input_asset_ids, rationale, proposal, job_ids,
           output_asset_ids
         ) values (
           $1, 'action.v1', $2, $3, 'rerun_reconciliation', 'applied',
           $4::jsonb, '{}'::uuid[],
           'Coordinator-confirmed terminal rerun reconciliation.',
           null, '{}'::uuid[], '{}'::uuid[]
         )`,
        [
          input.reconciliationActionId,
          input.projectId,
          input.rootRunId,
          JSON.stringify(params),
        ]
      );
      return input.reconciliationActionId;
    }
  );
}

export async function failRerunWorkItem(input: {
  projectId: string;
  lease: RerunLease;
  workItemId: string;
  error: Record<string, unknown>;
}): Promise<void> {
  await failWorkTransaction(input);
}

export async function finalizeRerunExecution(input: {
  projectId: string;
  lease: RerunLease;
  executionActionId: string;
  outcome: "applied" | "failed";
  reconciliationActionId?: string;
  error?: Record<string, unknown>;
}): Promise<string> {
  return finalizeExecutionTransaction(input);
}

export async function cancelRerunExecution(input: {
  projectId: string;
  proposalActionId: string;
  executionActionId: string;
  reason: string;
}): Promise<{
  executionActionId: string;
  status: "applied" | "failed" | "canceled";
  canceled: boolean;
}> {
  return cancelExecutionTransaction(input);
}
