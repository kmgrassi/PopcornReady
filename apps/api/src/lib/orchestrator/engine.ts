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
import {
  getOrchestratorRun,
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
import { agentApiStore } from "@/lib/agent-api/jobs";
import { orchestratorModel, type OrchestratorModel } from "./model";
import { executeRegisteredTool, type ToolRegistry } from "./registry";
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
import { createLogger } from "@/lib/v1/logger";
import { uploadedFootageMetadataFromSummary } from "./uploaded-footage-selection";

// Credits charged per generation = providerCostUsd * MARGIN, at 1 credit = $0.01.
const CREDIT_MARGIN = 2;
const CREDITS_PER_USD = 100;
const PG_INSUFFICIENT_FUNDS = "23514"; // apply_credit_transaction overdraw guard

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MODEL_TURN_TIMEOUT_MS = 60_000;
const AFTER_GATE_PREFIX = "after:";
const logger = createLogger();

export interface InvocationRecord {
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
  listRunGates(runId: string): Promise<OrchestratorRunGate[]>;
  markGateReached(runId: string, stage: string): Promise<OrchestratorRunGate | null>;
  listRunActions(runId: string): Promise<RunActionSummary[]>;
  recordInvocation(input: InvocationRecord): Promise<void>;
  // Finalize a previously-recorded (running) invocation once its job is terminal.
  markInvocation(
    actionId: string,
    patch: {
      status: "applied" | "failed";
      outputAssetIds?: string[];
      error?: Record<string, unknown>;
    }
  ): Promise<void>;
}

export interface JobStatusReader {
  getJob(
    jobId: string
  ): Promise<{ status: string; result?: unknown } | null | undefined>;
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
}

export function defaultEngineStore(): OrchestratorEngineStore {
  return {
    getOrchestratorRun,
    updateOrchestratorRun,
    listRunGates,
    markGateReached,
    listRunActions,
    async recordInvocation(input) {
      await createAction({
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
        ...(patch.outputAssetIds !== undefined
          ? { outputAssetIds: patch.outputAssetIds }
          : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      });
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
  const rejectedGate = gates.find(
    (gate) => gate.status === "rejected" && !gate.stage.startsWith(AFTER_GATE_PREFIX)
  );
  if (!rejectedGate) return registry;
  const tool = registry.get(rejectedGate.stage as ToolName);
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
    jobs: deps.jobs ?? { getJob: (id: string) => agentApiStore.getJob(id) },
    maxTurns: deps.maxTurns ?? DEFAULT_MAX_TURNS,
    modelTurnTimeoutMs: deps.modelTurnTimeoutMs ?? DEFAULT_MODEL_TURN_TIMEOUT_MS,
    resolveOwnerUserId: deps.resolveOwnerUserId ?? getWorkspaceOwnerUserId,
    getCreditBalance: deps.getCreditBalance ?? getCreditBalance,
    userHasAnyProviderKey: deps.userHasAnyProviderKey ?? userHasAnyProviderKey,
    applyCreditTransaction: deps.applyCreditTransaction ?? applyCreditTransaction,
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
  if (run.status === "queued") {
    run = await r.store.updateOrchestratorRun(runId, {
      status: "running",
      startedAt: nowIso(),
    });
  }
  if (run.status !== "running") return run;
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
  let run = await r.store.getOrchestratorRun(runId);
  if (run.status === "running") return driveGuarded(run, r);
  if (run.status !== "waiting") return run;

  // Determine the parking action (latest in-flight action carrying a job id).
  const actions = await r.store.listRunActions(runId);
  const parkingAction = [...actions]
    .reverse()
    .find((action) => action.status === "running" && action.jobIds.length > 0);
  const parkingJobId = parkingAction?.jobIds.at(-1);

  if (parkingAction && parkingJobId) {
    const job = await r.jobs.getJob(parkingJobId);
    if (!job) return run; // unknown job — leave parked for the sweeper
    if (job.status === "failed" || job.status === "canceled") {
      await r.store.markInvocation(parkingAction.id, {
        status: "failed",
        error: { kind: "provider_failed", message: `job ${parkingJobId} ended ${job.status}` },
      });
      return finish(run, "failed", r, {
        kind: "provider_failed",
        message: `parking job ${parkingJobId} ended ${job.status}`,
      });
    }
    if (job.status !== "succeeded") return run; // still running — stay parked
    // Job done → finalize the parking action with the assets it produced.
    await r.store.markInvocation(parkingAction.id, {
      status: "applied",
      outputAssetIds: jobAssetIds(job.result),
    });
    const gates = await r.store.listRunGates(runId);
    const gate = gates.find((g) => g.stage === parkingAction.tool);
    if (gate?.status === "pending" || gate?.status === "rejected") {
      await r.store.markGateReached(runId, parkingAction.tool);
      return park(run, r);
    }
    const stopped = await finishIfAfterGateReached(run, parkingAction.tool, r);
    if (stopped) return stopped;
  }
  // Job done (or gate the caller resolved) → continue the loop.
  run = await r.store.updateOrchestratorRun(runId, { status: "running" });
  return driveGuarded(run, r);
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
] as const;

function toPriorResult(action: RunActionSummary): Record<string, unknown> {
  const base: Record<string, unknown> = {
    tool: action.tool,
    status: action.status,
    outputAssetIds: action.outputAssetIds,
  };
  if (action.tool === "board_feedback") {
    base.request = action.params;
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

function hasUnfulfilledTargetedRevision(actions: RunActionSummary[]): boolean {
  const latestFeedbackIndex = actions
    .map((action) => action.tool)
    .lastIndexOf("board_feedback");
  if (latestFeedbackIndex < 0) return false;
  const feedback = actions[latestFeedbackIndex];
  const target = feedback?.params.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) return false;
  const scope = (target as { scope?: unknown }).scope;
  if (scope !== "tile" && scope !== "asset") return false;
  const revisionOutputTools = new Set([
    "regenerate_asset",
    "generate_anchor",
    "generate_keyframe",
    "generate_clip",
    "edit_video_asset",
  ]);
  return !actions
    .slice(latestFeedbackIndex + 1)
    .some(
      (action) =>
        revisionOutputTools.has(action.tool) &&
        action.status === "applied" &&
        action.outputAssetIds.length > 0
    );
}

function invocationOutputAssetIds(result: ToolCallResult): string[] {
  if (result.status === "succeeded") return result.resourceIds;
  if (result.status === "waiting_for_approval") return result.previewArtifactIds;
  return [];
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
    const error = {
      kind: "provider_failed",
      message: err instanceof Error ? err.message : String(err),
      recoverable: false,
    };
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
    const priorResults = prior.map(toPriorResult);
    const turnRegistry = registryForRejectedGate(r.registry, gates);

    let decision;
    try {
      decision = await withTimeout(
        r.model({
          workspaceId: r.workspaceId,
          projectId: run.projectId,
          inputSummary: run.inputSummary,
          priorResults,
          registry: turnRegistry,
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
      if (hasUnfulfilledTargetedRevision(prior)) {
        const error = {
          kind: "revision_not_applied",
          message:
            "The requested asset revision completed without producing a downstream action.",
          recoverable: false,
        };
        logger.error("orchestrator.revision_not_applied", {
          workspaceId: r.workspaceId,
          projectId: run.projectId,
          runId: run.id,
          turn,
          model: decision.model,
        });
        return finish(run, "failed", r, error);
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
    const toolContext = createToolExecutionContext({
      workspaceId: r.workspaceId,
      projectId: run.projectId,
      orchestratorRunId: run.id,
      actorId: r.actorId ?? "orchestrator",
      agentId: r.agentId ?? "orchestrator",
      messageId: r.messageId,
      requestId: r.requestId,
      metadata: runMetadata(run, r),
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

    // Credit pre-check: fail fast before spending on a generation a broke user
    // with no BYO keys can't pay for. Only gates BILLABLE tools (estimate > 0) —
    // free planning/critique still runs when out of credits. Users who bring their
    // own keys are never blocked here; any platform spend they incur is still
    // settled by the post-generation debit below. (No run user => not billed.)
    const runUserId = currentRunUserId();
    const toolEstimateUsd =
      (await turnRegistry
        .get(decision.toolName)
        ?.estimateCostUsd(decision.input, toolContext)) ?? 0;
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
        await r.store.recordInvocation({
          projectId: run.projectId,
          orchestratorRunId: run.id,
          tool: decision.toolName,
          status: "failed",
          params: decision.input,
          outputAssetIds: [],
          jobIds: [],
          error,
        });
        return finish(run, "failed", r, error);
      }
    }
    const billedBeforeUsd = billableUsdSoFar();

    // A wired tool may THROW (DB/provider exception) instead of returning a
    // ToolCallResult. Catch it so the run reaches a terminal 'failed' state with a
    // persisted error rather than being left stuck 'running'.
    let result: ToolCallResult;
    try {
      result = await executeRegisteredTool({
        registry: turnRegistry,
        toolName: decision.toolName,
        input: decision.input,
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
      await r.store.recordInvocation({
        projectId: run.projectId,
        orchestratorRunId: run.id,
        tool: decision.toolName,
        status: "failed",
        params: decision.input,
        outputAssetIds: [],
        jobIds: [],
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

    await r.store.recordInvocation({
      projectId: run.projectId,
      orchestratorRunId: run.id,
      tool: decision.toolName,
      status:
        result.status === "succeeded"
          ? "applied"
          : result.status === "failed"
            ? "failed"
            : "running",
      params: decision.input,
      outputAssetIds: invocationOutputAssetIds(result),
      jobIds: result.status === "accepted" ? [result.jobId] : [],
      costUsd: result.status === "succeeded" ? result.costUsd : undefined,
      error: result.status === "failed" ? { ...result.error } : undefined,
    });

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

    if (result.status === "accepted" || result.status === "waiting_for_approval") {
      logger.info("orchestrator.parked_after_tool", {
        workspaceId: r.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        turn,
        tool: decision.toolName,
        resultStatus: result.status,
      });
      return park(run, r); // parked on a job / approval gate
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
  return r.store.updateOrchestratorRun(run.id, {
    status,
    completedAt: nowIso(),
    ...(error ? { error } : {}),
  });
}

async function park(run: OrchestratorRun, r: Resolved): Promise<OrchestratorRun> {
  return r.store.updateOrchestratorRun(run.id, { status: "waiting" });
}
