import {
  claimOrchestratorDispatches,
  enqueueOrchestratorDispatch,
  getOrchestratorRun,
  listRunGates,
  recoverOrchestratorRuntimeControls,
  releaseOrchestratorDispatch,
  type ClaimedOrchestratorDispatch,
} from "@/lib/api/v1/orchestrator-store";
import { createLogger, type Logger } from "@/lib/v1/logger";
import { resumeOrchestratorRun, runOrchestratorToCompletion } from "./engine";

const DEFAULT_INTERVAL_MS = 1_000;
const ASYNC_RETRY_SECONDS = 10;
const MAX_TICK_BACKOFF_MS = 30_000;

/**
 * Delay before the next claim attempt after `consecutiveFailures` failed ticks.
 * A failed tick means the claim/release DB call itself errored (e.g. statement
 * timeout while a migration holds a table lock), so retrying every interval
 * only hammers the database; back off exponentially instead, capped so the
 * worker recovers within seconds of the database becoming healthy.
 */
export function orchestratorTickBackoffMs(
  consecutiveFailures: number,
  baseIntervalMs: number = DEFAULT_INTERVAL_MS
): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(baseIntervalMs * 2 ** consecutiveFailures, MAX_TICK_BACKOFF_MS);
}

export function isOrchestratorRecoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ORCHESTRATOR_RECOVERY_ENABLED ?? "true").toLowerCase() !== "false";
}

export function orchestratorRecoveryIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.ORCHESTRATOR_RECOVERY_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 250 ? configured : DEFAULT_INTERVAL_MS;
}

export interface RecoveryWorkerDeps {
  claim: typeof claimOrchestratorDispatches;
  release: typeof releaseOrchestratorDispatch;
  getRun: typeof getOrchestratorRun;
  listGates: typeof listRunGates;
  run: typeof runOrchestratorToCompletion;
  resume: typeof resumeOrchestratorRun;
  repair: typeof recoverOrchestratorRuntimeControls;
  logger: Logger;
}

const defaults: RecoveryWorkerDeps = {
  claim: claimOrchestratorDispatches,
  release: releaseOrchestratorDispatch,
  getRun: getOrchestratorRun,
  listGates: listRunGates,
  run: runOrchestratorToCompletion,
  resume: resumeOrchestratorRun,
  repair: recoverOrchestratorRuntimeControls,
  logger: createLogger(),
};

function terminal(status: string): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "canceled" ||
    status === "timed_out" ||
    status === "superseded"
  );
}

async function processDispatch(dispatch: ClaimedOrchestratorDispatch, deps: RecoveryWorkerDeps) {
  const run = await deps.getRun(dispatch.runId);
  // A lease recovered after terminalization is cleanup, not another model turn.
  // Include timed_out/superseded so a stale dispatch cannot loop forever.
  if (terminal(run.status)) {
    await deps.release({ ...dispatch, delaySeconds: 0, completed: true });
    return;
  }
  const gates = await deps.listGates(dispatch.runId);
  // A reached gate belongs to a human. It is deliberately removed from the
  // worker queue and is re-enqueued by the approve/reject route.
  if (gates.some((gate) => gate.status === "reached")) {
    await deps.release({ ...dispatch, delaySeconds: 0, completed: true });
    return;
  }
  const result = run.status === "waiting"
      ? await deps.resume(run.id, {
        workspaceId: dispatch.workspaceId,
        agentId: "orchestrator-worker",
        sessionClaimGeneration: dispatch.sessionClaimGeneration,
        domainRuntimeEnabled: true,
        enabledDomainRoles: ["visuals", "audio"],
      })
    : await deps.run(run.id, {
        workspaceId: dispatch.workspaceId,
        agentId: "orchestrator-worker",
        sessionClaimGeneration: dispatch.sessionClaimGeneration,
        domainRuntimeEnabled: true,
        enabledDomainRoles: ["visuals", "audio"],
      });
  const resultGates = await deps.listGates(dispatch.runId);
  const completed = terminal(result.status) || resultGates.some((gate) => gate.status === "reached");
  await deps.release({
    ...dispatch,
    delaySeconds: completed ? 0 : ASYNC_RETRY_SECONDS,
    completed,
  });
}

export async function recoverOrchestratorRuns(deps: Partial<RecoveryWorkerDeps> = {}): Promise<number> {
  const resolved = { ...defaults, ...deps };
  // The public helper stays lightweight for unit callers; the long-running
  // worker below always injects the durable repair sweep before its lease pass.
  if (deps.repair) await resolved.repair();
  const dispatches = await resolved.claim();
  for (const dispatch of dispatches) {
    try {
      await processDispatch(dispatch, resolved);
    } catch (error) {
      resolved.logger.error("orchestrator_worker.dispatch_failed", {
        runId: dispatch.runId,
        workspaceId: dispatch.workspaceId,
        error: { message: error instanceof Error ? error.message : "Worker failed." },
      });
      await resolved.release({ ...dispatch, delaySeconds: ASYNC_RETRY_SECONDS, completed: false });
    }
  }
  return dispatches.length;
}

/** Starts by draining the durable queue; later ticks only claim queued/expired leases. */
export function startOrchestratorRecoveryWorker(options: { env?: NodeJS.ProcessEnv; logger?: Logger } = {}) {
  const env = options.env ?? process.env;
  if (!isOrchestratorRecoveryEnabled(env)) return null;
  const logger = options.logger ?? defaults.logger;
  let active = false;
  let consecutiveFailures = 0;
  let nextAttemptAt = 0;
  const tick = () => {
    if (active || Date.now() < nextAttemptAt) return;
    active = true;
    recoverOrchestratorRuns({ logger, repair: defaults.repair })
      .then(() => {
        consecutiveFailures = 0;
        nextAttemptAt = 0;
      })
      .catch((error) => {
        consecutiveFailures += 1;
        const backoffMs = orchestratorTickBackoffMs(consecutiveFailures, orchestratorRecoveryIntervalMs(env));
        nextAttemptAt = Date.now() + backoffMs;
        logger.error("orchestrator_worker.tick_failed", {
          consecutiveFailures,
          backoffMs,
          error: { message: error instanceof Error ? error.message : "Worker failed." },
        });
      })
      .finally(() => { active = false; });
  };
  tick();
  const timer = setInterval(tick, orchestratorRecoveryIntervalMs(env));
  timer.unref();
  logger.info("orchestrator_worker.started", { intervalMs: orchestratorRecoveryIntervalMs(env) });
  return timer;
}

export { enqueueOrchestratorDispatch };
