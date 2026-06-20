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
import { createToolExecutionContext } from "./tool-context";
import type { ToolCallResult, ToolName } from "./types";

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MODEL_TURN_TIMEOUT_MS = 60_000;

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
        estimatedCostUsd: input.costUsd,
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
  const rejectedGate = gates.find((gate) => gate.status === "rejected");
  if (!rejectedGate) return registry;
  const tool = registry.get(rejectedGate.stage as ToolName);
  if (!tool) return registry;
  return new Map([[tool.name, tool]]);
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

// Drive the loop, but guarantee a terminal run: any uncaught error (a model/store
// failure that driveLoop doesn't already convert into a failed result) marks the
// run 'failed' with the error before rethrowing, so it is never left 'running'.
async function driveGuarded(run: OrchestratorRun, r: Resolved): Promise<OrchestratorRun> {
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
      return finish(run, "succeeded", r);
    }

    run = await r.store.getOrchestratorRun(run.id);
    if (run.status !== "running") return run;

    // Gate handling. Pending/reached gates pause before executing. Approved gates
    // fall through. Rejected gates also fall through once: that is the
    // "regenerate this stage" path, and after the tool succeeds the gate is
    // marked reached again for another review stop.
    const gate = gates.find((g) => g.stage === decision.toolName);
    const regeneratingRejectedGate = gate?.status === "rejected";
    if (gate && gate.status !== "approved") {
      if (gate.status === "pending") {
        await r.store.markGateReached(run.id, decision.toolName);
      }
      if (!regeneratingRejectedGate) return park(run, r);
    }

    // A wired tool may THROW (DB/provider exception) instead of returning a
    // ToolCallResult. Catch it so the run reaches a terminal 'failed' state with a
    // persisted error rather than being left stuck 'running'.
    let result: ToolCallResult;
    try {
      result = await executeRegisteredTool({
        registry: turnRegistry,
        toolName: decision.toolName,
        input: decision.input,
        context: createToolExecutionContext({
          workspaceId: r.workspaceId,
          projectId: run.projectId,
          orchestratorRunId: run.id,
          actorId: r.actorId ?? "orchestrator",
          agentId: r.agentId ?? "orchestrator",
          messageId: r.messageId,
          requestId: r.requestId,
          metadata: r.metadata,
        }),
      });
    } catch (err) {
      const error = {
        kind: "provider_failed",
        message: err instanceof Error ? err.message : String(err),
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

    if (regeneratingRejectedGate && result.status === "succeeded") {
      await r.store.markGateReached(run.id, decision.toolName);
      return park(run, r);
    }

    if (result.status === "accepted" || result.status === "waiting_for_approval") {
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
