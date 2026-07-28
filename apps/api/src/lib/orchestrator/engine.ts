// The autonomous orchestrator engine: the persistent, gated, multi-turn loop on
// top of the single-turn primitives (the model + executeRegisteredTool). A run is
// durable state (orchestrator_runs + its actions), not a live process — each call
// loads the run, drives turns until it parks (async job / approval gate) or
// finishes, then exits. Re-entry (resume) is the same loop re-applied. Deliberately
// calls model + executeRegisteredTool directly (rather than runToolLoopTurn) so it
// can pause BEFORE a gated tool executes.
//
// All side effects are injectable (store, jobs, model, registry) so the loop is
// unit-testable with fakes — no DB, no network.

import { createAction, updateAction } from "@/lib/api/v1/store";
import { randomUUID } from "node:crypto";
import {
  getOrchestratorRun,
  claimOrchestratorRunResume,
  listRunActions,
  listRunGates,
  markGateReached,
  updateOrchestratorRun,
  type OrchestratorRun,
  type OrchestratorRunGate,
  type RunActionSummary,
  type UpdateOrchestratorRunPatch,
} from "@/lib/api/v1/orchestrator-store";
import { createDefaultToolRegistry } from "@/lib/orchestrator-tools/default-registry";
import { toOrchestratorRegistry } from "@/lib/orchestrator-tools/to-orchestrator-registry";
import { recoverDurableOrchestratorJob } from "./job-recovery";
import { orchestratorModel, type OrchestratorModel } from "./model";
import { executeRegisteredTool, type ToolRegistry } from "./registry";
import { classifyToolFailure } from "./tool-errors";
import { withStoreRetry, type RetryOptions } from "./retry";
import {
  billableUsdSoFar,
  currentRunUserId,
  getWorkspaceOwnerUserId,
  userHasAnyProviderKey,
  withProviderKeyUser,
} from "@/lib/provider-keys/resolve";
import { applyCreditTransaction, getCreditBalance } from "@/lib/api/v1/credits";
import { ApiError } from "@/core/errors";
import { createToolExecutionContext } from "./tool-context";
import type { ToolCallResult, ToolName } from "./types";
import type { AgentDomain, DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import {
  isDispatchToolName,
  isToolName,
} from "@/lib/orchestrator-tools/capability-catalog";
import { createLogger } from "@/lib/v1/logger";
import { redactMessage } from "@/lib/v1/redact";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { uploadedFootageMetadataFromSummary } from "./uploaded-footage-selection";
import {
  resolveAgentDefinition,
  buildDomainReportFromCompletion,
  type AgentDefinition,
  type ResolveAgentDefinitionInput,
} from "./agent-definition";
import {
  failDomainRunTurn,
  finalizeDomainTurn,
  isStaleDomainTurnError,
} from "./domain-run-service";
import {
  projectDomainRecovery,
  type DomainRecoveryProjection,
} from "./domain-recovery-projection";
import {
  loadProjectGraphSnapshot,
  type ProjectGraphSnapshot,
} from "@/lib/orchestrator-context/graph-snapshot";
import {
  assertPreservePinsCurrent,
  buildDomainTargetScope,
  type DomainTargetScope,
} from "@/lib/orchestrator-context/target-scope";
import { prepareRegisteredTool } from "./registry";
import { isCreativeDirectorHierarchyEnabled } from "./feature-flag";

// Credits charged per generation = providerCostUsd * MARGIN, at 1 credit = $0.01.
const CREDIT_MARGIN = 2;
const CREDITS_PER_USD = 100;
const PG_INSUFFICIENT_FUNDS = "23514"; // apply_credit_transaction overdraw guard

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MODEL_TURN_TIMEOUT_MS = 60_000;
const MAX_RECOVERABLE_ASYNC_FAILURES_PER_TOOL = 3;
const AFTER_GATE_PREFIX = "after:";
const logger = createLogger();

export interface InvocationRecord {
  /** Reserved before a mutating tool executes; also becomes context.toolCallId. */
  actionId: string;
  projectId: string;
  orchestratorRunId: string;
  tool: string;
  status: "applied" | "failed" | "running";
  params: Record<string, unknown>;
  outputAssetIds: string[];
  jobIds: string[];
  costUsd?: number;
  error?: Record<string, unknown>;
}

// The persistence surface the loop depends on. The real implementation is
// defaultEngineStore(); tests inject a fake.
export interface OrchestratorEngineStore {
  getOrchestratorRun(runId: string): Promise<OrchestratorRun>;
  updateOrchestratorRun(
    runId: string,
    patch: UpdateOrchestratorRunPatch
  ): Promise<OrchestratorRun>;
  /** Atomically claims a waiting run for exactly one resume caller. */
  claimOrchestratorRunResume?: (runId: string) => Promise<OrchestratorRun | null>;
  listRunGates(runId: string): Promise<OrchestratorRunGate[]>;
  markGateReached(runId: string, stage: string): Promise<OrchestratorRunGate | null>;
  listRunActions(runId: string): Promise<RunActionSummary[]>;
  recordInvocation(input: InvocationRecord): Promise<void>;
  // Finalize a previously-recorded (running) invocation once its job is terminal.
  markInvocation(
    actionId: string,
    patch: {
      status: "running" | "applied" | "failed";
      jobIds?: string[];
      outputAssetIds?: string[];
      error?: Record<string, unknown>;
    }
  ): Promise<void>;
  /**
   * Resolve the finite domain run created by a delegate_* invocation
   * (orchestrator_runs.root_action_id linkage). Optional: fake stores that
   * never exercise delegation may omit it, in which case a running delegation
   * action keeps the run parked in the domain wait.
   */
  findDelegatedChildRun?: (
    rootActionId: string
  ) => Promise<{ id: string; status: string } | null>;
  /** Batch dispatches share one root action and therefore have a durable join. */
  findDelegatedChildRuns?: (
    rootActionId: string
  ) => Promise<Array<{ id: string; status: string }> >;
}

export interface JobStatusReader {
  getJob(
    jobId: string,
    projectId?: string
  ): Promise<
    | {
        status: string;
        result?: unknown;
        error?: { code?: string; message?: string } | null;
      }
    | null
    | undefined
  >;
}

export interface EngineDeps {
  /** The throwaway/owning workspace; tools execute in its scope. */
  workspaceId: string;
  actorId?: string;
  agentId?: string;
  messageId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  store?: OrchestratorEngineStore;
  model?: OrchestratorModel;
  /** Bridged orchestrator registry; defaults to the wired tools only. */
  registry?: ToolRegistry;
  jobs?: JobStatusReader;
  maxTurns?: number;
  modelTurnTimeoutMs?: number;
  /** Bounded retry for idempotent store ops, so a transient infra blip costs a retry, not the run. */
  retry?: RetryOptions;
  /**
   * Resolve the run's owning user (for bring-your-own provider keys). Injectable
   * so fake-store / no-DB runners can opt out; defaults to the workspace-owner
   * Supabase lookup.
   */
  resolveOwnerUserId?: (workspaceId: string) => Promise<string | null>;
  getCreditBalance?: typeof getCreditBalance;
  userHasAnyProviderKey?: typeof userHasAnyProviderKey;
  applyCreditTransaction?: typeof applyCreditTransaction;
  /** Fail-closed rollout control: absent roles remain queued. */
  enabledDomainRoles?: readonly AgentDomain[];
  /** Runtime controls require an explicit claimed-domain execution opt-in. */
  domainRuntimeEnabled?: boolean;
  /** Override the environment rollout fence in deterministic tests/callers. */
  creativeDirectorHierarchyEnabled?: boolean;
  /** Durable session claim generation carried by a claimed domain dispatch. */
  sessionClaimGeneration?: number;
  /** Domain transport seams keep deterministic local smoke tests provider-free. */
  finalizeDomainTurn?: typeof finalizeDomainTurn;
  failDomainRunTurn?: typeof failDomainRunTurn;
  /** Injectable for deterministic definition/transport tests. */
  resolveAgentDefinition?: (
    input: ResolveAgentDefinitionInput
  ) => Promise<AgentDefinition>;
  prepareDomainScope?: (input: {
    workspaceId: string;
    projectId: string;
    task: DomainTaskV1;
  }) => Promise<{ snapshot: ProjectGraphSnapshot; scope: DomainTargetScope }>;
}

export function defaultEngineStore(): OrchestratorEngineStore {
  return {
    getOrchestratorRun,
    updateOrchestratorRun,
    claimOrchestratorRunResume,
    listRunGates,
    markGateReached,
    listRunActions,
    async recordInvocation(input) {
      await createAction({
        id: input.actionId,
        projectId: input.projectId,
        orchestratorRunId: input.orchestratorRunId,
        tool: input.tool,
        status: input.status,
        params: input.params,
        outputAssetIds: input.outputAssetIds,
        jobIds: input.jobIds,
        error: input.error,
      });
    },
    async markInvocation(actionId, patch) {
      await updateAction(actionId, {
        status: patch.status,
        ...(patch.jobIds !== undefined ? { jobIds: patch.jobIds } : {}),
        ...(patch.outputAssetIds !== undefined
          ? { outputAssetIds: patch.outputAssetIds }
          : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      });
    },
    async findDelegatedChildRun(rootActionId) {
      const data = await runQuery(
        "engine.findDelegatedChildRun",
        getServiceSupabase()
          .from("orchestrator_runs")
          .select("id, status")
          .eq("root_action_id", rootActionId)
          .maybeSingle()
      );
      return (data as { id: string; status: string } | null) ?? null;
    },
    async findDelegatedChildRuns(rootActionId) {
      const data = await runQuery(
        "engine.findDelegatedChildRuns",
        getServiceSupabase()
          .from("orchestrator_runs")
          .select("id, status")
          .eq("root_action_id", rootActionId)
      );
      return (data as Array<{ id: string; status: string }> | null) ?? [];
    },
  };
}

let cachedRegistry: ToolRegistry | undefined;
function defaultRegistry(): ToolRegistry {
  if (!cachedRegistry) {
    cachedRegistry = toOrchestratorRegistry(createDefaultToolRegistry());
  }
  return cachedRegistry;
}

function nowIso(): string {
  return new Date().toISOString();
}

function registryForRejectedGate(
  registry: ToolRegistry,
  gates: OrchestratorRunGate[]
): ToolRegistry {
  const rejectedGate = gates.find((gate) => gate.status === "rejected");
  if (!rejectedGate) return registry;
  const toolName = rejectedGate.stage.startsWith(AFTER_GATE_PREFIX)
    ? rejectedGate.stage.slice(AFTER_GATE_PREFIX.length)
    : rejectedGate.stage;
  const tool = registry.get(toolName as ToolName);
  if (!tool) return registry;
  return new Map([[tool.name, tool]]);
}

function afterGateStage(toolName: string): string {
  return `${AFTER_GATE_PREFIX}${toolName}`;
}

async function finishIfAfterGateReached(
  run: OrchestratorRun,
  toolName: string,
  r: Resolved
): Promise<OrchestratorRun | null> {
  const gates = await r.store.listRunGates(run.id);
  const gate = gates.find((g) => g.stage === afterGateStage(toolName));
  if (!gate || (gate.status !== "pending" && gate.status !== "rejected")) return null;
  await r.store.markGateReached(run.id, gate.stage);
  return finish(run, "succeeded", r);
}

function resolved(deps: EngineDeps) {
  return {
    // Wrap the store so a transient blip in an idempotent op (read actions/gates,
    // patch the run) retries instead of failing the whole run. recordInvocation is
    // left un-retried inside withStoreRetry (non-idempotent append).
    store: withStoreRetry(deps.store ?? defaultEngineStore(), deps.retry),
    model: deps.model ?? orchestratorModel,
    registry: deps.registry ?? defaultRegistry(),
    jobs: deps.jobs ?? {
      getJob: (id: string, projectId?: string) =>
        projectId
          ? recoverDurableOrchestratorJob({
              workspaceId: deps.workspaceId,
              projectId,
              jobId: id,
            })
          : Promise.resolve(null),
    },
    maxTurns: deps.maxTurns ?? DEFAULT_MAX_TURNS,
    modelTurnTimeoutMs: deps.modelTurnTimeoutMs ?? DEFAULT_MODEL_TURN_TIMEOUT_MS,
    resolveOwnerUserId: deps.resolveOwnerUserId ?? getWorkspaceOwnerUserId,
    getCreditBalance: deps.getCreditBalance ?? getCreditBalance,
    userHasAnyProviderKey: deps.userHasAnyProviderKey ?? userHasAnyProviderKey,
    applyCreditTransaction: deps.applyCreditTransaction ?? applyCreditTransaction,
    enabledDomainRoles: deps.enabledDomainRoles ?? [],
    domainRuntimeEnabled: deps.domainRuntimeEnabled ?? false,
    creativeDirectorHierarchyEnabled:
      deps.creativeDirectorHierarchyEnabled ?? isCreativeDirectorHierarchyEnabled(),
    sessionClaimGeneration: deps.sessionClaimGeneration,
    finalizeDomainTurn: deps.finalizeDomainTurn ?? finalizeDomainTurn,
    failDomainRunTurn: deps.failDomainRunTurn ?? failDomainRunTurn,
    resolveAgentDefinition: deps.resolveAgentDefinition ?? resolveAgentDefinition,
    prepareDomainScope:
      deps.prepareDomainScope ??
      (async ({ workspaceId, projectId, task }) => {
        const snapshot = await loadProjectGraphSnapshot({ workspaceId, projectId });
        const scope = buildDomainTargetScope({
          snapshot,
          targets: task.targets,
          candidateAffectedAssetIds: task.candidateAffectedAssetIds,
        });
        assertPreservePinsCurrent(scope, snapshot, task.preserve);
        return { snapshot, scope };
      }),
    workspaceId: deps.workspaceId,
    actorId: deps.actorId,
    agentId: deps.agentId,
    messageId: deps.messageId,
    requestId: deps.requestId,
    metadata: deps.metadata,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// Start a run and drive it to a terminal/parked state.
export async function runOrchestratorToCompletion(
  runId: string,
  deps: EngineDeps
): Promise<OrchestratorRun> {
  const r = resolved(deps);
  let run = await r.store.getOrchestratorRun(runId);
  if (isDomainRun(run) && ((r.enabledDomainRoles.length > 0 && !domainRoleEnabled(run, r.enabledDomainRoles)) || !r.domainRuntimeEnabled || r.sessionClaimGeneration === undefined)) {
    return run;
  }
  if (run.status === "queued") {
    run = await r.store.updateOrchestratorRun(runId, {
      status: "running",
      startedAt: nowIso(),
    });
  }
  if (run.status !== "running") return run;
  const reconciled = await reconcileInFlightJob(run, r);
  if (reconciled) return reconciled;
  return driveGuarded(run, r);
}

// Re-enter a parked run. If it's waiting on an async job, advance only once the
// job is terminal; the job's own worker calls this on completion (no polling in
// the happy path), and a sweeper calls it for crash recovery.
export async function resumeOrchestratorRun(
  runId: string,
  deps: EngineDeps
): Promise<OrchestratorRun> {
  const r = resolved(deps);
  const run = await r.store.getOrchestratorRun(runId);
  if (isDomainRun(run) && ((r.enabledDomainRoles.length > 0 && !domainRoleEnabled(run, r.enabledDomainRoles)) || !r.domainRuntimeEnabled || r.sessionClaimGeneration === undefined)) {
    return run;
  }
  return resumeRun(run, r);
}

// Resume a parked run using an already-resolved dependency set. Keeping this
// separate lets the main loop reconcile an async job that finished between the
// tool returning `accepted` and the run being parked. That narrow timing window
// used to leave storyboard work marked complete while its keyframe attempt had
// already run against an incomplete storyboard.
async function resumeRun(run: OrchestratorRun, r: Resolved): Promise<OrchestratorRun> {
  // A completion callback can beat the initial invocation's action write and
  // transition to `waiting`. Do not start a second loop in that window: the
  // originating loop reconciles a terminal job immediately after it parks.
  // Recovery workers deliberately use runOrchestratorToCompletion for genuinely
  // orphaned `running` runs.
  if (run.status === "running") return run;
  if (run.status !== "waiting") return run;

  if (r.store.claimOrchestratorRunResume) {
    const claimed = await r.store.claimOrchestratorRunResume(run.id);
    if (!claimed) return r.store.getOrchestratorRun(run.id);
    run = claimed;
  }

  const reconciled = await reconcileInFlightJob(run, r);
  if (reconciled) return reconciled;
  return driveGuarded(run, r);
}

// Finalize an accepted async invocation before permitting a model turn. This is
// used both by normal resume and by recovery of a process that died after
// claiming `waiting -> running`; the action row is the durable source of truth
// for whether a job still owns the run.
async function reconcileInFlightJob(
  run: OrchestratorRun,
  r: Resolved
): Promise<OrchestratorRun | null> {
  // Determine the parking action (latest in-flight action carrying a job id).
  const actions = await r.store.listRunActions(run.id);
  const parkingAction = [...actions]
    .reverse()
    .find((action) => action.status === "running" && action.jobIds.length > 0);
  const parkingJobId = parkingAction?.jobIds.at(-1);

  if (parkingAction && parkingJobId) {
    const job = await r.jobs.getJob(parkingJobId, run.projectId);
    if (!job) {
      logger.warn("orchestrator_job.reconcile_missing", {
        workspaceId: r.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        jobId: parkingJobId,
        actionId: parkingAction.id,
      });
      return park(run, r); // unknown job — leave parked for the sweeper
    }
    logger.info("orchestrator_job.reconciled", {
      workspaceId: r.workspaceId,
      projectId: run.projectId,
      runId: run.id,
      jobId: parkingJobId,
      actionId: parkingAction.id,
      jobStatus: job.status,
    });
    if (job.status === "failed" || job.status === "canceled") {
      const jobMessage =
        redactMessage(job.error?.message || `parking job ${parkingJobId} ended ${job.status}`);
      const error =
        isToolName(parkingAction.tool) &&
        (job.error?.code === "object_not_found" ||
          job.error?.code === "asset_not_ready" ||
          job.error?.code === "storage_error" ||
          job.error?.code === "database_error")
          ? classifyToolFailure(
              new ApiError(job.error.code, jobMessage, { jobId: parkingJobId }),
              {
                toolName: parkingAction.tool,
                input: parkingAction.params,
              }
            )
          : {
              kind: "provider_failed" as const,
              message: jobMessage,
              recoverable: false,
              details: job.error?.code
                ? { code: job.error.code, jobId: parkingJobId }
                : { jobId: parkingJobId },
            };
      let priorMatchingFailures = 0;
      for (let index = actions.length - 1; index >= 0; index -= 1) {
        const action = actions[index];
        if (action.id === parkingAction.id || action.tool !== parkingAction.tool) continue;
        if (action.status === "failed" && action.error?.kind === error.kind) {
          priorMatchingFailures += 1;
          continue;
        }
        break;
      }
      const asyncFailureCount = priorMatchingFailures + 1;
      const retryLimitReached =
        error.recoverable &&
        asyncFailureCount >= MAX_RECOVERABLE_ASYNC_FAILURES_PER_TOOL;
      const reconciledError = retryLimitReached
        ? {
            ...error,
            recoverable: false,
            suggestedNextTools: undefined,
            details: {
              ...(error.details ?? {}),
              asyncFailureCount,
              asyncFailureLimit: MAX_RECOVERABLE_ASYNC_FAILURES_PER_TOOL,
            },
          }
        : error;
      await r.store.markInvocation(parkingAction.id, {
        status: "failed",
        error: { ...reconciledError },
      });
      return reconciledError.recoverable
        ? null
        : finish(run, "failed", r, { ...reconciledError });
    }
    if (job.status !== "succeeded") return park(run, r); // still running — stay parked
    // Job done → finalize the parking action with the assets it produced.
    await r.store.markInvocation(parkingAction.id, {
      status: "applied",
      outputAssetIds: jobAssetIds(job.result),
    });
    const gates = await r.store.listRunGates(run.id);
    const gate = gates.find((g) => g.stage === parkingAction.tool);
    if (gate?.status === "pending" || gate?.status === "rejected") {
      await r.store.markGateReached(run.id, parkingAction.tool);
      return park(run, r);
    }
    const stopped = await finishIfAfterGateReached(run, parkingAction.tool, r);
    if (stopped) return stopped;
  }

  const delegationParked = await reconcileDelegation(run, actions, r);
  if (delegationParked) return delegationParked;
  return null;
}

const TERMINAL_DOMAIN_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
  "superseded",
]);

// A running delegate_* action means the run parked in the domain wait. The
// child's report finalization transaction marks the delegation action applied
// (with the report outputs) BEFORE waking this run's dispatch, so:
//   - child still active            -> stay parked in the domain wait;
//   - child terminal without report -> fail the invocation recoverably so the
//     model can re-delegate (canceled/superseded children never apply it);
//   - child missing (crash between the invocation write and the dispatch
//     transaction) -> fail the invocation recoverably; the retried delegation
//     replays idempotently through the same service.
async function reconcileDelegation(
  run: OrchestratorRun,
  actions: RunActionSummary[],
  r: Resolved
): Promise<OrchestratorRun | null> {
  const delegation = [...actions]
    .reverse()
    .find((action) => action.status === "running" && isDispatchToolName(action.tool));
  if (!delegation) return null;

  if (!r.store.findDelegatedChildRun && !r.store.findDelegatedChildRuns) {
    return park(run, r, "domain");
  }
  const children = r.store.findDelegatedChildRuns
    ? await r.store.findDelegatedChildRuns(delegation.id)
    : await r.store.findDelegatedChildRun!(delegation.id).then((child) => child ? [child] : []);
  if (children.length === 0) {
    await r.store.markInvocation(delegation.id, {
      status: "failed",
      error: {
        kind: "provider_failed",
        message: "Delegated assignment was never dispatched; re-delegate to retry.",
        recoverable: true,
      },
    });
    return null;
  }
  if (children.some((child) => !TERMINAL_DOMAIN_RUN_STATUSES.has(child.status))) {
    logger.info("orchestrator.delegation_waiting", {
      workspaceId: r.workspaceId,
      projectId: run.projectId,
      runId: run.id,
      delegationActionId: delegation.id,
      children,
    });
    return park(run, r, "domain");
  }
  await r.store.markInvocation(delegation.id, {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: `Delegated run(s) ended without completing the durable join.`,
      recoverable: true,
      details: { children },
    },
  });
  return null;
}

// Project a persisted action into the compact result the model sees each turn.
// Successful actions report only their produced assets; FAILED actions also carry
// the tool wrapper's recovery guidance (why it failed, which requirements are
// unmet, and which tool to call next). Without this the model sees only
// "<tool>: failed" with no explanation and tends to blindly retry the same tool
// — the loop that otherwise burns the whole turn budget on a rejected or
// precondition-unmet stage until the run times out.
const ERROR_GUIDANCE_FIELDS = [
  "kind",
  "message",
  "recoverable",
  "unmetRequirements",
  "suggestedNextTools",
  "domainReport",
] as const;

export function toPriorResult(action: RunActionSummary): Record<string, unknown> {
  const base: Record<string, unknown> = {
    tool: action.tool,
    status: action.status,
    outputAssetIds: action.outputAssetIds,
  };
  if (action.tool === "board_feedback") {
    base.request = action.params;
  }
  if (
    action.tool === "fit_audio_to_picture" &&
    action.status === "applied" &&
    action.params.result !== undefined
  ) {
    base.result = action.params.result;
  }
  if (action.status === "failed" && action.error) {
    const guidance: Record<string, unknown> = {};
    for (const field of ERROR_GUIDANCE_FIELDS) {
      if (action.error[field] !== undefined) guidance[field] = action.error[field];
    }
    base.error = guidance;
  }
  return base;
}

function toDomainPriorResult(
  action: RunActionSummary,
  definition: AgentDefinition,
  projectId: string
): Record<string, unknown> {
  const base = toPriorResult(action);
  if (!definition.task || action.status !== "failed" || !action.error) return base;
  if (action.error.kind !== "precondition_unmet") return base;
  const recovery = projectDomainRecovery({
    ownerRole: definition.role,
    projectId,
    trustedTargets: definition.task.targets,
    error: action.error,
  });
  base.error = {
    kind: "precondition_unmet",
    message: "A trusted task prerequisite was not met.",
    recoverable: true,
    unmetRequirements: recovery.unmetRequirements,
    suggestedNextTools: recovery.suggestedNextTools,
  };
  return base;
}

async function finalizeDomainReport(
  run: OrchestratorRun,
  report: import("@popcorn/shared/domain-agent-contract").DomainReportV1,
  r: Resolved
): Promise<OrchestratorRun> {
  await r.finalizeDomainTurn({
    projectId: run.projectId,
    runId: run.id,
    report,
    expectedClaimGeneration: r.sessionClaimGeneration,
  });
  return r.store.getOrchestratorRun(run.id);
}

class DomainFailureTerminalizationError extends Error {
  constructor(cause: unknown) {
    super("Could not claim-fence the domain run failure terminalization.", { cause });
  }
}

async function terminalizeDomainFailure(
  run: OrchestratorRun,
  r: Resolved,
  error: Record<string, unknown>
): Promise<OrchestratorRun> {
  if (r.sessionClaimGeneration === undefined) return r.store.getOrchestratorRun(run.id);
  try {
    await r.failDomainRunTurn({
      projectId: run.projectId,
      runId: run.id,
      error,
      expectedClaimGeneration: r.sessionClaimGeneration,
    });
    return r.store.getOrchestratorRun(run.id);
  } catch (err) {
    if (isStaleDomainTurnError(err)) return r.store.getOrchestratorRun(run.id);
    throw new DomainFailureTerminalizationError(err);
  }
}

function invocationOutputAssetIds(result: ToolCallResult): string[] {
  if (result.status === "succeeded") return result.resourceIds;
  if (result.status === "waiting_for_approval") return result.previewArtifactIds;
  return [];
}

export function selectDomainBlockedCandidate(
  recovery: DomainRecoveryProjection
): DomainRecoveryProjection["blockedCandidates"][number] | undefined {
  return recovery.blockedCandidates[0];
}

// Async tool jobs report their produced assets as { assetIds: string[] }.
function jobAssetIds(result: unknown): string[] {
  if (result && typeof result === "object" && "assetIds" in result) {
    const ids = (result as { assetIds?: unknown }).assetIds;
    if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === "string");
  }
  return [];
}

type Resolved = ReturnType<typeof resolved>;

function isDomainRun(run: OrchestratorRun): boolean {
  return run.agentRole === "visuals" || run.agentRole === "audio";
}

function domainRoleEnabled(
  run: OrchestratorRun,
  enabledRoles: readonly AgentDomain[]
): boolean {
  return run.agentRole === "visuals" || run.agentRole === "audio"
    ? enabledRoles.includes(run.agentRole)
    : true;
}

function runMetadata(run: OrchestratorRun, r: Resolved): Record<string, unknown> | undefined {
  const metadata = {
    ...(uploadedFootageMetadataFromSummary(run.inputSummary) ?? {}),
    ...(r.metadata ?? {}),
  };
  return Object.keys(metadata).length ? metadata : undefined;
}

// Drive the loop, but guarantee a terminal run: any uncaught error (a model/store
// failure that driveLoop doesn't already convert into a failed result) marks the
// run 'failed' with the error before rethrowing, so it is never left 'running'.
async function driveGuarded(run: OrchestratorRun, r: Resolved): Promise<OrchestratorRun> {
  // Bind the run to its workspace owner so generation tools resolve that user's
  // bring-your-own provider keys (the run executes detached from any request).
  // The lookup is injectable (resolved() defaults it) so fake-store runners stay
  // DB-free.
  const ownerUserId = await r.resolveOwnerUserId(r.workspaceId);
  return withProviderKeyUser(ownerUserId, () => driveGuardedInner(run, r));
}

async function driveGuardedInner(
  run: OrchestratorRun,
  r: Resolved
): Promise<OrchestratorRun> {
  try {
    return await driveLoop(run, r);
  } catch (err) {
    if (err instanceof DomainFailureTerminalizationError) throw err;
    const error = {
      kind: "provider_failed",
      message: err instanceof Error ? err.message : String(err),
      recoverable: false,
    };
    if (isDomainRun(run)) return terminalizeDomainFailure(run, r, error);
    try {
      await finish(run, "failed", r, error);
    } catch {
      // best-effort; surface the original error regardless.
    }
    throw err;
  }
}

async function driveLoop(run: OrchestratorRun, r: Resolved): Promise<OrchestratorRun> {
  for (let turn = 0; turn < r.maxTurns; turn += 1) {
    run = await r.store.getOrchestratorRun(run.id);
    if (run.status !== "running") return run;
    if (isDomainRun(run) && ((r.enabledDomainRoles.length > 0 && !domainRoleEnabled(run, r.enabledDomainRoles)) || !r.domainRuntimeEnabled || r.sessionClaimGeneration === undefined)) {
      return run;
    }

    const definition = await r.resolveAgentDefinition({
      run,
      workspaceId: r.workspaceId,
      // The hierarchy owns an exact root surface. A caller-supplied flat test
      // registry must not accidentally reintroduce leaf tools when the flag is on.
      rootRegistry: r.creativeDirectorHierarchyEnabled ? undefined : r.registry,
      enabledDomainRoles: r.enabledDomainRoles,
      creativeDirectorHierarchyEnabled: r.creativeDirectorHierarchyEnabled,
    });

    if (run.budgetUsd != null && run.spentUsd >= run.budgetUsd) {
      return finish(run, "failed", r, {
        kind: "budget_exceeded",
        message: `spent ${run.spentUsd} >= budget ${run.budgetUsd}`,
      });
    }

    const [prior, gates] = await Promise.all([
      r.store.listRunActions(run.id),
      r.store.listRunGates(run.id),
    ]);
    const priorResults = prior.map((action) =>
      definition.task ? toDomainPriorResult(action, definition, run.projectId) : toPriorResult(action)
    );
    const turnRegistry = registryForRejectedGate(definition.registry, gates);
    const agentContext = await definition.loadTurnContext();

    let decision;
    try {
      decision = await withTimeout(
        r.model({
          workspaceId: r.workspaceId,
          projectId: run.projectId,
          orchestratorRunId: run.id,
          inputSummary: run.inputSummary,
          priorResults,
          registry: turnRegistry,
          systemPrompt: definition.systemPrompt,
          agentContext,
        }),
        r.modelTurnTimeoutMs,
        `orchestrator model turn exceeded ${r.modelTurnTimeoutMs}ms`
      );
    } catch (err) {
      return finish(run, "failed", r, {
        kind: "timeout",
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      });
    }

    if (decision.type === "done") {
      if (definition.task) {
        let report: import("@popcorn/shared/domain-agent-contract").DomainReportV1;
        try {
          report = await buildDomainReportFromCompletion({
            runId: run.id,
            projectId: run.projectId,
            task: definition.task,
            summary: decision.summary,
            actions: prior,
          });
        } catch (err) {
          return terminalizeDomainFailure(run, r, {
            kind: "invalid_input",
            message: err instanceof Error ? err.message : "Invalid domain completion.",
            recoverable: false,
          });
        }
        try {
          return await finalizeDomainReport(run, report, r);
        } catch (err) {
          if (isStaleDomainTurnError(err)) return r.store.getOrchestratorRun(run.id);
          return terminalizeDomainFailure(run, r, {
            kind: "provider_failed",
            message: err instanceof Error ? err.message : "Domain report finalization failed.",
            recoverable: false,
          });
        }
      }
      logger.info("orchestrator.done", {
        workspaceId: r.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        turn,
        model: decision.model,
      });
      return finish(run, "succeeded", r);
    }

    run = await r.store.getOrchestratorRun(run.id);
    if (run.status !== "running") return run;
    logger.info("orchestrator.tool_decision", {
      workspaceId: r.workspaceId,
      projectId: run.projectId,
      runId: run.id,
      turn,
      tool: decision.toolName,
      model: decision.model,
    });
    // Gate handling. Pending/reached gates pause before executing. Approved gates
    // fall through. Rejected gates also fall through once: that is the
    // "regenerate this stage" path, and after the tool succeeds the gate is
    // marked reached again for another review stop.
    const latestGates = await r.store.listRunGates(run.id);
    const gate = latestGates.find(
      (g) => g.stage === decision.toolName && !g.stage.startsWith(AFTER_GATE_PREFIX)
    );
    const regeneratingRejectedGate = gate?.status === "rejected";
    if (gate && gate.status !== "approved") {
      if (gate.status === "pending") {
        await r.store.markGateReached(run.id, decision.toolName);
      }
      if (!regeneratingRejectedGate) {
        logger.info("orchestrator.parked_before_gate", {
          workspaceId: r.workspaceId,
          projectId: run.projectId,
          runId: run.id,
          turn,
          tool: decision.toolName,
          gateId: gate.id,
          gateStatus: gate.status,
        });
        return park(run, r);
      }
    }

    // Parse and authorize once against a fresh trusted scope before persisting
    // any invocation. The same canonical input then drives estimate + execute.
    const actionId = randomUUID();
    let domainScope: DomainTargetScope | undefined;
    let domainSnapshot: ProjectGraphSnapshot | undefined;
    if (definition.task) {
      try {
        const prepared = await r.prepareDomainScope({
          workspaceId: r.workspaceId,
          projectId: run.projectId,
          task: definition.task,
        });
        domainScope = prepared.scope;
        domainSnapshot = prepared.snapshot;
      } catch (err) {
        return finish(run, "failed", r, {
          kind: "invalid_input",
          message: err instanceof Error ? err.message : String(err),
          recoverable: false,
        });
      }
    }
    const toolContext = createToolExecutionContext({
      workspaceId: r.workspaceId,
      projectId: run.projectId,
      orchestratorRunId: run.id,
      toolCallId: actionId,
      actionId,
      actorId: r.actorId ?? "orchestrator",
      agentId: r.agentId ?? "orchestrator",
      messageId: r.messageId,
      requestId: r.requestId,
      sessionClaimGeneration: r.sessionClaimGeneration,
      ...(definition.task ? { domainTask: definition.task } : {}),
      ...(domainScope ? { domainScope } : {}),
      ...(domainSnapshot ? { domainSnapshot } : {}),
      metadata: runMetadata(run, r),
    });
    let preparedInput: unknown;
    try {
      preparedInput = await prepareRegisteredTool({
        registry: turnRegistry,
        toolName: decision.toolName,
        input: decision.input,
        context: toolContext,
      });
    } catch (err) {
      return finish(run, "failed", r, {
        kind: "invalid_input",
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      });
    }
    await r.store.recordInvocation({
      actionId,
      projectId: run.projectId,
      orchestratorRunId: run.id,
      tool: decision.toolName,
      status: "running",
      params: preparedInput as Record<string, unknown>,
      outputAssetIds: [],
      jobIds: [],
    });

    const runUserId = currentRunUserId();
    let billedBeforeUsd = 0;
    try {
      // Credit pre-check: fail fast before spending on a generation a broke user
      // with no BYO keys can't pay for. Only gates BILLABLE tools (estimate > 0) —
      // free planning/critique still runs when out of credits. Users who bring their
      // own keys are never blocked here; any platform spend they incur is still
      // settled by the post-generation debit below. (No run user => not billed.)
      const toolEstimateUsd =
        (await turnRegistry
          .get(decision.toolName)
          ?.estimateCostUsd(preparedInput, toolContext)) ?? 0;
      if (runUserId && toolEstimateUsd > 0) {
        const estimatedCredits = Math.ceil(toolEstimateUsd * CREDIT_MARGIN * CREDITS_PER_USD);
        const balance = await r.getCreditBalance(runUserId);
        if (balance < estimatedCredits && !(await r.userHasAnyProviderKey(runUserId))) {
          const error = {
            kind: "insufficient_credits",
            message:
              "Out of credits. Buy credits or add your own provider API keys to keep generating.",
            recoverable: false,
          };
          await r.store.markInvocation(actionId, {
            status: "failed",
            error,
          });
          return finish(run, "failed", r, error);
        }
      }

      billedBeforeUsd = billableUsdSoFar();
    } catch (err) {
      // Estimation and credit checks can fail before a tool handler runs. Keep
      // the reservation's lifecycle truthful in that case instead of leaving a
      // phantom running action behind.
      const error = {
        kind: "provider_failed",
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      };
      try {
        await r.store.markInvocation(actionId, { status: "failed", error });
      } catch {
        // Preserve the original preflight failure; the durable run guard will
        // still record the terminal run error.
      }
      throw err;
    }

    // A wired tool may THROW (DB/provider exception) instead of returning a
    // ToolCallResult. Catch it so the run reaches a terminal 'failed' state with a
    // persisted error rather than being left stuck 'running'.
    let result: ToolCallResult;
    try {
      result = await executeRegisteredTool({
        registry: turnRegistry,
        toolName: decision.toolName,
        input: preparedInput,
        context: toolContext,
      });
    } catch (err) {
      const error = {
        kind: "provider_failed",
        message: err instanceof Error ? err.message : String(err),
        recoverable: false,
      };
      logger.error("orchestrator.tool_exception", {
        workspaceId: r.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        turn,
        tool: decision.toolName,
        error: { code: error.kind, message: error.message },
      });
      await r.store.markInvocation(actionId, {
        status: "failed",
        error,
      });
      return finish(run, "failed", r, error);
    }

    if (result.status === "failed") {
      const unmet = result.error.unmetRequirements ?? [];
      logger.warn("orchestrator.tool_failed", {
        workspaceId: r.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        turn,
        tool: decision.toolName,
        error: { code: result.error.kind, message: result.error.message },
        recoverable: result.error.recoverable,
        unmetRequirements: unmet.map((miss) => miss.requirement),
        suggestedNextTools: result.error.suggestedNextTools?.map((call) => call.tool) ?? [],
      });
    } else if (result.status === "accepted") {
      logger.info("orchestrator.tool_accepted", {
        workspaceId: r.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        turn,
        tool: decision.toolName,
        jobId: result.jobId,
      });
    }

    await r.store.markInvocation(actionId, {
      status:
        result.status === "succeeded"
          ? "applied"
          : result.status === "failed"
            ? "failed"
            : "running",
      outputAssetIds: invocationOutputAssetIds(result),
      jobIds: result.status === "accepted" ? [result.jobId] : [],
      error: result.status === "failed" ? { ...result.error } : undefined,
    });

    if (
      result.status === "failed" &&
      result.error.kind === "precondition_unmet" &&
      definition.task
    ) {
      const recovery = projectDomainRecovery({
        ownerRole: definition.role,
        projectId: run.projectId,
        trustedTargets: definition.task.targets,
        error: result.error,
      });
      // A cross-domain prerequisite must not disappear merely because the same
      // failure also advertised a local recovery candidate. Root/Audio work
      // cannot be completed by retrying a Visuals primitive.
      const blocked = selectDomainBlockedCandidate(recovery);
      if (blocked) {
        return finalizeDomainReport(
          run,
          {
            schemaVersion: "DomainReport.v1",
            outcome: {
              outcome: "blocked",
              precondition: {
                requirement: "cross_domain_prerequisite",
                because: "The requested work requires a capability outside this domain.",
              },
              requiredDomain: blocked.requiredDomain,
              targets: blocked.targets,
              reason: blocked.reason,
            },
          },
          r
        );
      }
    }

    if (result.status === "succeeded" && result.costUsd) {
      run = await r.store.updateOrchestratorRun(run.id, {
        spentUsd: run.spentUsd + result.costUsd,
      });
    }

    // Debit credits for the cost this tool incurred on PLATFORM keys. BYO-key and
    // local/guest generation leave the run tally empty, so they debit nothing.
    // 1 credit = $0.01, with a margin. The debit is balance-guarded in Postgres.
    if (result.status === "succeeded" && runUserId) {
      const afterUsd = billableUsdSoFar();
      const billableDeltaUsd = afterUsd - billedBeforeUsd;
      if (billableDeltaUsd > 0) {
        const credits = Math.ceil(billableDeltaUsd * CREDIT_MARGIN * CREDITS_PER_USD);
        try {
          await r.applyCreditTransaction({
            userId: runUserId,
            deltaCredits: -credits,
            reason: "generation_debit",
            runId: run.id,
            costUsd: billableDeltaUsd,
            // Cumulative billable USD is monotonic + unique per debit in the run,
            // so a retried debit is idempotent rather than double-charging.
            idempotencyKey: `run:${run.id}:billable_usd:${afterUsd}`,
          });
        } catch (err) {
          // Overdraw past the pre-check (e.g. an expensive tool against a thin
          // balance): stop the run rather than let the balance go negative.
          if (err instanceof ApiError && err.details?.dbCode === PG_INSUFFICIENT_FUNDS) {
            const error = {
              kind: "insufficient_credits",
              message: "Ran out of credits mid-run.",
              recoverable: false,
            };
            return finish(run, "failed", r, error);
          }
          throw err;
        }
      }
    }

    if (regeneratingRejectedGate && result.status === "succeeded") {
      await r.store.markGateReached(run.id, decision.toolName);
      return park(run, r);
    }

    if (result.status === "succeeded") {
      const stopped = await finishIfAfterGateReached(run, decision.toolName, r);
      if (stopped) return stopped;
    }

    if (result.status === "delegated") {
      // The dispatch transaction already durably enqueued the child run; the
      // child's report finalization wakes this run's dispatch. Park in the
      // domain wait (distinct from media-job/approval waits) until then.
      logger.info("orchestrator.parked_on_delegation", {
        workspaceId: r.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        turn,
        tool: decision.toolName,
        childRunId: "childRunId" in result ? result.childRunId : undefined,
        sessionId: "sessionId" in result ? result.sessionId : undefined,
        childRuns: "childRuns" in result ? result.childRuns : undefined,
      });
      return park(run, r, "domain");
    }

    if (result.status === "accepted") {
      logger.info("orchestrator.parked_after_tool", {
        workspaceId: r.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        turn,
        tool: decision.toolName,
        resultStatus: result.status,
      });
      const parked = await park(run, r);

      // A fast inline worker can finish before the accepted invocation has been
      // recorded and the run has reached `waiting`. Reconcile its terminal state
      // after parking so the successful storyboard assets are visible before the
      // next model turn chooses keyframes or clips.
      const job = await r.jobs.getJob(result.jobId, run.projectId);
      if (job?.status === "succeeded" || job?.status === "failed" || job?.status === "canceled") {
        return resumeRun(parked, r);
      }
      return parked;
    }
    if (result.status === "waiting_for_approval") {
      logger.info("orchestrator.parked_after_tool", {
        workspaceId: r.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        turn,
        tool: decision.toolName,
        resultStatus: result.status,
      });
      return park(run, r); // parked on an approval gate
    }
    if (result.status === "failed" && !result.error.recoverable) {
      return finish(run, "failed", r, { ...result.error });
    }
    // succeeded, or a recoverable failure the model can self-heal from → keep going.
    run = await r.store.getOrchestratorRun(run.id);
  }

  return finish(run, "failed", r, {
    kind: "timeout",
    message: `exceeded ${r.maxTurns} turns`,
  });
}

async function finish(
  run: OrchestratorRun,
  status: "succeeded" | "failed",
  r: Resolved,
  error?: Record<string, unknown>
): Promise<OrchestratorRun> {
  if (status === "failed" && isDomainRun(run)) {
    return terminalizeDomainFailure(run, r, error ?? {
      kind: "provider_failed",
      message: "Domain run failed without a structured engine error.",
      recoverable: false,
    });
  }
  return r.store.updateOrchestratorRun(run.id, {
    status,
    completedAt: nowIso(),
    ...(error ? { error } : {}),
  });
}

async function park(
  run: OrchestratorRun,
  r: Resolved,
  waitReason: "domain" | null = null
): Promise<OrchestratorRun> {
  // The domain wait is distinct from media-job and approval waits: a root run
  // parked on a delegated child records it durably so store/projection can
  // distinguish "waiting on a specialist" from "waiting on a provider job".
  return r.store.updateOrchestratorRun(run.id, { status: "waiting", waitReason });
}
