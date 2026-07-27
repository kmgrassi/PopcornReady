// Domain-session persistence for specialist-agent orchestration (PR 5 of
// docs/scopes/specialist-agent-orchestration-prs.md). One persistent
// `agent_sessions` row exists per (project, domain); every finite domain
// assignment is an ordinary `orchestrator_runs` row linked to its session, and
// its unique terminal report is a `domain_report` action on that run. This
// module owns the store queries for that model:
//
//   - session lookup + atomic create-or-reuse sequence allocation (DB RPC)
//   - finite-run enqueue with a caller-reserved id (idempotent retries)
//   - active-ownership claim/release honoring the durable claim generation
//   - role-aware history reads (raw origin/actor metadata is service-only)
//   - unique domain_report append surfacing a typed conflict
//   - origin-specific completion (direct completion never wakes a root)
//   - root-family projection (root run + child domain runs)
//
// Action role/session/origin always derive through
// `actions.orchestrator_run_id`; nothing here stamps redundant domain columns
// onto actions, jobs, or assets. All writes go through the service client —
// session allocation, claims, and attribution are server-owned transitions.

import { randomUUID } from "node:crypto";
import type {
  AgentDomain,
  AgentRole,
  DomainReportV1,
  DomainRunWaitReason,
  DomainTaskV1,
} from "@popcorn/shared/domain-agent-contract";
import { getServiceSupabase } from "../../supabase/clients";
import { runQuery, databaseError } from "../../supabase/db-errors";
import { ApiError } from "./errors";
import { iso } from "./store-internal";
import type { OrchestratorRunStatus } from "./orchestrator-store";

const PG_UNIQUE_VIOLATION = "23505";
const PG_STALE_SESSION_CLAIM = "55000";

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface AgentSessionRecord {
  id: string;
  projectId: string;
  domain: AgentDomain;
  nextSequence: number;
  activeRunId: string | null;
  claimGeneration: number;
  summary: Record<string, unknown> | null;
  summaryThroughSequence: number;
  summaryVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface AllocatedSessionSequence {
  sessionId: string;
  sequence: number;
  claimGeneration: number;
}

export type CompletionRecipient = "creative_director" | "creator_conversation";

export interface DomainRunRecord {
  id: string;
  projectId: string;
  status: OrchestratorRunStatus;
  inputSummary: string;
  agentRole: AgentRole;
  agentSessionId: string | null;
  sessionSequence: number | null;
  taskKind: string | null;
  taskParams: DomainTaskV1 | null;
  originKind: "creative_director" | "creator_direct" | null;
  parentRunId: string | null;
  rootActionId: string | null;
  originActorId: string | null;
  originRequest: Record<string, unknown> | null;
  continuesRunId: string | null;
  pins: Record<string, unknown> | null;
  waitReason: DomainRunWaitReason | null;
  completionRecipient: CompletionRecipient | null;
  budgetUsd: number | null;
  spentUsd: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  supersededAt: string | null;
}

interface DomainRunRow {
  id: string;
  project_id: string;
  status: OrchestratorRunStatus;
  input_summary: string;
  agent_role: AgentRole;
  agent_session_id: string | null;
  session_sequence: number | null;
  task_kind: string | null;
  task_params: DomainTaskV1 | null;
  origin_kind: "creative_director" | "creator_direct" | null;
  parent_run_id: string | null;
  root_action_id: string | null;
  origin_actor_id: string | null;
  origin_request: Record<string, unknown> | null;
  continues_run_id: string | null;
  pins: Record<string, unknown> | null;
  wait_reason: DomainRunWaitReason | null;
  completion_recipient: CompletionRecipient | null;
  budget_usd: number | null;
  spent_usd: number | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  superseded_at: string | null;
}

const DOMAIN_RUN_COLUMNS =
  "id, project_id, status, input_summary, agent_role, agent_session_id, " +
  "session_sequence, task_kind, task_params, origin_kind, parent_run_id, " +
  "root_action_id, origin_actor_id, origin_request, continues_run_id, pins, " +
  "wait_reason, completion_recipient, budget_usd, spent_usd, created_at, " +
  "updated_at, started_at, completed_at, superseded_at";

interface AgentSessionRow {
  id: string;
  project_id: string;
  domain: AgentDomain;
  next_sequence: number;
  active_run_id: string | null;
  claim_generation: number;
  summary: Record<string, unknown> | null;
  summary_through_sequence: number;
  summary_version: number;
  created_at: string;
  updated_at: string;
}

function mapSession(row: AgentSessionRow): AgentSessionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    domain: row.domain,
    nextSequence: row.next_sequence,
    activeRunId: row.active_run_id,
    claimGeneration: Number(row.claim_generation),
    summary: row.summary,
    summaryThroughSequence: row.summary_through_sequence,
    summaryVersion: row.summary_version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapDomainRun(row: DomainRunRow): DomainRunRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    inputSummary: row.input_summary,
    agentRole: row.agent_role,
    agentSessionId: row.agent_session_id,
    sessionSequence: row.session_sequence,
    taskKind: row.task_kind,
    taskParams: row.task_params,
    originKind: row.origin_kind,
    parentRunId: row.parent_run_id,
    rootActionId: row.root_action_id,
    originActorId: row.origin_actor_id,
    originRequest: row.origin_request,
    continuesRunId: row.continues_run_id,
    pins: row.pins,
    waitReason: row.wait_reason,
    completionRecipient: row.completion_recipient,
    budgetUsd: row.budget_usd,
    spentUsd: row.spent_usd ?? 0,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: row.started_at ? iso(row.started_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    supersededAt: row.superseded_at ? iso(row.superseded_at) : null,
  };
}

// ---------------------------------------------------------------------------
// Session lookup / atomic allocation
// ---------------------------------------------------------------------------

export async function getAgentSession(
  projectId: string,
  domain: AgentDomain
): Promise<AgentSessionRecord | null> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "domainSessionStore.getAgentSession",
    db
      .from("agent_sessions")
      .select("*")
      .eq("project_id", projectId)
      .eq("domain", domain)
      .maybeSingle()
  );
  return data ? mapSession(data as AgentSessionRow) : null;
}

/**
 * Atomic create-or-reuse + next-sequence allocation via the PR 4 RPC. One
 * statement in the database, so concurrent root/creator-direct callers on the
 * same (project, domain) can never receive the same sequence.
 */
export async function allocateAgentSessionSequence(
  projectId: string,
  domain: AgentDomain
): Promise<AllocatedSessionSequence> {
  const db = getServiceSupabase();
  const rows = await runQuery(
    "domainSessionStore.allocateAgentSessionSequence",
    db.rpc("allocate_agent_session_sequence", {
      p_project_id: projectId,
      p_domain: domain,
    })
  );
  const row = (rows as Array<{
    session_id: string;
    allocated_sequence: number;
    claim_generation: number;
  }>)[0];
  if (!row) {
    throw new ApiError("internal_error", "Session sequence allocation returned no row.");
  }
  return {
    sessionId: row.session_id,
    sequence: row.allocated_sequence,
    claimGeneration: Number(row.claim_generation),
  };
}

// ---------------------------------------------------------------------------
// Finite-run enqueue
// ---------------------------------------------------------------------------

export type DomainRunOriginInput =
  | { kind: "creative_director"; parentRunId: string; rootActionId: string }
  | { kind: "creator_direct"; actorId: string; request: Record<string, unknown> };

export interface CreateDomainRunInput {
  /**
   * Optional caller-reserved run identity. Like caller-reserved actions, the
   * first insert wins and a retried write reloads that immutable assignment
   * instead of enqueueing a sibling run.
   */
  id?: string;
  projectId: string;
  domain: AgentDomain;
  task: DomainTaskV1;
  inputSummary: string;
  budgetUsd?: number;
  origin: DomainRunOriginInput;
  continuesRunId?: string;
  /** Stamped as a DomainRunPins.v1 payload; written once with the assignment. */
  pins?: Record<string, unknown>;
}

/**
 * Enqueue one finite domain assignment: allocate the session sequence through
 * the atomic RPC, then insert the run carrying the full assignment identity.
 * Task asset references (preserve set + candidate affected assets) are
 * same-project validated before anything is written.
 */
export async function createDomainRun(
  input: CreateDomainRunInput
): Promise<DomainRunRecord> {
  const runId = input.id ?? randomUUID();
  await assertSameProjectAssets(
    input.projectId,
    [
      ...input.task.preserve.assetIds,
      ...input.task.candidateAffectedAssetIds,
      ...input.task.preserve.fingerprints.map((pin) => pin.assetId),
    ],
    "task"
  );

  const db = getServiceSupabase();
  const existingBefore = input.id ? await getDomainRun(input.projectId, input.id) : null;
  if (existingBefore) return existingBefore;

  const allocation = await allocateAgentSessionSequence(input.projectId, input.domain);
  const row: Record<string, unknown> = {
    id: runId,
    project_id: input.projectId,
    status: "queued",
    input_summary: input.inputSummary,
    budget_usd: input.budgetUsd ?? null,
    spent_usd: 0,
    agent_role: input.domain,
    agent_session_id: allocation.sessionId,
    session_sequence: allocation.sequence,
    task_kind: input.task.taskKind,
    task_params: input.task,
    origin_kind: input.origin.kind,
    parent_run_id: input.origin.kind === "creative_director" ? input.origin.parentRunId : null,
    root_action_id: input.origin.kind === "creative_director" ? input.origin.rootActionId : null,
    origin_actor_id: input.origin.kind === "creator_direct" ? input.origin.actorId : null,
    origin_request:
      input.origin.kind === "creator_direct"
        ? { schemaVersion: "CreatorDirectOrigin.v1", ...input.origin.request }
        : null,
    continues_run_id: input.continuesRunId ?? null,
    pins: input.pins ? { schemaVersion: "DomainRunPins.v1", ...input.pins } : null,
  };

  const { data, error } = await db
    .from("orchestrator_runs")
    .insert(row)
    .select(DOMAIN_RUN_COLUMNS)
    .single();
  if (error) {
    // A retried caller-reserved id reloads the immutable assignment. The
    // sequence burned by this retry stays unused — sequences must be unique,
    // not dense.
    if (error.code === PG_UNIQUE_VIOLATION && input.id) {
      const existing = await getDomainRun(input.projectId, runId);
      if (existing) return existing;
    }
    throw databaseError("domainSessionStore.createDomainRun", error);
  }
  return mapDomainRun(data as unknown as DomainRunRow);
}

export async function getDomainRun(
  projectId: string,
  runId: string
): Promise<DomainRunRecord | null> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "domainSessionStore.getDomainRun",
    db
      .from("orchestrator_runs")
      .select(DOMAIN_RUN_COLUMNS)
      .eq("id", runId)
      .eq("project_id", projectId)
      .maybeSingle()
  );
  return data ? mapDomainRun(data as unknown as DomainRunRow) : null;
}

// ---------------------------------------------------------------------------
// Active-ownership claim / release (durable claim generation)
// ---------------------------------------------------------------------------

export type SessionRunClaim =
  | { state: "claimed"; claimGeneration: number }
  | { state: "held" }
  | { state: "terminal" };

/**
 * Claim the session's single active-ownership slot for a specific finite run.
 * The durable claim generation increments exactly when ownership changes; an
 * idempotent re-claim by the current owner returns the unchanged generation.
 */
export async function claimSessionRun(input: {
  projectId: string;
  sessionId: string;
  runId: string;
}): Promise<SessionRunClaim> {
  const db = getServiceSupabase();
  const rows = await runQuery(
    "domainSessionStore.claimSessionRun",
    db.rpc("claim_agent_session_run", {
      p_project_id: input.projectId,
      p_session_id: input.sessionId,
      p_run_id: input.runId,
    })
  );
  const row = (rows as Array<{ state: string; claim_generation: number | null }>)[0];
  if (!row) {
    throw new ApiError("internal_error", "Session claim returned no row.");
  }
  if (row.state === "claimed" && row.claim_generation != null) {
    return { state: "claimed", claimGeneration: Number(row.claim_generation) };
  }
  if (row.state === "terminal") return { state: "terminal" };
  return { state: "held" };
}

/** Release active ownership held by the given run; increments the generation. */
export async function releaseSessionRun(input: {
  projectId: string;
  sessionId: string;
  runId: string;
}): Promise<boolean> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "domainSessionStore.releaseSessionRun",
    db.rpc("release_agent_session_run", {
      p_project_id: input.projectId,
      p_session_id: input.sessionId,
      p_run_id: input.runId,
    })
  );
  return Boolean(data);
}

/**
 * The durable claim context a provider job launched by the given run must
 * carry (`jobs.session_claim_generation`). While a run holds active
 * ownership, the session's current generation equals its claim-time
 * generation (the counter only advances when ownership changes). Runs outside
 * a session (root runs, direct tool calls) have no claim to copy.
 */
export async function getRunSessionClaim(
  runId: string
): Promise<{ sessionId: string; claimGeneration: number } | null> {
  const db = getServiceSupabase();
  const run = await runQuery(
    "domainSessionStore.getRunSessionClaim run",
    db
      .from("orchestrator_runs")
      .select("agent_session_id")
      .eq("id", runId)
      .maybeSingle()
  );
  const sessionId = (run as { agent_session_id: string | null } | null)?.agent_session_id;
  if (!sessionId) return null;
  const session = await runQuery(
    "domainSessionStore.getRunSessionClaim session",
    db
      .from("agent_sessions")
      .select("claim_generation")
      .eq("id", sessionId)
      .maybeSingle()
  );
  if (!session) return null;
  return {
    sessionId,
    claimGeneration: Number((session as { claim_generation: number }).claim_generation),
  };
}

/**
 * True when a job write was rejected by the stale-session-claim finalization
 * fence (`jobs_fence_session_claim`, errcode 55000): the job was launched
 * under a claim generation the session has since advanced past.
 */
export function isStaleSessionClaimError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.code !== "database_error") return false;
  const dbCode = err.details?.dbCode;
  const dbMessage = err.details?.dbMessage;
  return (
    dbCode === PG_STALE_SESSION_CLAIM ||
    (typeof dbMessage === "string" && dbMessage.includes("stale_session_claim"))
  );
}

// ---------------------------------------------------------------------------
// Role-aware history reads
// ---------------------------------------------------------------------------

/**
 * Who is reading the session history. Raw task specs, origin actor/request
 * metadata, and pins are owner/service-only (scope invariant 17); any agent
 * viewer receives the sanitized projection.
 */
export type SessionHistoryViewer = "service" | AgentRole;

export interface SessionRunHistoryEntry {
  runId: string;
  sessionSequence: number;
  status: OrchestratorRunStatus;
  waitReason: DomainRunWaitReason | null;
  taskKind: string | null;
  continuesRunId: string | null;
  reportActionId: string | null;
  report: DomainReportV1 | null;
  createdAt: string;
  completedAt: string | null;
  /** Service-only fields; absent for agent viewers. */
  taskParams?: DomainTaskV1 | null;
  originKind?: "creative_director" | "creator_direct" | null;
  parentRunId?: string | null;
  rootActionId?: string | null;
  originActorId?: string | null;
  originRequest?: Record<string, unknown> | null;
  pins?: Record<string, unknown> | null;
}

/**
 * The session's finite runs in sequence order, each joined with its unique
 * terminal `domain_report` action (derived through
 * `actions.orchestrator_run_id` — reports carry no session columns of their
 * own).
 */
export async function listSessionRuns(
  sessionId: string,
  viewer: SessionHistoryViewer
): Promise<SessionRunHistoryEntry[]> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "domainSessionStore.listSessionRuns",
    db
      .from("orchestrator_runs")
      .select(DOMAIN_RUN_COLUMNS)
      .eq("agent_session_id", sessionId)
      .order("session_sequence", { ascending: true })
  );
  const runs = ((data as unknown as unknown as DomainRunRow[]) ?? []).map(mapDomainRun);
  if (runs.length === 0) return [];

  const reports = await runQuery(
    "domainSessionStore.listSessionRuns reports",
    db
      .from("actions")
      .select("id, orchestrator_run_id, params")
      .eq("tool", "domain_report")
      .in(
        "orchestrator_run_id",
        runs.map((run) => run.id)
      )
  );
  const reportByRun = new Map<string, { id: string; params: DomainReportV1 }>();
  for (const row of (reports as Array<{
    id: string;
    orchestrator_run_id: string;
    params: DomainReportV1;
  }>) ?? []) {
    reportByRun.set(row.orchestrator_run_id, { id: row.id, params: row.params });
  }

  return runs.map((run) => {
    const report = reportByRun.get(run.id) ?? null;
    const entry: SessionRunHistoryEntry = {
      runId: run.id,
      sessionSequence: run.sessionSequence ?? 0,
      status: run.status,
      waitReason: run.waitReason,
      taskKind: run.taskKind,
      continuesRunId: run.continuesRunId,
      reportActionId: report?.id ?? null,
      report: report?.params ?? null,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    };
    if (viewer === "service") {
      entry.taskParams = run.taskParams;
      entry.originKind = run.originKind;
      entry.parentRunId = run.parentRunId;
      entry.rootActionId = run.rootActionId;
      entry.originActorId = run.originActorId;
      entry.originRequest = run.originRequest;
      entry.pins = run.pins;
    }
    return entry;
  });
}

// ---------------------------------------------------------------------------
// Unique domain_report append
// ---------------------------------------------------------------------------

export interface AppendDomainReportInput {
  projectId: string;
  runId: string;
  /** Caller-reserved report action id; a replay with the same id is a no-op. */
  reportActionId?: string;
  report: DomainReportV1;
}

export interface AppendedDomainReport {
  reportActionId: string;
  created: boolean;
}

function reportOutputAssetIds(report: DomainReportV1): string[] {
  return report.outcome.outcome === "done"
    ? report.outcome.outputs.map((output) => output.assetId)
    : [];
}

/**
 * Append the run's unique terminal `domain_report` action. Exactly one report
 * exists per finite domain run (partial unique index); a second append
 * surfaces a typed conflict, while replaying the same caller-reserved action
 * id returns the existing immutable report. Output asset references are
 * same-project validated, mirrored onto the immutable `output_asset_ids`
 * array, and attributed through ordered `action_assets` rows that preserve
 * each output's intrinsic role.
 */
export async function appendDomainReport(
  input: AppendDomainReportInput
): Promise<AppendedDomainReport> {
  const outputAssetIds = reportOutputAssetIds(input.report);
  await assertSameProjectAssets(input.projectId, outputAssetIds, "report");

  const actionId = input.reportActionId ?? randomUUID();
  const db = getServiceSupabase();
  const { error } = await db.from("actions").insert({
    id: actionId,
    project_id: input.projectId,
    orchestrator_run_id: input.runId,
    tool: "domain_report",
    status: "applied",
    // Verbatim DomainReport.v1 payload — the DB trigger validates the
    // camelCase schema mark; no store-side re-marking.
    params: input.report,
    input_asset_ids: [],
    output_asset_ids: outputAssetIds,
    job_ids: [],
  });
  if (error) {
    if (error.code !== PG_UNIQUE_VIOLATION) {
      throw databaseError("domainSessionStore.appendDomainReport", error);
    }
    const existing = await runQuery(
      "domainSessionStore.appendDomainReport existing",
      db
        .from("actions")
        .select("id")
        .eq("orchestrator_run_id", input.runId)
        .eq("tool", "domain_report")
        .maybeSingle()
    );
    const existingId = (existing as { id: string } | null)?.id;
    if (existingId && input.reportActionId && existingId === input.reportActionId) {
      // Idempotent replay of the same logical report.
      await attributeReportOutputs(input, actionId);
      return { reportActionId: existingId, created: false };
    }
    throw new ApiError(
      "idempotency_conflict",
      `Finite run ${input.runId} already has its terminal domain report.`,
      {
        reason: "domain_report_exists",
        runId: input.runId,
        ...(existingId ? { existingReportActionId: existingId } : {}),
      }
    );
  }

  await attributeReportOutputs(input, actionId);
  return { reportActionId: actionId, created: true };
}

async function attributeReportOutputs(
  input: AppendDomainReportInput,
  actionId: string
): Promise<void> {
  if (input.report.outcome.outcome !== "done" || input.report.outcome.outputs.length === 0) {
    return;
  }
  const db = getServiceSupabase();
  await runQuery(
    "domainSessionStore.appendDomainReport action_assets",
    db.from("action_assets").upsert(
      input.report.outcome.outputs.map((output, ordinal) => ({
        project_id: input.projectId,
        action_id: actionId,
        asset_id: output.assetId,
        direction: "output",
        role: output.intrinsicRole,
        ordinal,
      })),
      { onConflict: "action_id,direction,ordinal", ignoreDuplicates: true }
    )
  );
}

// ---------------------------------------------------------------------------
// Origin-specific completion
// ---------------------------------------------------------------------------

export interface CompleteDomainRunInput {
  projectId: string;
  runId: string;
  /**
   * Invoked exactly once — only when this caller wins the terminal transition
   * of a `creative_director`-origin run. Creator-direct completion NEVER
   * invokes it: the recipient derives from the run's trusted origin, and a
   * direct run structurally has no parent to wake.
   */
  wakeParent?: (parentRunId: string) => Promise<void>;
}

export interface DomainRunCompletion {
  run: DomainRunRecord;
  recipient: CompletionRecipient;
  parentRunId: string | null;
  /** True when this caller performed the terminal transition (and any wake). */
  completed: boolean;
}

/**
 * Terminalize a finite domain run after its report was appended, release the
 * session's active-ownership slot (advancing the durable claim generation so
 * stale provider callbacks are fenced), and derive the completion recipient
 * from the run's DB-derived `completion_recipient`. Idempotent: a repeated
 * completion neither re-terminalizes nor re-wakes.
 */
export async function completeDomainRun(
  input: CompleteDomainRunInput
): Promise<DomainRunCompletion> {
  const run = await getDomainRun(input.projectId, input.runId);
  if (!run) {
    throw new ApiError("not_found", `Domain run not found: ${input.runId}`);
  }
  if (!run.agentSessionId || !run.completionRecipient) {
    throw new ApiError(
      "validation_failed",
      `Run ${input.runId} is not a finite domain run.`,
      { fields: [{ path: "runId", message: "Completion applies to domain-role runs only." }] }
    );
  }

  const db = getServiceSupabase();
  const report = await runQuery(
    "domainSessionStore.completeDomainRun report",
    db
      .from("actions")
      .select("id")
      .eq("orchestrator_run_id", run.id)
      .eq("tool", "domain_report")
      .maybeSingle()
  );
  if (!report) {
    throw new ApiError(
      "validation_failed",
      `Run ${input.runId} has no terminal domain report; append the report before completing.`,
      { fields: [{ path: "runId", message: "One immutable report action closes one domain run." }] }
    );
  }

  // Win-the-transition update: only one caller flips the run terminal.
  const now = new Date().toISOString();
  const terminalized = await runQuery(
    "domainSessionStore.completeDomainRun terminalize",
    db
      .from("orchestrator_runs")
      .update({ status: "succeeded", completed_at: now, wait_reason: null, updated_at: now })
      .eq("id", run.id)
      .eq("project_id", input.projectId)
      .in("status", ["queued", "running", "waiting"])
      .select("id")
      .maybeSingle()
  );
  const completed = Boolean(terminalized);

  await releaseSessionRun({
    projectId: input.projectId,
    sessionId: run.agentSessionId,
    runId: run.id,
  });

  const recipient = run.completionRecipient;
  const parentRunId = recipient === "creative_director" ? run.parentRunId : null;
  if (completed && recipient === "creative_director" && parentRunId && input.wakeParent) {
    await input.wakeParent(parentRunId);
  }

  const refreshed = (await getDomainRun(input.projectId, input.runId)) ?? run;
  return { run: refreshed, recipient, parentRunId, completed };
}

// ---------------------------------------------------------------------------
// Root-family projection
// ---------------------------------------------------------------------------

export interface RootRunFamily {
  root: DomainRunRecord;
  children: Array<DomainRunRecord & { reportActionId: string | null; report: DomainReportV1 | null }>;
}

/**
 * The root run and its child domain runs (`parent_run_id` linkage), each
 * joined with its terminal report. Every generated asset in the family is
 * traceable: asset -> creating action -> `actions.orchestrator_run_id` ->
 * child run -> trusted origin on this root.
 */
export async function getRootRunFamily(rootRunId: string): Promise<RootRunFamily> {
  const db = getServiceSupabase();
  const rootRow = await runQuery(
    "domainSessionStore.getRootRunFamily root",
    db
      .from("orchestrator_runs")
      .select(DOMAIN_RUN_COLUMNS)
      .eq("id", rootRunId)
      .maybeSingle()
  );
  if (!rootRow) {
    throw new ApiError("not_found", `Orchestrator run not found: ${rootRunId}`);
  }
  const root = mapDomainRun(rootRow as unknown as DomainRunRow);

  const childRows = await runQuery(
    "domainSessionStore.getRootRunFamily children",
    db
      .from("orchestrator_runs")
      .select(DOMAIN_RUN_COLUMNS)
      .eq("parent_run_id", rootRunId)
      .order("created_at", { ascending: true })
  );
  const children = ((childRows as unknown as unknown as DomainRunRow[]) ?? []).map(mapDomainRun);

  const reportByRun = new Map<string, { id: string; params: DomainReportV1 }>();
  if (children.length > 0) {
    const reports = await runQuery(
      "domainSessionStore.getRootRunFamily reports",
      db
        .from("actions")
        .select("id, orchestrator_run_id, params")
        .eq("tool", "domain_report")
        .in(
          "orchestrator_run_id",
          children.map((child) => child.id)
        )
    );
    for (const row of (reports as Array<{
      id: string;
      orchestrator_run_id: string;
      params: DomainReportV1;
    }>) ?? []) {
      reportByRun.set(row.orchestrator_run_id, { id: row.id, params: row.params });
    }
  }

  return {
    root,
    children: children.map((child) => ({
      ...child,
      reportActionId: reportByRun.get(child.id)?.id ?? null,
      report: reportByRun.get(child.id)?.params ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Same-project asset validation
// ---------------------------------------------------------------------------

/**
 * Every task/report asset reference must resolve inside the run's project.
 * Intrinsic asset roles and typed asset edges are never rewritten here — this
 * is validation only.
 */
async function assertSameProjectAssets(
  projectId: string,
  assetIds: readonly string[],
  context: "task" | "report"
): Promise<void> {
  const uniqueIds = [...new Set(assetIds)].filter(Boolean);
  if (uniqueIds.length === 0) return;
  const db = getServiceSupabase();
  const data = await runQuery(
    "domainSessionStore.assertSameProjectAssets",
    db.from("assets").select("id").eq("project_id", projectId).in("id", uniqueIds)
  );
  const found = new Set(((data as Array<{ id: string }>) ?? []).map((row) => row.id));
  const missing = uniqueIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ApiError(
      "validation_failed",
      `${context === "task" ? "Task" : "Report"} asset references must belong to project ${projectId}.`,
      {
        fields: missing.map((id) => ({
          path: context === "task" ? "task.preserve.assetIds" : "report.outcome.outputs",
          message: `Asset ${id} does not exist in this project.`,
        })),
      }
    );
  }
}
