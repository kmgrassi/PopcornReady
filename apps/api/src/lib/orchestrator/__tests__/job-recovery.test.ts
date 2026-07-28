import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "@popcorn/shared/v1/types";
import { ApiError } from "@/lib/api/v1/errors";
import { canonicalExecutionInput, recoverDurableOrchestratorJob } from "../job-recovery";
import type { DurableOrchestratorJobProgress } from "../job-gateway";

function recoverableJob(status: Job["status"] = "queued"): Job {
  return {
    id: "job_1",
    schemaVersion: "job.v1",
    workspaceId: "ws_1",
    projectId: "project_1",
    type: "asset_generation",
    sessionClaimGeneration: 7,
    status,
    progress: {
      currentStep: status === "queued" ? "queued" : "generating_assets",
      heartbeatAt: "2026-07-15T11:00:00.000Z",
      execution: {
        schemaVersion: "orchestrator_job_execution.v1",
        kind: "generate_anchor",
        input: { workspaceId: "ws_1", projectId: "project_1" },
      },
    } as DurableOrchestratorJobProgress,
    input: null,
    result: null,
    error: null,
    createdAt: "2026-07-15T11:00:00.000Z",
    updatedAt: "2026-07-15T11:00:00.000Z",
  };
}

test("missing legacy job IDs reconcile as absent instead of throwing", async () => {
  const result = await recoverDurableOrchestratorJob(
    { workspaceId: "ws_1", projectId: "project_1", jobId: "legacy_job" },
    { getJob: async () => { throw new ApiError("not_found", "missing"); } }
  );
  assert.equal(result, null);
});

test("queued durable jobs claim a recovery lease and replay their typed execution envelope", async () => {
  let job = recoverableJob();
  let executions = 0;
  const result = await recoverDurableOrchestratorJob(
    {
      workspaceId: "ws_1",
      projectId: "project_1",
      jobId: job.id,
      now: new Date("2026-07-15T12:00:00.000Z"),
    },
    {
      ownerId: () => "recovery-test",
      getJob: async () => job,
      claimJobRecovery: async (claim) => {
        assert.equal(claim.staleBefore, "2026-07-15T11:58:30.000Z");
        const patch = {
          status: "running" as const,
          progress: {
            ...job.progress,
            attempt: 1,
            recoveryLease: {
              ownerId: claim.ownerId,
              claimedAt: claim.claimedAt,
              expiresAt: claim.expiresAt,
            },
          },
        };
        job = { ...job, ...patch, progress: patch.progress ?? job.progress };
        return job;
      },
      execute: async (_claimed, execution) => {
        executions += 1;
        assert.equal(execution.kind, "generate_anchor");
        job = { ...job, status: "succeeded", result: { assetIds: ["asset_1"] } };
      },
    }
  );

  assert.equal(executions, 1);
  assert.equal(result?.status, "succeeded");
  const progress = job.progress as DurableOrchestratorJobProgress;
  assert.equal(progress.attempt, 1);
  assert.deepEqual(progress.recoveryLease, {
    ownerId: "recovery-test",
    claimedAt: "2026-07-15T12:00:00.000Z",
    expiresAt: "2026-07-15T12:05:00.000Z",
  });
});

test("a live recovery lease prevents duplicate crash replay", async () => {
  const job = recoverableJob("running");
  job.progress = {
    ...(job.progress as DurableOrchestratorJobProgress),
    recoveryLease: {
      ownerId: "other-worker",
      claimedAt: "2026-07-15T11:59:00.000Z",
      expiresAt: "2026-07-15T12:04:00.000Z",
    },
  } as DurableOrchestratorJobProgress;
  let executions = 0;
  await recoverDurableOrchestratorJob(
    {
      workspaceId: "ws_1",
      projectId: "project_1",
      jobId: job.id,
      now: new Date("2026-07-15T12:00:00.000Z"),
    },
    { getJob: async () => job, execute: async () => { executions += 1; } }
  );
  assert.equal(executions, 0);
});

test("a newly queued job is not replayed while its original worker is starting", async () => {
  const job = recoverableJob("queued");
  job.updatedAt = "2026-07-15T11:59:30.000Z";
  let executions = 0;
  await recoverDurableOrchestratorJob(
    {
      workspaceId: "ws_1",
      projectId: "project_1",
      jobId: job.id,
      now: new Date("2026-07-15T12:00:00.000Z"),
    },
    { getJob: async () => job, execute: async () => { executions += 1; } }
  );
  assert.equal(executions, 0);
});

test("canonical tenant and job IDs override a tampered execution envelope", () => {
  const job = recoverableJob();
  const execution = (job.progress as DurableOrchestratorJobProgress).execution!;
  execution.input = { jobId: "foreign_job", workspaceId: "foreign_ws", projectId: "foreign_project" };
  assert.deepEqual(canonicalExecutionInput(job, execution), {
    jobId: job.id,
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    sessionClaimGeneration: 7,
  });
});

test("a foreign-project execution envelope is rejected before claim or provider execution", async () => {
  const job = recoverableJob();
  const execution = (job.progress as DurableOrchestratorJobProgress).execution!;
  execution.input.projectId = "foreign_project";
  let claimed = 0;
  let executions = 0;
  await recoverDurableOrchestratorJob(
    {
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      jobId: job.id,
      now: new Date("2026-07-15T12:00:00.000Z"),
    },
    {
      getJob: async () => job,
      claimJobRecovery: async () => { claimed += 1; return job; },
      execute: async () => { executions += 1; },
    }
  );
  assert.equal(claimed, 0);
  assert.equal(executions, 0);
});

test("stale running provider work is terminalized without replay", async () => {
  let job = recoverableJob("running");
  let executions = 0;
  let terminalized = 0;
  await recoverDurableOrchestratorJob(
    {
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      jobId: job.id,
      now: new Date("2026-07-15T12:00:00.000Z"),
    },
    {
      getJob: async () => job,
      claimJobRecovery: async (claim) => {
        assert.equal(claim.staleBefore, "2026-07-15T11:58:30.000Z");
        job = {
          ...job,
          progress: {
            ...job.progress,
            recoveryLease: {
              ownerId: claim.ownerId,
              claimedAt: claim.claimedAt,
              expiresAt: claim.expiresAt,
            },
          } as DurableOrchestratorJobProgress,
        };
        return job;
      },
      terminalizeStaleRunning: async () => {
        terminalized += 1;
        job = { ...job, status: "failed", error: { code: "job_recovery_required", message: "safe" } };
      },
      execute: async () => { executions += 1; },
    }
  );
  assert.equal(terminalized, 1);
  assert.equal(executions, 0);
  assert.equal(job.error?.code, "job_recovery_required");
});
