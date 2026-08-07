// Persistence for the orchestrator tool-calling loop: the run header and its
// relational gates. A tool invocation is an `actions` row (see store.ts
// createAction); this file owns only orchestrator_runs + orchestrator_run_gates.
// Kept separate from the ~13k-line store.ts per the cohesive-feature-file rule;
// shared low-level mappers come from ./store-internal.

import type {
  AgentRole,
  DomainRunWaitReason,
} from "@popcorn/shared/domain-agent-contract";
import { getServiceSupabase } from "../../supabase/clients";
import { runQuery } from "../../supabase/db-errors";
import { ApiError } from "./errors";
import { deploymentMetadata, iso, markedJson, unmarkedJson } from "./store-internal";

// Transport-oriented run lifecycle. `timed_out`/`superseded` were added by the
// specialist-agent PR 4 schema (domain finite runs); store/lifecycle logic that
// sets them lands with PRs 5-6.
export type OrchestratorRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "canceled"
  | "timed_out"
  | "superseded";

export type OrchestratorGateStatus = "pending" | "reached" | "approved" | "rejected";
export interface OrchestratorRun {
  id: string;
  schemaVersion: "orchestrator_run.v1";
  projectId: string;
  status: OrchestratorRunStatus;
  inputSummary: string;
  creationScope?: "full_video" | "script";
  /** Persisted role selects the declarative AgentDefinition (PR 8). */
  agentRole?: AgentRole;
  /** Finite domain identity used by creator projections and recovery policy. */
  taskKind?: string;
  originKind?: "creative_director" | "creator_direct";
  budgetUsd?: number;
  spentUsd: number;
  /** Why a waiting run is parked: media_job | domain | approval (PR 6). */
  waitReason?: DomainRunWaitReason;
  error?: Record<string, unknown>;
  deployId?: string;
  gitSha?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** A runnable persisted run together with the workspace needed by the detached engine. */
export interface RecoverableOrchestratorRun {
  run: OrchestratorRun;
  workspaceId: string;
}

export interface ClaimedOrchestratorDispatch {
  dispatchId: string;
  runId: string;
  workspaceId: string;
  leaseToken: string;
  /** Set when the claimed run is a session-linked finite domain run. The claim
   * transaction reserved the session's single active-run slot; jobs launched
   * by this dispatch must carry this durable claim generation. */
  agentSessionId?: string;
  sessionClaimGeneration?: number;
}

export interface OrchestratorRunGate {
  id: string;
  orchestratorRunId: string;
  stage: string;
  status: OrchestratorGateStatus;
  decidedByActionId?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// A minimal projection of the run's actions — enough to rebuild the model's
// prior-results context on resume without coupling to store.ts's mapAction.
export interface RunActionSummary {
  id: string;
  tool: string;
  status: string;
  params: Record<string, unknown>;
  rationale?: string;
  outputAssetIds: string[];
  jobIds: string[];
  error?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  /** Historical marker retained for readable action projections. */
  supersededAt?: string | null;
}

export interface CreateOrchestratorRunInput {
  projectId: string;
  inputSummary: string;
  creationScope?: OrchestratorRun["creationScope"];
  budgetUsd?: number;
  /** Stage/tool names to pause before; [] (or omitted) = fully autonomous. */
  gates?: string[];
  status?: OrchestratorRunStatus;
}

export interface AnonymousQuotaInput {
  windowStartIso: string;
  limit: number;
}

/**
 * Root work belongs only to the Creative Director role. The PR7A compatibility
 * migration terminalizes old flat roots before this application code ships;
 * status checks keep that readable history from ever resuming.
 */
export function isCreativeDirectorHierarchyRoot(
  run: Pick<OrchestratorRun, "agentRole">
): boolean {
  return (run.agentRole ?? "creative_director") === "creative_director";
}

export function assertCreativeDirectorHierarchyRoot(
  run: Pick<OrchestratorRun, "id" | "agentRole">,
  operation: string
): void {
  if (isCreativeDirectorHierarchyRoot(run)) return;
  throw new ApiError(
    "validation_failed",
    `Run ${run.id} is not a Creative Director root and cannot ${operation}.`
  );
}

export type UpdateOrchestratorRunPatch = Partial<
  Pick<OrchestratorRun, "status" | "spentUsd" | "error" | "startedAt" | "completedAt">
> & {
  /** Clear the persisted terminal error with a SQL NULL. */
  clearError?: boolean;
  /** Clear the completion time with a SQL NULL when reopening a run. */
  clearCompletedAt?: boolean;
  /**
   * Set (or clear with null) the wait reason. The DB constrains it: only a
   * waiting run carries one, and a root run may carry only the 'domain' wait.
   */
  waitReason?: DomainRunWaitReason | null;
};

interface OrchestratorRunRow {
  id: string;
  schema_version: "orchestrator_run.v1";
  project_id: string;
  status: OrchestratorRunStatus;
  input_summary: string;
  creation_scope?: "full_video" | "script" | null;
  agent_role?: AgentRole | null;
  task_kind?: string | null;
  origin_kind?: "creative_director" | "creator_direct" | null;
  budget_usd: number | null;
  spent_usd: number;
  wait_reason?: DomainRunWaitReason | null;
  error: Record<string, unknown> | null;
  deploy_id: string | null;
  git_sha: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface OrchestratorRunGateRow {
  id: string;
  orchestrator_run_id: string;
  stage: string;
  status: OrchestratorGateStatus;
  decided_by_action_id: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RunActionRow {
  id: string;
  tool: string;
  status: string;
  params: Record<string, unknown> | null;
  rationale?: string | null;
  output_asset_ids: string[] | null;
  job_ids: string[] | null;
  error: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  superseded_at?: string | null;
}

function mapRun(row: OrchestratorRunRow): OrchestratorRun {
  const run: OrchestratorRun = {
    id: row.id,
    schemaVersion: "orchestrator_run.v1",
    projectId: row.project_id,
    status: row.status,
    inputSummary: row.input_summary,
    creationScope: row.creation_scope ?? "full_video",
    spentUsd: row.spent_usd ?? 0,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.agent_role) run.agentRole = row.agent_role;
  if (row.task_kind) run.taskKind = row.task_kind;
  if (row.origin_kind) run.originKind = row.origin_kind;
  if (row.budget_usd != null) run.budgetUsd = row.budget_usd;
  if (row.wait_reason) run.waitReason = row.wait_reason;
  const error = unmarkedJson(row.error);
  if (error) run.error = error;
  if (row.deploy_id) run.deployId = row.deploy_id;
  if (row.git_sha) run.gitSha = row.git_sha;
  if (row.started_at) run.startedAt = iso(row.started_at);
  if (row.completed_at) run.completedAt = iso(row.completed_at);
  return run;
}

function mapGate(row: OrchestratorRunGateRow): OrchestratorRunGate {
  const gate: OrchestratorRunGate = {
    id: row.id,
    orchestratorRunId: row.orchestrator_run_id,
    stage: row.stage,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.decided_by_action_id) gate.decidedByActionId = row.decided_by_action_id;
  if (row.decided_at) gate.decidedAt = iso(row.decided_at);
  return gate;
}

function mapRunAction(row: RunActionRow): RunActionSummary {
  const summary: RunActionSummary = {
    id: row.id,
    tool: row.tool,
    status: row.status,
    params: unmarkedJson(row.params) ?? {},
    outputAssetIds: row.output_asset_ids ?? [],
    jobIds: row.job_ids ?? [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    supersededAt: row.superseded_at ?? null,
  };
  const error = unmarkedJson(row.error);
  if (row.rationale) summary.rationale = row.rationale;
  if (error) summary.error = error;
  return summary;
}

async function createOrchestratorRunGates(
  runId: string,
  gates: string[] | undefined,
  now = new Date().toISOString()
): Promise<void> {
  const stages = [...new Set((gates ?? []).filter((stage) => stage.trim().length > 0))];
  if (stages.length === 0) return;

  const db = getServiceSupabase();
  await runQuery(
    "store.createOrchestratorRun gates",
    db.from("orchestrator_run_gates").insert(
      stages.map((stage) => ({
        orchestrator_run_id: runId,
        stage,
        status: "pending",
        created_at: now,
        updated_at: now,
      }))
    )
  );
}

export async function createOrchestratorRun(
  input: CreateOrchestratorRunInput
): Promise<OrchestratorRun> {
  const db = getServiceSupabase();
  const now = new Date().toISOString();
  const inserted = await runQuery(
    "store.createOrchestratorRun",
    db
      .from("orchestrator_runs")
      .insert({
        schema_version: "orchestrator_run.v1",
        project_id: input.projectId,
        status: input.status ?? "queued",
        input_summary: input.inputSummary,
        creation_scope: input.creationScope ?? "full_video",
        budget_usd: input.budgetUsd ?? null,
        spent_usd: 0,
        ...deploymentMetadata(),
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single()
  );
  const run = mapRun(inserted as OrchestratorRunRow);

  await createOrchestratorRunGates(run.id, input.gates, now);
  return run;
}

export async function createOrchestratorRunWithAnonymousQuota(
  input: CreateOrchestratorRunInput,
  quota: AnonymousQuotaInput
): Promise<OrchestratorRun> {
  const db = getServiceSupabase();
  const metadata = deploymentMetadata();
  const rows = await runQuery(
    "store.createOrchestratorRunWithAnonymousQuota",
    db.rpc("create_orchestrator_run_with_anonymous_quota", {
      p_project_id: input.projectId,
      p_input_summary: input.inputSummary,
      p_budget_usd: input.budgetUsd ?? null,
      p_window_start: quota.windowStartIso,
      p_limit: quota.limit,
      p_deploy_id: metadata.deploy_id,
      p_git_sha: metadata.git_sha,
      p_creation_scope: input.creationScope ?? "full_video",
    })
  );
  const row = (rows as Array<{ run_id: string | null; quota_exceeded: boolean }>)[0];
  if (!row) {
    throw new ApiError("internal_error", "Anonymous quota run creation returned no result.");
  }
  if (row.quota_exceeded) {
    throw new ApiError(
      "rate_limited",
      "Create an account to make more videos.",
      {
        limit: quota.limit,
        reason: "anonymous_generation_quota",
      }
    );
  }
  if (!row.run_id) {
    throw new ApiError("internal_error", "Anonymous quota run creation returned no run ID.");
  }

  await createOrchestratorRunGates(row.run_id, input.gates);
  return getOrchestratorRun(row.run_id);
}

export async function getOrchestratorRun(runId: string): Promise<OrchestratorRun> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.getOrchestratorRun",
    db.from("orchestrator_runs").select("*").eq("id", runId).maybeSingle()
  );
  if (!data) throw new ApiError("not_found", `Orchestrator run not found: ${runId}`);
  return mapRun(data as OrchestratorRunRow);
}

export async function listOrchestratorRunsForProject(
  projectId: string
): Promise<OrchestratorRun[]> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listOrchestratorRunsForProject",
    db
      .from("orchestrator_runs")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
  );
  return ((data as OrchestratorRunRow[]) ?? []).map(mapRun);
}

export async function getLatestOrchestratorRunForGate(
  projectId: string,
  stage: string
): Promise<{ run: OrchestratorRun; gate: OrchestratorRunGate } | null> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.getLatestOrchestratorRunForGate",
    db
      .from("orchestrator_run_gates")
      .select("*, orchestrator_runs!inner(*)")
      .eq("stage", stage)
      .eq("orchestrator_runs.project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  if (!data) return null;
  const row = data as unknown as OrchestratorRunGateRow & {
    orchestrator_runs: OrchestratorRunRow;
  };
  return { run: mapRun(row.orchestrator_runs), gate: mapGate(row) };
}

/**
 * Returns the durable work queue.  Routes only create or update these rows;
 * the recovery worker is the single owner that drives them afterwards.
 */
export async function listRecoverableOrchestratorRuns(): Promise<RecoverableOrchestratorRun[]> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listRecoverableOrchestratorRuns",
    db
      .from("orchestrator_runs")
      .select("*, projects!inner(workspace_id)")
      .in("status", ["queued", "running", "waiting"])
      .order("updated_at", { ascending: true })
  );
  return ((data ?? []) as Array<OrchestratorRunRow & { projects: { workspace_id: string } | null }>)
    .filter((row) => Boolean(row.projects?.workspace_id))
    .map((row) => ({
      run: mapRun(row),
      workspaceId: row.projects!.workspace_id,
    }));
}

export async function enqueueOrchestratorDispatch(
  runId: string,
  _workspaceId?: string
): Promise<void> {
  const db = getServiceSupabase();
  await runQuery(
    "store.enqueueOrchestratorDispatch",
    db.rpc("wake_orchestrator_dispatch", {
      p_orchestrator_run_id: runId,
    })
  );
}

/** Repair finite-run control records before leasing more work after a crash. */
export async function recoverOrchestratorRuntimeControls(): Promise<void> {
  await runQuery(
    "store.recoverOrchestratorRuntimeControls",
    getServiceSupabase().rpc("recover_orchestrator_runtime_controls")
  );
}

/** Cancel a root/direct finite-run family and fence only its causal jobs. */
export async function cancelOrchestratorRunFamily(input: {
  projectId: string;
  runId: string;
}): Promise<{ canceledRunIds: string[]; canceledJobIds: string[] }> {
  const rows = await runQuery(
    "store.cancelOrchestratorRunFamily",
    getServiceSupabase().rpc("cancel_orchestrator_run_family", {
      p_project_id: input.projectId,
      p_run_id: input.runId,
    })
  );
  const row = (rows as Array<{ canceled_run_ids: string[]; canceled_job_ids: string[] }>)[0];
  if (!row) throw new ApiError("internal_error", "Run-family cancellation returned no result.");
  return {
    canceledRunIds: row.canceled_run_ids ?? [],
    canceledJobIds: row.canceled_job_ids ?? [],
  };
}

export async function claimOrchestratorDispatches(
  limit = 4,
  leaseSeconds = 120
): Promise<ClaimedOrchestratorDispatch[]> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.claimOrchestratorDispatches",
    db.rpc("claim_orchestrator_dispatches", { p_limit: limit, p_lease_seconds: leaseSeconds })
  );
  return ((data ?? []) as Array<{
    dispatch_id: string;
    orchestrator_run_id: string;
    workspace_id: string;
    lease_token: string;
    agent_session_id?: string | null;
    session_claim_generation?: number | null;
  }>).map((row) => ({
    dispatchId: row.dispatch_id,
    runId: row.orchestrator_run_id,
    workspaceId: row.workspace_id,
    leaseToken: row.lease_token,
    ...(row.agent_session_id ? { agentSessionId: row.agent_session_id } : {}),
    ...(row.session_claim_generation != null
      ? { sessionClaimGeneration: Number(row.session_claim_generation) }
      : {}),
  }));
}

export async function releaseOrchestratorDispatch(input: {
  dispatchId: string;
  leaseToken: string;
  delaySeconds: number;
  completed: boolean;
}): Promise<void> {
  const db = getServiceSupabase();
  await runQuery(
    "store.releaseOrchestratorDispatch",
    db.rpc("release_orchestrator_dispatch", {
      p_dispatch_id: input.dispatchId,
      p_lease_token: input.leaseToken,
      p_delay_seconds: input.delaySeconds,
      p_completed: input.completed,
    })
  );
}

export async function updateOrchestratorRun(
  runId: string,
  patch: UpdateOrchestratorRunPatch
): Promise<OrchestratorRun> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.waitReason !== undefined) row.wait_reason = patch.waitReason;
  // The DB requires wait_reason to travel with 'waiting' only; clear it on any
  // explicit non-waiting transition unless the caller set it themselves.
  else if (patch.status !== undefined && patch.status !== "waiting") row.wait_reason = null;
  if (patch.spentUsd !== undefined) row.spent_usd = patch.spentUsd;
  if (patch.clearError) row.error = null;
  else if (patch.error !== undefined) row.error = markedJson("orchestrator_error.v1", patch.error);
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.clearCompletedAt) row.completed_at = null;
  else if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;

  const db = getServiceSupabase();
  const data = await runQuery(
    `store.updateOrchestratorRun ${runId}`,
    db.from("orchestrator_runs").update(row).eq("id", runId).select("*").single()
  );
  return mapRun(data as OrchestratorRunRow);
}

// Atomically claim a parked run before driving it. A completion callback and the
// recovery worker may race to resume the same job; only the caller that flips
// waiting -> running owns the next orchestrator turn.
export async function claimOrchestratorRunResume(
  runId: string
): Promise<OrchestratorRun | null> {
  const db = getServiceSupabase();
  const data = await runQuery(
    `store.claimOrchestratorRunResume ${runId}`,
    db
      .from("orchestrator_runs")
      // wait_reason travels with 'waiting' only (DB constraint); the resume
      // claim clears the media/domain/approval wait it is leaving.
      .update({ status: "running", wait_reason: null, updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "waiting")
      .select("*")
      .maybeSingle()
  );
  return data ? mapRun(data as OrchestratorRunRow) : null;
}

export async function listRunGates(runId: string): Promise<OrchestratorRunGate[]> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listRunGates",
    db
      .from("orchestrator_run_gates")
      .select("*")
      .eq("orchestrator_run_id", runId)
      .order("created_at", { ascending: true })
  );
  return ((data as OrchestratorRunGateRow[]) ?? []).map(mapGate);
}

// Mark the gate for a stage as reached (the loop arrived at it). Pending gates
// reach their first review stop; rejected gates reach the review stop after a
// regeneration pass.
export async function markGateReached(
  runId: string,
  stage: string
): Promise<OrchestratorRunGate | null> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.markGateReached",
    db
      .from("orchestrator_run_gates")
      .update({ status: "reached", updated_at: new Date().toISOString() })
      .eq("orchestrator_run_id", runId)
      .eq("stage", stage)
      .in("status", ["pending", "rejected"])
      .select("*")
      .maybeSingle()
  );
  return data ? mapGate(data as OrchestratorRunGateRow) : null;
}

export async function createReachedApprovalGate(input: {
  runId: string;
  stage: string;
}): Promise<OrchestratorRunGate> {
  const db = getServiceSupabase();
  const now = new Date().toISOString();
  const data = await runQuery(
    "store.createReachedApprovalGate",
    db
      .from("orchestrator_run_gates")
      .upsert(
        {
          orchestrator_run_id: input.runId,
          stage: input.stage,
          status: "reached",
          decided_at: null,
          decided_by_action_id: null,
          updated_at: now,
        },
        { onConflict: "orchestrator_run_id,stage" }
      )
      .select("*")
      .single()
  );
  return mapGate(data as OrchestratorRunGateRow);
}

export async function createPendingApprovalGate(input: {
  runId: string;
  stage: string;
}): Promise<OrchestratorRunGate> {
  const db = getServiceSupabase();
  const now = new Date().toISOString();
  const data = await runQuery(
    "store.createPendingApprovalGate",
    db
      .from("orchestrator_run_gates")
      .upsert(
        {
          orchestrator_run_id: input.runId,
          stage: input.stage,
          status: "pending",
          decided_at: null,
          decided_by_action_id: null,
          updated_at: now,
        },
        { onConflict: "orchestrator_run_id,stage" }
      )
      .select("*")
      .single()
  );
  return mapGate(data as OrchestratorRunGateRow);
}

export async function resolveGate(
  gateId: string,
  status: "approved" | "rejected",
  decidedByActionId?: string
): Promise<OrchestratorRunGate> {
  const db = getServiceSupabase();
  const data = await runQuery(
    `store.resolveGate ${gateId}`,
    db
      .from("orchestrator_run_gates")
      .update({
        status,
        decided_at: new Date().toISOString(),
        decided_by_action_id: decidedByActionId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", gateId)
      .select("*")
      .single()
  );
  return mapGate(data as OrchestratorRunGateRow);
}

// The run's invocations in order — used to rebuild the model's prior-results
// context when a parked run resumes.
export async function listRunActions(runId: string): Promise<RunActionSummary[]> {
  const db = getServiceSupabase();
  // select("*") (not an explicit column list) so a not-yet-migrated DB without
  // the superseded_at column degrades to "nothing superseded" instead of erroring.
  const data = await runQuery(
    "store.listRunActions",
    db
      .from("actions")
      .select("*")
      .eq("orchestrator_run_id", runId)
      .order("created_at", { ascending: true })
      // Keep same-timestamp action order deterministic. The PR 7A legacy-credit
      // fence uses the reverse of this exact ordering to identify the latest
      // live failed action before application code loses profile awareness.
      .order("id", { ascending: true })
  );
  // Superseded historical actions are hidden from the model-visible log.
  return ((data as RunActionRow[]) ?? [])
    .map(mapRunAction)
    .filter((action) => !action.supersededAt);
}

// Flag a set of actions superseded so they drop out of the run's action log.
// Append-only: the rows and the assets they produced are preserved.
export async function supersedeRunActions(actionIds: string[]): Promise<void> {
  if (actionIds.length === 0) return;
  const db = getServiceSupabase();
  await runQuery(
    "store.supersedeRunActions",
    db
      .from("actions")
      .update({ superseded_at: new Date().toISOString() })
      .in("id", actionIds)
  );
}

// Reset the given gates (by id) back to pending so they pause again on re-run.
export async function resetGatesToPending(gateIds: string[]): Promise<void> {
  if (gateIds.length === 0) return;
  const db = getServiceSupabase();
  await runQuery(
    "store.resetGatesToPending",
    db
      .from("orchestrator_run_gates")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .in("id", gateIds)
  );
}
