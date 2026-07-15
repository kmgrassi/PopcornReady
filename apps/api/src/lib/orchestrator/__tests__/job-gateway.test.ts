import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "@popcorn/shared/v1/types";
import {
  createDurableOrchestratorJobCreator,
  createDurableOrchestratorJobWriter,
  DurableJobLeaseLostError,
} from "../job-gateway";

function queuedJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_1",
    schemaVersion: "job.v1",
    workspaceId: "ws_1",
    projectId: "project_1",
    type: "asset_generation",
    status: "queued",
    progress: { currentStep: "queued", percent: 0 },
    input: null,
    result: null,
    error: null,
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

test("durable writer merges heartbeat and meaningful item progress into jobs.progress", async () => {
  let job = queuedJob();
  const writer = createDurableOrchestratorJobWriter("ws_1", "project_1", {
    now: () => "2026-07-15T12:01:00.000Z",
    getJob: async () => job,
    updateActiveJob: async (_workspaceId, _projectId, _jobId, patch) => {
      job = queuedJob({ ...job, ...patch, progress: { ...job.progress, ...(patch.progress ?? {}) } });
      return job;
    },
  });

  await writer.setStep("job_1", "generating_assets", {
    completedItems: 0,
    totalItems: 2,
    currentItem: { id: "anchor_1", label: "Hero", index: 1 },
  });
  assert.deepEqual(job.progress, {
    currentStep: "generating_assets",
    percent: 0,
    stepStartedAt: "2026-07-15T12:01:00.000Z",
    startedAt: "2026-07-15T12:01:00.000Z",
    lastProgressAt: "2026-07-15T12:01:00.000Z",
    heartbeatAt: "2026-07-15T12:01:00.000Z",
    completedItems: 0,
    totalItems: 2,
    currentItem: { id: "anchor_1", label: "Hero", index: 1 },
  });

  await writer.reportProgress("job_1", {
    completedItems: 1,
    lastProgressAt: "2026-07-15T12:01:00.000Z",
  });
  const progress: Job["progress"] = job.progress;
  assert.equal(progress.completedItems, 1);
  assert.equal(progress.totalItems, 2);
  assert.equal(progress.heartbeatAt, "2026-07-15T12:01:00.000Z");
  assert.equal(progress.lastProgressAt, "2026-07-15T12:01:00.000Z");
});

test("heartbeat-only reports do not advance meaningful progress", async () => {
  let now = "2026-07-15T12:01:00.000Z";
  let job = queuedJob();
  const writer = createDurableOrchestratorJobWriter("ws_1", "project_1", {
    now: () => now,
    getJob: async () => job,
    updateActiveJob: async (_workspaceId, _projectId, _jobId, patch) => {
      job = queuedJob({ ...job, ...patch, progress: { ...job.progress, ...(patch.progress ?? {}) } });
      return job;
    },
  });

  await writer.setStep("job_1", "waiting_on_provider");
  now = "2026-07-15T12:10:00.000Z";
  await writer.reportProgress("job_1", {});

  assert.equal(job.progress.heartbeatAt, "2026-07-15T12:10:00.000Z");
  assert.equal(job.progress.lastProgressAt, "2026-07-15T12:01:00.000Z");
});

test("durable creator reuses a persisted job with the same idempotency key", async () => {
  let creates = 0;
  const existing = queuedJob({ idempotencyKey: "edit:v1" });
  const creator = createDurableOrchestratorJobCreator({
    createOrGetJob: async () => ({ job: existing, created: false }),
    createJob: async () => {
      creates += 1;
      return queuedJob();
    },
  });

  const result = await creator.createJob({
    workspaceId: "ws_1",
    projectId: "project_1",
    type: "asset_generation",
    idempotencyKey: "edit:v1",
  });

  assert.equal(result.created, false);
  assert.equal(result.job.id, existing.id);
  assert.equal(creates, 0);
});

test("a delayed heartbeat cannot resurrect or overwrite a terminal job", async () => {
  let job = queuedJob({ status: "running", progress: { completedItems: 1, totalItems: 2 } });
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const writer = createDurableOrchestratorJobWriter("ws_1", "project_1", {
    getJob: async () => job,
    updateActiveJob: async () => {
      await delayed;
      return job.status === "running" ? job : null;
    },
  });
  const heartbeat = writer.reportProgress("job_1", {});
  job = queuedJob({
    status: "succeeded",
    progress: { currentStep: "completed", completedItems: 2, totalItems: 2, lastProgressAt: "done" },
  });
  release();
  const result = await heartbeat;
  assert.equal(result.status, "succeeded");
  assert.equal(result.progress.completedItems, 2);
  assert.equal(result.progress.lastProgressAt, "done");
});

test("a delayed heartbeat patch preserves concurrently completed item progress", async () => {
  let job = queuedJob({ status: "running", progress: { completedItems: 1, totalItems: 2 } });
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const writer = createDurableOrchestratorJobWriter("ws_1", "project_1", {
    getJob: async () => job,
    updateActiveJob: async (_workspace, _project, _job, patch) => {
      await delayed;
      job = { ...job, progress: { ...job.progress, ...(patch.progress ?? {}) } };
      return job;
    },
  });
  const heartbeat = writer.reportProgress("job_1", {});
  job = {
    ...job,
    progress: { ...job.progress, completedItems: 2, lastProgressAt: "item-finished" },
  };
  release();
  const result = await heartbeat;
  assert.equal(result.progress.completedItems, 2);
  assert.equal(result.progress.lastProgressAt, "item-finished");
});

test("persisted failures redact secrets and signed URLs", async () => {
  let job = queuedJob({ status: "running" });
  const writer = createDurableOrchestratorJobWriter("ws_1", "project_1", {
    getJob: async () => job,
    updateActiveJob: async (_workspace, _project, _job, patch) => {
      job = { ...job, ...patch, progress: { ...job.progress, ...(patch.progress ?? {}) } };
      return job;
    },
  });
  await writer.fail("job_1", {
    code: "job_failed",
    message: "provider token sk-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890 at https://x.test/file?token=secret",
  });
  assert.equal(job.error?.code, "job_failed");
  assert.doesNotMatch(job.error?.message ?? "", /AbCdEf|token=secret/);
  assert.doesNotMatch(job.progress.message ?? "", /AbCdEf|token=secret/);
});

test("an original worker cannot write after a recovery owner claims the job", async () => {
  const job = queuedJob({
    status: "running",
    progress: { recoveryLease: { ownerId: "recovery-owner", claimedAt: "t", expiresAt: "later" } } as never,
  });
  const writer = createDurableOrchestratorJobWriter("ws_1", "project_1", {
    getJob: async () => job,
    updateActiveJob: async () => null,
  });
  await assert.rejects(() => writer.succeed("job_1", {}), DurableJobLeaseLostError);
});
