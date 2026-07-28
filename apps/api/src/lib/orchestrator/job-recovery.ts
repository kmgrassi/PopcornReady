import { randomUUID } from "node:crypto";
import type { Job } from "@popcorn/shared/v1/types";
import { claimJobRecovery, getJob } from "@/lib/api/v1/store";
import { getOrchestratorRun } from "@/lib/api/v1/orchestrator-store";
import { ApiError } from "@/lib/api/v1/errors";
import {
  ORCHESTRATOR_JOB_EXECUTION_SCHEMA,
  createDurableOrchestratorJobWriter,
  type DurableOrchestratorJobProgress,
  type OrchestratorJobExecutionEnvelope,
  withRecoveryLease,
} from "./job-gateway";
import {
  reconcileCommittedStoryboardJob,
  runStoryboardJob,
} from "@/lib/orchestrator-tools/storyboard-job";
import { runGenerateAnchorJob } from "@/lib/orchestrator-tools/generate-anchor-job";
import { runGenerateKeyframeJob } from "@/lib/orchestrator-tools/generate-keyframe-job";
import { runGenerateClipJob } from "@/lib/orchestrator-tools/generate-clip-job";
import { runGenerateAudioJob } from "@/lib/orchestrator-tools/generate-audio-job";
import { runEditVideoAssetJob } from "@/lib/orchestrator-tools/edit-video-asset-job";
import { runExportVideoJob } from "@/lib/orchestrator-tools/export-video-job";
import { createLogger } from "@/lib/v1/logger";

const STALE_HEARTBEAT_MS = 90_000;
const RECOVERY_LEASE_MS = 5 * 60_000;
const logger = createLogger();

function executionOf(job: Job): OrchestratorJobExecutionEnvelope | null {
  const execution = (job.progress as DurableOrchestratorJobProgress).execution;
  return execution?.schemaVersion === ORCHESTRATOR_JOB_EXECUTION_SCHEMA ? execution : null;
}

export function isDurableJobStale(job: Job, nowMs: number = Date.now()): boolean {
  if (job.status === "queued") {
    const queuedAt = Date.parse(job.updatedAt || job.createdAt);
    return !Number.isFinite(queuedAt) || nowMs - queuedAt >= STALE_HEARTBEAT_MS;
  }
  if (job.status !== "running") return false;
  const progress = job.progress as DurableOrchestratorJobProgress;
  const heartbeat = Date.parse(progress.heartbeatAt ?? progress.startedAt ?? job.updatedAt);
  return !Number.isFinite(heartbeat) || nowMs - heartbeat >= STALE_HEARTBEAT_MS;
}

async function execute(job: Job, execution: OrchestratorJobExecutionEnvelope): Promise<void> {
  const input = canonicalExecutionInput(job, execution) as never;
  switch (execution.kind) {
    case "generate_storyboard": return runStoryboardJob(input);
    case "generate_anchor": return runGenerateAnchorJob(input);
    case "generate_keyframe": return runGenerateKeyframeJob(input);
    case "generate_clip": return runGenerateClipJob(input);
    case "generate_audio": return runGenerateAudioJob(input);
    case "edit_video_asset": return runEditVideoAssetJob(input);
    case "export_video": return runExportVideoJob(input);
  }
}

export function canonicalExecutionInput(
  job: Job,
  execution: OrchestratorJobExecutionEnvelope
): Record<string, unknown> {
  return {
    ...execution.input,
    jobId: job.id,
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    ...(job.sessionClaimGeneration !== undefined
      ? { sessionClaimGeneration: job.sessionClaimGeneration }
      : {}),
  };
}

export interface DurableJobRecoveryDeps {
  getJob: typeof getJob;
  claimJobRecovery: typeof claimJobRecovery;
  getRun: typeof getOrchestratorRun;
  execute: typeof execute;
  reconcileCommittedStoryboard(
    job: Job,
    execution: OrchestratorJobExecutionEnvelope,
    ownerId: string
  ): Promise<boolean>;
  ownerId(): string;
  terminalizeStaleRunning(job: Job, ownerId: string): Promise<void>;
}

const defaults: DurableJobRecoveryDeps = {
  getJob,
  claimJobRecovery,
  getRun: getOrchestratorRun,
  execute,
  reconcileCommittedStoryboard: async (job, execution, ownerId) => {
    const writer = createDurableOrchestratorJobWriter(
      job.workspaceId,
      job.projectId
    );
    const canonicalInput = canonicalExecutionInput(job, execution);
    return withRecoveryLease(ownerId, () =>
      reconcileCommittedStoryboardJob(
        canonicalInput as unknown as Parameters<
          typeof reconcileCommittedStoryboardJob
        >[0],
        { jobs: writer }
      )
    );
  },
  ownerId: () => `recovery-${randomUUID()}`,
  terminalizeStaleRunning: async (job, ownerId) => {
    const writer = createDurableOrchestratorJobWriter(job.workspaceId, job.projectId);
    await withRecoveryLease(ownerId, () => writer.fail(job.id, {
      code: "job_recovery_required",
      message: "Provider work stopped reporting progress and was not replayed automatically.",
    }));
  },
};

/** Reclaims only queued or stale-running jobs while the dispatcher owns the run lease. */
export async function recoverDurableOrchestratorJob(input: {
  workspaceId: string;
  projectId: string;
  jobId: string;
  now?: Date;
}, deps: Partial<DurableJobRecoveryDeps> = {}): Promise<Job | null> {
  const d = { ...defaults, ...deps };
  let job: Job;
  try {
    job = await d.getJob(input.workspaceId, input.projectId, input.jobId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") return null;
    throw error;
  }
  const execution = executionOf(job);
  if (!execution || !isDurableJobStale(job, input.now?.getTime())) return job;
  const expectedType = execution.kind === "export_video" ? "export" : "asset_generation";
  if (job.type !== expectedType) return job;
  if (
    (execution.input.workspaceId !== undefined && execution.input.workspaceId !== job.workspaceId) ||
    (execution.input.projectId !== undefined && execution.input.projectId !== job.projectId)
  ) return job;
  const runId = execution.input.orchestratorRunId;
  if (typeof runId === "string") {
    const run = await d.getRun(runId);
    if (run.projectId !== job.projectId) return job;
  }

  const now = input.now ?? new Date();
  const progress = job.progress as DurableOrchestratorJobProgress;
  const priorLeaseExpiry = Date.parse(progress.recoveryLease?.expiresAt ?? "");
  if (Number.isFinite(priorLeaseExpiry) && priorLeaseExpiry > now.getTime()) return job;

  const ownerId = d.ownerId();
  const claimed = await d.claimJobRecovery({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    job,
    ownerId,
    claimedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RECOVERY_LEASE_MS).toISOString(),
    staleBefore: new Date(now.getTime() - STALE_HEARTBEAT_MS).toISOString(),
  });
  if (!claimed) return d.getJob(input.workspaceId, input.projectId, input.jobId);
  logger.warn("orchestrator_job.recovery_claimed", {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    jobId: input.jobId,
    jobType: claimed.type,
    executionKind: execution.kind,
    attempt: (progress.attempt ?? 0) + 1,
  });
  if (job.status === "running") {
    if (
      execution.kind === "generate_storyboard" &&
      await d.reconcileCommittedStoryboard(job, execution, ownerId)
    ) {
      return d.getJob(input.workspaceId, input.projectId, input.jobId);
    }
    await d.terminalizeStaleRunning(job, ownerId);
    return d.getJob(input.workspaceId, input.projectId, input.jobId);
  }
  await withRecoveryLease(ownerId, () => d.execute(claimed, execution));
  return d.getJob(input.workspaceId, input.projectId, input.jobId);
}
