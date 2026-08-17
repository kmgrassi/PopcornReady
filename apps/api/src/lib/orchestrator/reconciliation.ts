import { ApiError } from "@/core/errors";
import { isDispatchToolName, isToolName } from "@/lib/orchestrator-tools/capability-catalog";
import { createLogger } from "@/lib/v1/logger";
import { redactMessage } from "@/lib/v1/redact";
import { classifyToolFailure } from "./tool-errors";
import type {
  JobStatusReader,
  OrchestratorEngineStore,
} from "./engine";
import type {
  DomainRunWaitReason,
} from "@popcorn/shared/domain-agent-contract";
import type {
  OrchestratorRun,
  OrchestratorRunGate,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";

const MAX_RECOVERABLE_ASYNC_FAILURES_PER_TOOL = 3;
const TERMINAL_DOMAIN_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
  "superseded",
]);
const logger = createLogger();

export interface ReconciliationContext {
  workspaceId: string;
  store: OrchestratorEngineStore;
  jobs: JobStatusReader;
  finish: (
    run: OrchestratorRun,
    status: "succeeded" | "failed",
    error?: Record<string, unknown>
  ) => Promise<OrchestratorRun>;
  park: (
    run: OrchestratorRun,
    waitReason: DomainRunWaitReason
  ) => Promise<OrchestratorRun>;
  finishIfAfterGateReached: (
    run: OrchestratorRun,
    toolName: string
  ) => Promise<OrchestratorRun | null>;
}

/**
 * Reconciles durable async work before the model gets another turn.
 *
 * This boundary owns the two ways an engine run can be waiting on work outside
 * the process: a media job or a delegated domain child run. Keeping those
 * transitions together makes recovery behavior easy to audit without pulling
 * the model/tool turn loop into this module.
 */
export async function reconcileInFlightWork(
  run: OrchestratorRun,
  context: ReconciliationContext
): Promise<OrchestratorRun | null> {
  const actions = await context.store.listRunActions(run.id);
  const parkingAction = [...actions]
    .reverse()
    .find((action) => action.status === "running" && action.jobIds.length > 0);
  const parkingJobId = parkingAction?.jobIds.at(-1);

  if (parkingAction && parkingJobId) {
    const job = await context.jobs.getJob(parkingJobId, run.projectId);
    if (!job) {
      logger.warn("orchestrator_job.reconcile_missing", {
        workspaceId: context.workspaceId,
        projectId: run.projectId,
        runId: run.id,
        jobId: parkingJobId,
        actionId: parkingAction.id,
      });
      return context.park(run, "media_job");
    }
    logger.info("orchestrator_job.reconciled", {
      workspaceId: context.workspaceId,
      projectId: run.projectId,
      runId: run.id,
      jobId: parkingJobId,
      actionId: parkingAction.id,
      jobStatus: job.status,
    });
    if (job.status === "failed" || job.status === "canceled") {
      const jobMessage = redactMessage(
        job.error?.message || `parking job ${parkingJobId} ended ${job.status}`
      );
      const error =
        isToolName(parkingAction.tool) &&
        (job.error?.code === "object_not_found" ||
          job.error?.code === "asset_not_ready" ||
          job.error?.code === "storage_error" ||
          job.error?.code === "database_error")
          ? classifyToolFailure(
              new ApiError(job.error.code, jobMessage, { jobId: parkingJobId }),
              { toolName: parkingAction.tool, input: parkingAction.params }
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
      await context.store.markInvocation(parkingAction.id, {
        status: "failed",
        error: { ...reconciledError },
      });
      return reconciledError.recoverable
        ? null
        : context.finish(run, "failed", { ...reconciledError });
    }
    if (job.status !== "succeeded") return context.park(run, "media_job");
    await context.store.markInvocation(parkingAction.id, {
      status: "applied",
      outputAssetIds: jobAssetIds(job.result),
    });
    const gates = await context.store.listRunGates(run.id);
    const gate = gates.find((candidate) => candidate.stage === parkingAction.tool);
    if (gate?.status === "pending" || gate?.status === "rejected") {
      await context.store.markGateReached(run.id, parkingAction.tool);
      return context.park(run, "approval");
    }
    const stopped = await context.finishIfAfterGateReached(run, parkingAction.tool);
    if (stopped) return stopped;
  }

  return reconcileDelegation(run, actions, context);
}

async function reconcileDelegation(
  run: OrchestratorRun,
  actions: RunActionSummary[],
  context: ReconciliationContext
): Promise<OrchestratorRun | null> {
  const delegation = [...actions]
    .reverse()
    .find((action) => action.status === "running" && isDispatchToolName(action.tool));
  if (!delegation) return null;

  if (!context.store.findDelegatedChildRun && !context.store.findDelegatedChildRuns) {
    return context.park(run, "domain");
  }
  const children = context.store.findDelegatedChildRuns
    ? await context.store.findDelegatedChildRuns(delegation.id)
    : await context.store.findDelegatedChildRun!(delegation.id).then((child) =>
        child ? [child] : []
      );
  if (children.length === 0) {
    await context.store.markInvocation(delegation.id, {
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
      workspaceId: context.workspaceId,
      projectId: run.projectId,
      runId: run.id,
      delegationActionId: delegation.id,
      children,
    });
    return context.park(run, "domain");
  }
  await context.store.markInvocation(delegation.id, {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "Delegated run(s) ended without completing the durable join.",
      recoverable: true,
      details: { children },
    },
  });
  return null;
}

function jobAssetIds(result: unknown): string[] {
  if (result && typeof result === "object" && "assetIds" in result) {
    const ids = (result as { assetIds?: unknown }).assetIds;
    if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === "string");
  }
  return [];
}
