// Specialist-agent orchestration PR 6 — the ONE internal domain-run service.
//
// This module is the only way a finite domain assignment enters or leaves the
// durable transport:
//
//   dispatchDomainRun     — single-transaction creation (create_domain_run_dispatch):
//                           reserve the idempotency key, allocate the next
//                           session sequence, create the task-bearing finite
//                           run, persist any required gate, enqueue the
//                           existing dispatch row. Replays return the same
//                           identities.
//   finalizeDomainTurn    — single-transaction idempotent turn finalization
//                           (finalize_domain_run_turn): immutable domain_report
//                           action + ordered action_assets, terminalize the
//                           child, CAS the guarded session summary, clear
//                           active ownership (advancing the durable claim
//                           generation), apply the root delegation action, and
//                           wake the parent dispatch exactly once. A
//                           creator-direct completion mutates no parent and
//                           wakes nothing.
//   continueDomainSession — the only answer path for blocked/question turns: a
//                           fingerprinted one-use successor run with
//                           continues_run_id, current pins, and a NEW session
//                           sequence. Never an out-of-band message.
//   supersedeQueuedDomainRun / cancelDomainRun — origin-isolated queue policy.
//
// TRUST BOUNDARY: every input here is server-derived. This service is never
// mounted on a route; creator-direct public routes arrive in PR 12 and must
// derive the trusted origin, task kind, scope, and budgets server-side before
// calling in. It composes with (never re-implements) the PR 5 store
// (domain-session-store.ts) and the PR 7 compaction CAS (session-compaction.ts).

import { createHash } from "node:crypto";
import type {
  AgentDomain,
  DomainReportV1,
  DomainTaskV1,
} from "@popcorn/shared/domain-agent-contract";
import type {
  BoundRequiredOutput,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import {
  getAgentSession,
  getDomainRun,
  listSessionRuns,
  type CompletionRecipient,
  type DomainRunRecord,
} from "@/lib/api/v1/domain-session-store";
import { recordRerunExecutorCallback } from "@/lib/api/v1/rerun-lifecycle-store";
import {
  rerunExecutorCallbackToken,
} from "./rerun-callback-fence";
import {
  type BoundExecutorOutput,
  validateBoundExecutorOutputs,
} from "./rerun-executor-registry";
import {
  buildSessionSummaryCasUpdate,
  compactSessionHistory,
  type AgentSessionSummaryV1,
  type SessionSummaryCasUpdate,
} from "@/lib/orchestrator-context/session-compaction";

const TERMINAL_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
  "superseded",
]);

const PG_UNIQUE_VIOLATION = "23505";
const PG_LIMIT_EXCEEDED = "54000";
const PG_STALE = "55000";

// ---------------------------------------------------------------------------
// Limits. Depth (max two) is a DB trigger; report uniqueness is a partial
// unique index; the engine bounds model turns. These bound fan-out and
// continuation so two domains cannot bounce one unmet requirement forever.
// ---------------------------------------------------------------------------

export interface DomainRunLimits {
  maxChildRunsPerRoot: number;
  maxContinuationChain: number;
  maxSessionTurns: number;
  /** Blocked reports allowed per identical requirement in one root family. */
  maxBlockedReportsPerRequirement: number;
}

export const DEFAULT_DOMAIN_RUN_LIMITS: DomainRunLimits = Object.freeze({
  maxChildRunsPerRoot: 16,
  maxContinuationChain: 4,
  maxSessionTurns: 500,
  maxBlockedReportsPerRequirement: 2,
});

// ---------------------------------------------------------------------------
// Deterministic identities: the run id derives from the idempotency key, so a
// concurrent duplicate collides in the database and its retry replays.
// ---------------------------------------------------------------------------

function deterministicUuid(...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  // Format as a valid v4-shaped UUID (version/variant bits fixed).
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${((parseInt(digest[16], 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

// ---------------------------------------------------------------------------
// Dispatch creation
// ---------------------------------------------------------------------------

/** Server-derived trusted causation; there is no client-declared variant. */
export type TrustedDispatchOrigin =
  | { kind: "creative_director"; parentRunId: string; rootActionId: string }
  | { kind: "creator_direct"; actorId: string; request: Record<string, unknown> };

export interface DispatchDomainRunInput {
  projectId: string;
  domain: AgentDomain;
  /** The full server-built DomainTask.v1 assignment. */
  task: DomainTaskV1;
  inputSummary: string;
  budgetUsd?: number;
  origin: TrustedDispatchOrigin;
  /** Predecessor for a blocked/question successor (same session, one use). */
  continuesRunId?: string;
  /** Current pins written once with the assignment (DomainRunPins.v1). */
  pins?: Record<string, unknown>;
  /** Persist a required gate (e.g. an unconfirmed creator-direct proposal). */
  gateStage?: string;
  /** false = quote mode: no dispatch row, never occupies the session slot. */
  enqueue?: boolean;
  /**
   * Server-derived idempotency key. Root-origin callers use the delegation
   * action id; creator-direct callers bind project, actor, request digest,
   * and approval token (PR 12).
   */
  idempotencyKey: string;
  limits?: Partial<DomainRunLimits>;
}

export interface DomainRunDispatch {
  runId: string;
  sessionId: string;
  sessionSequence: number;
  /** False when this call replayed an already-created assignment. */
  created: boolean;
  gateId: string | null;
  dispatchEnqueued: boolean;
}

function dispatchIdempotencyScope(projectId: string): string {
  return `domain-dispatch:${projectId}`;
}

function dispatchRequestHash(input: DispatchDomainRunInput): string {
  return requestHash({
    projectId: input.projectId,
    domain: input.domain,
    task: input.task,
    inputSummary: input.inputSummary,
    budgetUsd: input.budgetUsd ?? null,
    origin: input.origin,
    continuesRunId: input.continuesRunId ?? null,
    pins: input.pins ?? null,
    gateStage: input.gateStage ?? null,
    enqueue: input.enqueue ?? true,
  });
}

interface DispatchRpcRow {
  run_id: string;
  agent_session_id: string;
  session_sequence: number;
  created: boolean;
  gate_id: string | null;
  dispatch_enqueued: boolean;
}

function isDbError(err: unknown, dbCode: string, marker?: string): boolean {
  if (!(err instanceof ApiError) || err.code !== "database_error") return false;
  if (err.details?.dbCode !== dbCode) return false;
  if (!marker) return true;
  const message = err.details?.dbMessage;
  return typeof message === "string" && message.includes(marker);
}

/** True when a dispatch/continuation hit a fan-out, chain, or turn limit. */
export function isDomainRunLimitError(err: unknown): boolean {
  return isDbError(err, PG_LIMIT_EXCEEDED);
}

/** True when a late report or callback lost the durable session-claim CAS. */
export function isStaleDomainTurnError(err: unknown): boolean {
  return (
    isDbError(err, PG_STALE, "stale_session_claim") ||
    isDbError(err, PG_STALE, "stale_domain_report") ||
    isDbError(err, PG_STALE, "stale_domain_failure")
  );
}

/**
 * Create-and-enqueue one finite domain assignment in ONE database
 * transaction. Replaying the same idempotency key returns the same
 * identities; reusing it with changed input is rejected.
 */
export async function dispatchDomainRun(
  input: DispatchDomainRunInput
): Promise<DomainRunDispatch> {
  const limits = { ...DEFAULT_DOMAIN_RUN_LIMITS, ...input.limits };
  const scope = dispatchIdempotencyScope(input.projectId);
  const hash = dispatchRequestHash(input);
  const runId = deterministicUuid("domain-run", scope, input.idempotencyKey);

  const call = async (): Promise<DomainRunDispatch> => {
    const db = getServiceSupabase();
    const rows = await runQuery(
      "domainRunService.dispatchDomainRun",
      db.rpc("create_domain_run_dispatch", {
        p_idempotency_scope: scope,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: hash,
        p_run_id: runId,
        p_project_id: input.projectId,
        p_domain: input.domain,
        p_input_summary: input.inputSummary,
        p_budget_usd: input.budgetUsd ?? null,
        p_task_kind: input.task.taskKind,
        p_task_params: input.task,
        p_origin_kind: input.origin.kind,
        p_parent_run_id:
          input.origin.kind === "creative_director" ? input.origin.parentRunId : null,
        p_root_action_id:
          input.origin.kind === "creative_director" ? input.origin.rootActionId : null,
        p_origin_actor_id:
          input.origin.kind === "creator_direct" ? input.origin.actorId : null,
        p_origin_request:
          input.origin.kind === "creator_direct"
            ? { schemaVersion: "CreatorDirectOrigin.v1", ...input.origin.request }
            : null,
        p_continues_run_id: input.continuesRunId ?? null,
        p_pins: input.pins
          ? { schemaVersion: "DomainRunPins.v1", ...input.pins }
          : null,
        p_gate_stage: input.gateStage ?? null,
        p_enqueue: input.enqueue ?? true,
        p_max_children_per_root: limits.maxChildRunsPerRoot,
        p_max_continuation_chain: limits.maxContinuationChain,
        p_max_session_turns: limits.maxSessionTurns,
        p_max_blocked_reports_per_requirement: limits.maxBlockedReportsPerRequirement,
      })
    );
    const row = (rows as DispatchRpcRow[])[0];
    if (!row) {
      throw new ApiError("internal_error", "Domain dispatch returned no row.");
    }
    return {
      runId: row.run_id,
      sessionId: row.agent_session_id,
      sessionSequence: row.session_sequence,
      created: row.created,
      gateId: row.gate_id,
      dispatchEnqueued: row.dispatch_enqueued,
    };
  };

  try {
    return await call();
  } catch (err) {
    if (isDbError(err, PG_UNIQUE_VIOLATION, "domain_dispatch_idempotency_conflict")) {
      throw new ApiError(
        "idempotency_conflict",
        "Domain dispatch idempotency key reused with changed input.",
        { reason: "domain_dispatch_input_changed", idempotencyKey: input.idempotencyKey }
      );
    }
    // A concurrent duplicate lost the run/idempotency primary-key race and its
    // whole transaction rolled back; one retry lands in the replay branch and
    // returns the winner's identities.
    if (isDbError(err, PG_UNIQUE_VIOLATION)) {
      return call();
    }
    throw err;
  }
}

export interface DispatchDomainRunBatchInput {
  projectId: string;
  parentRunId: string;
  rootActionId: string;
  assignments: Array<{
    domain: AgentDomain;
    inputSummary: string;
    budgetUsd: number;
    task: DomainTaskV1;
  }>;
}

/**
 * Atomically create the independent children of one root action. Keeping this
 * as one RPC is essential: two ordinary dispatch RPCs could leave a root join
 * with only one child after a process crash or a budget/session rejection.
 */
export async function dispatchDomainRunBatch(
  input: DispatchDomainRunBatchInput
): Promise<DomainRunDispatch[]> {
  const domains = input.assignments.map((assignment) => assignment.domain);
  if (domains.length !== 2 || new Set(domains).size !== 2 || !domains.includes("visuals") || !domains.includes("audio")) {
    throw new ApiError("validation_failed", "Parallel dispatch requires exactly one Visuals and one Audio assignment.");
  }
  const scope = dispatchIdempotencyScope(input.projectId);
  const rows = await runQuery(
    "domainRunService.dispatchDomainRunBatch",
    getServiceSupabase().rpc("create_domain_run_dispatch_batch", {
      p_project_id: input.projectId,
      p_parent_run_id: input.parentRunId,
      p_root_action_id: input.rootActionId,
      p_assignments: input.assignments.map((assignment) => {
        const idempotencyKey = `root-action:${input.rootActionId}:${assignment.domain}`;
        const dispatch: DispatchDomainRunInput = {
          projectId: input.projectId,
          domain: assignment.domain,
          task: assignment.task,
          inputSummary: assignment.inputSummary,
          budgetUsd: assignment.budgetUsd,
          origin: { kind: "creative_director", parentRunId: input.parentRunId, rootActionId: input.rootActionId },
          idempotencyKey,
        };
        return {
          idempotencyScope: scope,
          idempotencyKey,
          requestHash: dispatchRequestHash(dispatch),
          runId: deterministicUuid("domain-run", scope, idempotencyKey),
          domain: assignment.domain,
          inputSummary: assignment.inputSummary,
          budgetUsd: assignment.budgetUsd,
          taskKind: assignment.task.taskKind,
          task: assignment.task,
        };
      }),
    })
  );
  return (rows as DispatchRpcRow[]).map((row) => ({
    runId: row.run_id,
    sessionId: row.agent_session_id,
    sessionSequence: row.session_sequence,
    created: row.created,
    gateId: row.gate_id,
    dispatchEnqueued: row.dispatch_enqueued,
  }));
}

// ---------------------------------------------------------------------------
// Turn finalization
// ---------------------------------------------------------------------------

export interface FinalizeDomainTurnInput {
  projectId: string;
  runId: string;
  /** Caller-reserved; defaults to a deterministic id so retries converge. */
  reportActionId?: string;
  report: DomainReportV1;
  /**
   * The durable session claim generation the reporting worker holds. When
   * provided, finalization compare-and-sets against the session so a
   * reclaimed worker cannot commit late even after its transient dispatch
   * lease expired.
   */
  expectedClaimGeneration?: number;
  /**
   * Observability hook invoked AFTER the transaction commits, only when this
   * caller performed the terminal transition of a root-origin run. The
   * durable wake (the parent dispatch row) is written inside the transaction;
   * this hook never fires for creator-direct completion.
   */
  onParentWake?: (parentRunId: string) => void | Promise<void>;
}

export interface DomainTurnFinalization {
  reportActionId: string;
  /** True when this caller performed the terminal transition (and any wake). */
  performed: boolean;
  recipient: CompletionRecipient;
  parentRunId: string | null;
  wokeParent: boolean;
  summaryApplied: boolean;
}

function reportOutputs(report: DomainReportV1): Array<{ assetId: string; role: string }> {
  if (report.outcome.outcome !== "done") return [];
  return report.outcome.outputs.map((output) => ({
    assetId: output.assetId,
    role: output.intrinsicRole,
  }));
}

export async function loadProposalExecutorCausation(input: {
  projectId: string;
  executionReservationId: string;
  childRunId: string;
  outputAssetIds: readonly string[];
}): Promise<{ primitiveActionIds: string[]; budgetReservationKeys: string[] }> {
  if (input.outputAssetIds.length === 0) {
    return { primitiveActionIds: [], budgetReservationKeys: [] };
  }
  const db = getServiceSupabase();
  const execution = await runQuery(
    "domainRunService.proposalExecutionBudget",
    db
      .from("rerun_execution_reservations")
      .select("budget_reservation_id")
      .eq("id", input.executionReservationId)
      .eq("project_id", input.projectId)
      .single()
  ) as { budget_reservation_id: string };
  const links = await runQuery(
    "domainRunService.proposalOutputActions",
    db
      .from("action_assets")
      .select("action_id,asset_id")
      .eq("project_id", input.projectId)
      .eq("direction", "output")
      .in("asset_id", [...input.outputAssetIds])
  ) as Array<{ action_id: string; asset_id: string }>;
  const candidateActionIds = [...new Set(links.map((link) => link.action_id))];
  if (candidateActionIds.length === 0) {
    throw new ApiError(
      "validation_failed",
      "Proposal domain output has no primitive action causation."
    );
  }
  const actions = await runQuery(
    "domainRunService.proposalPrimitiveActions",
    db
      .from("actions")
      .select("id")
      .eq("project_id", input.projectId)
      .eq("orchestrator_run_id", input.childRunId)
      .eq("status", "applied")
      .neq("tool", "domain_report")
      .in("id", candidateActionIds)
  ) as Array<{ id: string }>;
  const appliedActionIds = actions.map((action) => action.id);
  const budgets = appliedActionIds.length > 0
    ? await runQuery(
        "domainRunService.proposalPrimitiveBudgets",
        db
          .from("orchestrator_budget_reservations")
          .select("action_id,reservation_key")
          .eq("project_id", input.projectId)
          .eq("orchestrator_run_id", input.childRunId)
          .eq("status", "settled")
          .eq("parent_reservation_id", execution.budget_reservation_id)
          .in("action_id", appliedActionIds)
      ) as Array<{ action_id: string; reservation_key: string }>
    : [];
  const budgetByAction = new Set(budgets.map((budget) => budget.action_id));
  const primitiveActionIds = appliedActionIds.filter((actionId) =>
    budgetByAction.has(actionId)
  );
  const primitiveSet = new Set(primitiveActionIds);
  for (const assetId of input.outputAssetIds) {
    const caused = links.some(
      (link) =>
        link.asset_id === assetId &&
        primitiveSet.has(link.action_id) &&
        budgetByAction.has(link.action_id)
    );
    if (!caused) {
      throw new ApiError(
        "validation_failed",
        `Proposal domain output ${assetId} lacks settled primitive budget causation.`
      );
    }
  }
  return {
    primitiveActionIds,
    budgetReservationKeys: [
      ...new Set(budgets.map((budget) => budget.reservation_key)),
    ],
  };
}

export async function recordProposalExecutorCallback(
  input: {
    projectId: string;
    run: DomainRunRecord;
    reportActionId: string;
    report: DomainReportV1;
  },
  recordCallback: typeof recordRerunExecutorCallback =
    recordRerunExecutorCallback,
  loadCausation: typeof loadProposalExecutorCausation =
    loadProposalExecutorCausation
): Promise<void> {
  const task = input.run.taskParams;
  const approval = task?.approvalContext;
  const callback = approval?.rerunCallback;
  const reservationId = approval?.executionReservationId;
  if (!task || !callback || !reservationId) return;
  const requiredOutputs = task.requiredOutputs.filter((output) =>
    output.bindingId !== undefined &&
    output.workItemId === callback.workItemId
  );
  if (requiredOutputs.length !== task.requiredOutputs.length) {
    throw new ApiError(
      "validation_failed",
      "Rerun domain task contains an unbound callback output."
    );
  }
  const token = rerunExecutorCallbackToken({
    executionReservationId: reservationId,
    workItemId: callback.workItemId,
    executorId: callback.executorId,
  });
  let outcome: "completed" | "failed" = "failed";
  let outputs: BoundExecutorOutput[] = [];
  let primitiveActionIds: string[] = [];
  let budgetReservationKeys: string[] = [];
  if (input.report.outcome.outcome === "done") {
    outputs = input.report.outcome.outputs.flatMap((output) =>
      output.bindingId !== undefined &&
      output.workItemId !== undefined &&
      output.target !== undefined &&
      output.kind !== undefined &&
      output.role !== undefined &&
      output.ordinal !== undefined
        ? [output as BoundExecutorOutput]
        : []
    );
    const callbackWorkItem: RerunWorkItem = task.domain === "audio"
      ? {
          workItemId: callback.workItemId,
          owner: "audio",
          kind: "revise_audio",
          targets: [...task.targets],
          requiredOutputs: requiredOutputs as unknown as BoundRequiredOutput[],
        }
      : {
          workItemId: callback.workItemId,
          owner: "visuals",
          kind: "revise_visuals",
          targets: [...task.targets],
          requiredOutputs: requiredOutputs as unknown as BoundRequiredOutput[],
        };
    validateBoundExecutorOutputs(callbackWorkItem, outputs);
    const causation = await loadCausation({
      projectId: input.projectId,
      executionReservationId: reservationId,
      childRunId: input.run.id,
      outputAssetIds: outputs.map((output) => output.assetId),
    });
    primitiveActionIds = causation.primitiveActionIds;
    budgetReservationKeys = causation.budgetReservationKeys;
    outcome = "completed";
  }
  try {
    await recordCallback({
      projectId: input.projectId,
      reservationId,
      workItemId: callback.workItemId,
      executorId: callback.executorId,
      callbackToken: token,
      callbackGeneration: callback.generation,
      outcome,
      result: {
        providerResult: { domainReport: input.report },
        childRunId: input.run.id,
        reportActionId: input.reportActionId,
        primitiveActionIds,
        budgetReservationKeys,
        outputs,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "idempotency_in_progress") {
      // Cancellation or lease takeover won the fence. The immutable outputs
      // remain pooled, but the stale child cannot advance proposal state.
      return;
    }
    throw error;
  }
}

function summaryEvent(
  run: DomainRunRecord,
  report: DomainReportV1,
  reportActionId: string
) {
  const outcome = report.outcome;
  return {
    sequence: run.sessionSequence ?? 0,
    reportSummary:
      outcome.outcome === "done"
        ? outcome.sessionSummary
        : outcome.outcome === "blocked"
          ? `Blocked: ${outcome.reason}`
          : undefined,
    unresolvedQuestion: outcome.outcome === "question" ? outcome.question : undefined,
    assetIds: outcome.outcome === "done" ? outcome.outputs.map((o) => o.assetId) : [],
    actionIds: [reportActionId],
  };
}

interface FinalizeRpcRow {
  report_action_id: string;
  performed: boolean;
  recipient: CompletionRecipient;
  parent_run_id: string | null;
  woke_parent: boolean;
  summary_applied: boolean;
}

/**
 * Finalize one domain turn in ONE idempotent transaction. Exactly one caller
 * performs the terminal transition; that caller's transaction also applies
 * the root delegation action and durably wakes the parent dispatch. A replay
 * of the same immutable report is a no-op; a drifted replay, a late report to
 * a terminal run, or a stale session claim is rejected with nothing written.
 */
export async function finalizeDomainTurn(
  input: FinalizeDomainTurnInput
): Promise<DomainTurnFinalization> {
  const run = await getDomainRun(input.projectId, input.runId);
  if (!run) {
    throw new ApiError("not_found", `Domain run not found: ${input.runId}`);
  }
  if (!run.agentSessionId) {
    throw new ApiError("validation_failed", `Run ${input.runId} is not a finite domain run.`, {
      fields: [{ path: "runId", message: "Turn finalization applies to domain runs only." }],
    });
  }

  const reportActionId =
    input.reportActionId ?? deterministicUuid("domain-report", input.runId);
  const outputs = reportOutputs(input.report);

  // Build the guarded summary CAS from current session state. A losing CAS is
  // skipped inside the transaction (never blocks the report); the next turn
  // re-compacts from durable history.
  const session = await getAgentSession(input.projectId, run.agentRole as AgentDomain);
  let cas: SessionSummaryCasUpdate | null = null;
  let expectedSummaryVersion = 0;
  if (session && run.sessionSequence != null) {
    const summary = compactSessionHistory({
      prior: (session.summary as AgentSessionSummaryV1 | null) ?? null,
      events: [summaryEvent(run, input.report, reportActionId)],
    });
    cas = buildSessionSummaryCasUpdate({
      state: {
        summaryThroughSequence: session.summaryThroughSequence,
        summaryVersion: session.summaryVersion,
        nextSequence: session.nextSequence,
      },
      expectedSummaryVersion: session.summaryVersion,
      throughSequence: run.sessionSequence,
      summary,
    });
    expectedSummaryVersion = session.summaryVersion;
  }

  const db = getServiceSupabase();
  let rows: unknown;
  try {
    rows = await runQuery(
      "domainRunService.finalizeDomainTurn",
      db.rpc("finalize_domain_run_turn", {
        p_project_id: input.projectId,
        p_run_id: input.runId,
        p_report_action_id: reportActionId,
        p_report: input.report,
        p_output_asset_ids: outputs.map((output) => output.assetId),
        p_output_roles: outputs.map((output) => output.role),
        p_expected_claim_generation: input.expectedClaimGeneration ?? null,
        p_summary: cas?.summary ?? null,
        p_summary_through_sequence: cas?.summaryThroughSequence ?? 0,
        p_expected_summary_version: expectedSummaryVersion,
      })
    );
  } catch (err) {
    if (isDbError(err, PG_UNIQUE_VIOLATION, "domain_report_replay_mismatch")) {
      throw new ApiError(
        "idempotency_conflict",
        `Finite run ${input.runId} already has a different immutable domain report.`,
        { reason: "domain_report_replay_mismatch", runId: input.runId }
      );
    }
    throw err;
  }

  const row = (rows as FinalizeRpcRow[])[0];
  if (!row) {
    throw new ApiError("internal_error", "Turn finalization returned no row.");
  }
  const finalization: DomainTurnFinalization = {
    reportActionId: row.report_action_id,
    performed: row.performed,
    recipient: row.recipient,
    parentRunId: row.parent_run_id,
    wokeParent: row.woke_parent,
    summaryApplied: row.summary_applied,
  };
  await recordProposalExecutorCallback({
    projectId: input.projectId,
    run,
    reportActionId: finalization.reportActionId,
    report: input.report,
  });
  if (finalization.wokeParent && finalization.parentRunId && input.onParentWake) {
    await input.onParentWake(finalization.parentRunId);
  }
  return finalization;
}

// ---------------------------------------------------------------------------
// Continuation: blocked/question -> fingerprinted one-use successor
// ---------------------------------------------------------------------------

export interface ContinueDomainSessionInput {
  projectId: string;
  /** The terminal blocked/question run being answered. */
  continuesRunId: string;
  /** Must match a question report's fingerprint; a stale answer is rejected. */
  answerFingerprint?: string;
  task: DomainTaskV1;
  inputSummary: string;
  budgetUsd?: number;
  origin: TrustedDispatchOrigin;
  pins?: Record<string, unknown>;
  idempotencyKey: string;
  limits?: Partial<DomainRunLimits>;
}

/**
 * The ONLY way a questioned/blocked session resumes: a later sequenced finite
 * run continuing the closed one. The DB enforces one successor per run
 * (unique index), same-session terminal continuation (trigger), and this
 * service enforces the question fingerprint so a stale answer cannot resume
 * changed work.
 */
export async function continueDomainSession(
  input: ContinueDomainSessionInput
): Promise<DomainRunDispatch> {
  const predecessor = await getDomainRun(input.projectId, input.continuesRunId);
  if (!predecessor || !predecessor.agentSessionId) {
    throw new ApiError("not_found", `Domain run not found: ${input.continuesRunId}`);
  }
  if (!TERMINAL_RUN_STATUSES.has(predecessor.status)) {
    throw new ApiError(
      "validation_failed",
      `Run ${input.continuesRunId} is not terminal; only a closed turn can be continued.`,
      { fields: [{ path: "continuesRunId", message: "Predecessor must be terminal." }] }
    );
  }

  const history = await listSessionRuns(predecessor.agentSessionId, "service");
  const entry = history.find((candidate) => candidate.runId === predecessor.id);
  const outcome = entry?.report?.outcome;
  if (!outcome || (outcome.outcome !== "blocked" && outcome.outcome !== "question")) {
    throw new ApiError(
      "validation_failed",
      `Run ${input.continuesRunId} did not end blocked or with a question; nothing to continue.`,
      { fields: [{ path: "continuesRunId", message: "Only blocked/question turns continue." }] }
    );
  }
  if (outcome.outcome === "question") {
    if (!input.answerFingerprint || input.answerFingerprint !== outcome.fingerprint) {
      throw new ApiError(
        "validation_failed",
        "Answer fingerprint does not match the question; the work may have changed.",
        { fields: [{ path: "answerFingerprint", message: "Stale or missing fingerprint." }] }
      );
    }
  }

  return dispatchDomainRun({
    projectId: input.projectId,
    domain: predecessor.agentRole as AgentDomain,
    task: input.task,
    inputSummary: input.inputSummary,
    budgetUsd: input.budgetUsd,
    origin: input.origin,
    continuesRunId: input.continuesRunId,
    pins: input.pins,
    idempotencyKey: input.idempotencyKey,
    limits: input.limits,
  });
}

// ---------------------------------------------------------------------------
// Queue policy: origin-isolated supersession + cancellation
// ---------------------------------------------------------------------------

export interface SupersedeQueuedDomainRunInput {
  projectId: string;
  runId: string;
  /** Who is superseding. Creator-direct work can NEVER invalidate a
   * root-origin (orchestrated) run or its pins. */
  origin: { kind: "creative_director" | "creator_direct" };
}

/**
 * Mark a still-queued assignment superseded. Only a queued run (never one
 * that started executing) can be superseded, and only by its own origin kind:
 * creator-direct work cannot invalidate an orchestrated run.
 */
export async function supersedeQueuedDomainRun(
  input: SupersedeQueuedDomainRunInput
): Promise<boolean> {
  const run = await getDomainRun(input.projectId, input.runId);
  if (!run || !run.agentSessionId) {
    throw new ApiError("not_found", `Domain run not found: ${input.runId}`);
  }
  if (run.originKind !== input.origin.kind) {
    throw new ApiError(
      "forbidden",
      run.originKind === "creative_director"
        ? "Creator-direct work cannot supersede an orchestrated (root-origin) run."
        : "An orchestrated caller cannot supersede a creator-direct run.",
      { reason: "domain_run_origin_isolation", runId: input.runId }
    );
  }
  const db = getServiceSupabase();
  const now = new Date().toISOString();
  const data = await runQuery(
    "domainRunService.supersedeQueuedDomainRun",
    db
      .from("orchestrator_runs")
      .update({ status: "superseded", superseded_at: now, wait_reason: null, updated_at: now })
      .eq("id", input.runId)
      .eq("project_id", input.projectId)
      .eq("status", "queued")
      .select("id")
      .maybeSingle()
  );
  return Boolean(data);
}

export interface CancelDomainRunInput {
  projectId: string;
  runId: string;
}

/**
 * Cancel one finite domain run and fence everything behind it: the run goes
 * terminal (late reports are rejected by finalize), its session slot is
 * released (advancing the durable claim generation so in-flight provider
 * callbacks are fenced), and its causally linked jobs are canceled. Sessions
 * themselves are permanent and are never canceled.
 */
export async function cancelDomainRun(input: CancelDomainRunInput): Promise<boolean> {
  const run = await getDomainRun(input.projectId, input.runId);
  if (!run || !run.agentSessionId) {
    throw new ApiError("not_found", `Domain run not found: ${input.runId}`);
  }
  const db = getServiceSupabase();
  const rows = await runQuery(
    "domainRunService.cancelDomainRun",
    db.rpc("cancel_domain_run", {
      p_project_id: input.projectId,
      p_run_id: input.runId,
    })
  );
  return Boolean((rows as Array<{ canceled: boolean }>)[0]?.canceled);
}

export interface FailDomainRunTurnInput {
  projectId: string;
  runId: string;
  /** A server-built error; this is never model-authored report content. */
  error: Record<string, unknown>;
  /** Required ownership fence from the dispatch claim. */
  expectedClaimGeneration: number;
}

/**
 * Terminalize an engine failure without allowing a reclaimed worker to alter a
 * newer session owner. Unlike cancellation, this keeps the failure visible to
 * the parent delegation action and wakes it exactly once.
 */
export async function failDomainRunTurn(input: FailDomainRunTurnInput): Promise<boolean> {
  const db = getServiceSupabase();
  const rows = await runQuery(
    "domainRunService.failDomainRunTurn",
    db.rpc("fail_domain_run_turn", {
      p_project_id: input.projectId,
      p_run_id: input.runId,
      p_error: input.error,
      p_expected_claim_generation: input.expectedClaimGeneration,
    })
  );
  return Boolean((rows as Array<{ failed: boolean }>)[0]?.failed);
}

// ---------------------------------------------------------------------------
// Queue visibility
// ---------------------------------------------------------------------------

export interface SessionQueueState {
  sessionId: string;
  activeRunId: string | null;
  claimGeneration: number;
  queue: Array<{
    runId: string;
    sessionSequence: number;
    status: string;
    active: boolean;
  }>;
}

/** Observe-first queue projection: the active run plus queued sequences. */
export async function getSessionQueueState(
  projectId: string,
  domain: AgentDomain
): Promise<SessionQueueState | null> {
  const session = await getAgentSession(projectId, domain);
  if (!session) return null;
  const runs = await listSessionRuns(session.id, "service");
  return {
    sessionId: session.id,
    activeRunId: session.activeRunId,
    claimGeneration: session.claimGeneration,
    queue: runs
      .filter((run) => !TERMINAL_RUN_STATUSES.has(run.status))
      .map((run) => ({
        runId: run.runId,
        sessionSequence: run.sessionSequence,
        status: run.status,
        active: run.runId === session.activeRunId,
      })),
  };
}
