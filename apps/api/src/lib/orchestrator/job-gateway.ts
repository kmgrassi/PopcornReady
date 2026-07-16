import { AsyncLocalStorage } from "node:async_hooks";
import type { Job, JobError, JobProgress, JobType } from "@popcorn/shared/v1/types";
import {
  createJob as persistJob,
  createOrGetJob as persistOrGetJob,
  getJob as loadJob,
  updateJob as persistJobUpdate,
  updateActiveJob as persistActiveJobUpdate,
} from "@/lib/api/v1/store";
import { redactMessage } from "@/lib/v1/redact";

export interface CreateOrchestratorJobInput {
  workspaceId: string;
  projectId: string;
  type: JobType;
  requestId?: string;
  /** Preallocated action identity for a tool-originated provider job. */
  actionId?: string;
  payload?: unknown;
  idempotencyKey?: string | null;
  execution?: OrchestratorJobExecutionEnvelope;
}

export const ORCHESTRATOR_JOB_EXECUTION_SCHEMA = "orchestrator_job_execution.v1" as const;
export type OrchestratorJobExecutionKind =
  | "generate_storyboard"
  | "generate_anchor"
  | "generate_keyframe"
  | "generate_clip"
  | "generate_audio"
  | "edit_video_asset"
  | "export_video";

export interface OrchestratorJobExecutionEnvelope {
  schemaVersion: typeof ORCHESTRATOR_JOB_EXECUTION_SCHEMA;
  kind: OrchestratorJobExecutionKind;
  input: Record<string, unknown>;
}

export interface DurableOrchestratorJobProgress extends JobProgress {
  execution?: OrchestratorJobExecutionEnvelope;
  recoveryLease?: { ownerId: string; claimedAt: string; expiresAt: string };
}

export interface OrchestratorJobCreator {
  createJob(input: CreateOrchestratorJobInput): Promise<{
    job: Pick<Job, "id" | "status"> & Partial<Pick<Job, "result" | "error">>;
    created: boolean;
  }>;
}

export interface OrchestratorJobWriter {
  setStep(jobId: string, step: string, progress?: Partial<JobProgress>): Promise<Job>;
  reportProgress(jobId: string, progress: Partial<JobProgress>): Promise<Job>;
  succeed<TResult>(jobId: string, result: TResult): Promise<Job<TResult>>;
  fail(
    jobId: string,
    error: JobError & { requestId?: string; details?: Record<string, unknown> }
  ): Promise<Job>;
}

export interface DurableJobGatewayDeps {
  createJob: typeof persistJob;
  createOrGetJob: typeof persistOrGetJob;
  getJob: typeof loadJob;
  updateJob: typeof persistJobUpdate;
  updateActiveJob: typeof persistActiveJobUpdate;
  now(): string;
}

const defaults: DurableJobGatewayDeps = {
  createJob: persistJob,
  createOrGetJob: persistOrGetJob,
  getJob: loadJob,
  updateJob: persistJobUpdate,
  updateActiveJob: persistActiveJobUpdate,
  now: () => new Date().toISOString(),
};

const recoveryLeaseContext = new AsyncLocalStorage<string>();

export class DurableJobLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Durable job lease lost: ${jobId}`);
    this.name = "DurableJobLeaseLostError";
  }
}

export function withRecoveryLease<T>(ownerId: string, run: () => Promise<T>): Promise<T> {
  return recoveryLeaseContext.run(ownerId, run);
}

/** Supabase-backed job creation used by async orchestrator tools. */
export function createDurableOrchestratorJobCreator(
  deps: Partial<DurableJobGatewayDeps> = {}
): OrchestratorJobCreator {
  const d = { ...defaults, ...deps };

  return {
    async createJob(input) {
      if (input.idempotencyKey) {
        return d.createOrGetJob({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          type: input.type,
          requestId: input.requestId,
          actionId: input.actionId,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey,
          progress: {
            currentStep: "queued",
            percent: 0,
            ...(input.execution ? { execution: input.execution } : {}),
          } as JobProgress,
        });
      }
      const job = await d.createJob({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        type: input.type,
        requestId: input.requestId,
        actionId: input.actionId,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey ?? undefined,
        progress: {
          currentStep: "queued",
          percent: 0,
          ...(input.execution ? { execution: input.execution } : {}),
        } as JobProgress,
      });
      return { job, created: true };
    },
  };
}

/**
 * Project-scoped writer for a worker. Each write refreshes the operational
 * heartbeat; only item completion writes advance lastProgressAt.
 */
export function createDurableOrchestratorJobWriter(
  workspaceId: string,
  projectId: string,
  deps: Partial<DurableJobGatewayDeps> = {}
): OrchestratorJobWriter {
  const d = { ...defaults, ...deps };

  async function updatedOrCurrent(jobId: string, updated: Job | null): Promise<Job> {
    if (updated) return updated;
    const current = await d.getJob(workspaceId, projectId, jobId);
    const leaseOwner = (current.progress as DurableOrchestratorJobProgress).recoveryLease?.ownerId;
    if (
      (current.status === "queued" || current.status === "running") &&
      leaseOwner !== recoveryLeaseContext.getStore()
    ) {
      throw new DurableJobLeaseLostError(jobId);
    }
    return current;
  }

  async function mergeProgress(
    jobId: string,
    patch: Partial<JobProgress>
  ): Promise<Job> {
    const updated = await d.updateActiveJob(workspaceId, projectId, jobId, {
      progress: patch as JobProgress,
    }, recoveryLeaseContext.getStore());
    return updatedOrCurrent(jobId, updated);
  }

  return {
    async setStep(jobId, step, progress = {}) {
      const now = d.now();
      const updated = await d.updateActiveJob(workspaceId, projectId, jobId, {
        status: "running",
        progress: {
          currentStep: step,
          stepStartedAt: now,
          startedAt: progress.startedAt ?? now,
          lastProgressAt: progress.lastProgressAt ?? now,
          ...progress,
          heartbeatAt: now,
        },
      }, recoveryLeaseContext.getStore());
      return updatedOrCurrent(jobId, updated);
    },
    async reportProgress(jobId, progress) {
      return mergeProgress(jobId, { ...progress, heartbeatAt: d.now() });
    },
    async succeed<TResult>(jobId: string, result: TResult) {
      const now = d.now();
      const updated = await d.updateActiveJob(workspaceId, projectId, jobId, {
        status: "succeeded",
        result,
        progress: {
          currentStep: "completed",
          percent: 100,
          heartbeatAt: now,
          lastProgressAt: now,
        },
      }, recoveryLeaseContext.getStore());
      return await updatedOrCurrent(jobId, updated) as Job<TResult>;
    },
    async fail(jobId, error) {
      const safeError = { code: error.code, message: redactMessage(error.message) };
      const updated = await d.updateActiveJob(workspaceId, projectId, jobId, {
        status: "failed",
        error: safeError,
        progress: {
          heartbeatAt: d.now(),
          message: safeError.message,
        },
      }, recoveryLeaseContext.getStore());
      return updatedOrCurrent(jobId, updated);
    },
  };
}

export function getDurableOrchestratorJob(
  workspaceId: string,
  projectId: string,
  jobId: string
): Promise<Job> {
  return loadJob(workspaceId, projectId, jobId);
}

export function startDurableJobHeartbeat(
  jobs: Partial<Pick<OrchestratorJobWriter, "reportProgress">>,
  jobId: string,
  intervalMs: number = 30_000
): () => void {
  if (!jobs.reportProgress) return () => undefined;
  const timer = setInterval(() => {
    void jobs.reportProgress?.(jobId, {}).catch(() => undefined);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
