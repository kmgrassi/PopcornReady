import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "@/core/errors";
import type { AuthContext } from "@/lib/api/v1/auth";
import type {
  OrchestratorRun,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import { SCHEMA, type Job } from "@popcorn/shared/v1/types";
import {
  generationJobAttentionState,
  projectRunDetailFromParts,
} from "../orchestrator-run-projections";
import {
  canViewOperatorDiagnostics,
  generationRunDetailRoute,
  loadRunJobsForProjection,
} from "../orchestrator-runs";

const NOW = "2026-07-15T12:00:00.000Z";

function runFixture(): OrchestratorRun {
  return {
    id: "run_1",
    schemaVersion: "orchestrator_run.v1",
    projectId: "project_1",
    status: "waiting",
    inputSummary: "make a video",
    spentUsd: 0,
    createdAt: "2026-07-15T11:00:00.000Z",
    updatedAt: "2026-07-15T11:59:59.000Z",
  };
}

function actionFixture(jobIds: string[]): RunActionSummary {
  return {
    id: "action_anchor",
    tool: "generate_anchor",
    status: "running",
    params: {},
    outputAssetIds: [],
    jobIds,
    createdAt: "2026-07-15T11:00:00.000Z",
    updatedAt: "2026-07-15T11:59:59.000Z",
  };
}

function jobFixture(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_1",
    schemaVersion: SCHEMA.job,
    workspaceId: "workspace_1",
    projectId: "project_1",
    type: "asset_generation",
    status: "running",
    progress: {
      currentStep: "generating_anchors",
      message: "Generating anchor 4 of 6.",
      provider: "openai",
      startedAt: "2026-07-15T11:00:00.000Z",
      heartbeatAt: "2026-07-15T11:59:30.000Z",
      lastProgressAt: "2026-07-15T11:55:00.000Z",
      completedItems: 3,
      totalItems: 6,
      currentItem: { id: "anchor_4", label: "Kitchen location", index: 4 },
      attempt: 2,
      nextRetryAt: "2026-07-15T12:01:00.000Z",
    },
    input: null,
    result: null,
    error: null,
    createdAt: "2026-07-15T11:00:00.000Z",
    updatedAt: "2026-07-15T11:59:30.000Z",
    ...overrides,
  };
}

function authFixture(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    mode: "supabase",
    actor: { id: "user_1", type: "user" },
    workspaceId: "workspace_1",
    isLocal: false,
    ...overrides,
  };
}

test("projects durable job activity without treating orchestrator writes as progress", () => {
  const job = jobFixture();
  const detail = projectRunDetailFromParts(
    runFixture(),
    [],
    [actionFixture([job.id])],
    new Map(),
    { jobs: new Map([[job.id, job]]), now: () => new Date(NOW) }
  );

  assert.equal(detail.run.lastProgressAt, "2026-07-15T11:55:00.000Z");
  assert.equal(detail.operatorDiagnostics, undefined);
  assert.deepEqual(detail.stages[0]?.jobActivities, [
    {
      status: "running",
      currentStep: "generating_anchors",
      providerLabel: "OpenAI",
      startedAt: "2026-07-15T11:00:00.000Z",
      heartbeatAt: "2026-07-15T11:59:30.000Z",
      lastProgressAt: "2026-07-15T11:55:00.000Z",
      completedItems: 3,
      totalItems: 6,
      currentItemLabel: "Kitchen location",
      attentionState: "slow",
    },
  ]);
});

test("attention policy ignores recurring heartbeat when creative progress has stopped", () => {
  const policy = { slowAfterMs: 60_000, possiblyStalledAfterMs: 180_000 };
  const now = () => new Date(NOW);

  assert.equal(
    generationJobAttentionState(jobFixture(), { now, attentionPolicy: policy }),
    "possibly_stalled"
  );
  assert.equal(
    generationJobAttentionState(
      jobFixture({
        progress: {
          ...jobFixture().progress,
          lastProgressAt: "2026-07-15T11:58:30.000Z",
        },
      }),
      { now, attentionPolicy: policy }
    ),
    "slow"
  );
  assert.equal(
    generationJobAttentionState(
      jobFixture({
        progress: {
          ...jobFixture().progress,
          lastProgressAt: "2026-07-15T11:55:00.000Z",
        },
      }),
      { now, attentionPolicy: policy }
    ),
    "possibly_stalled"
  );
  assert.equal(
    generationJobAttentionState(jobFixture({ status: "failed" }), {
      now,
      attentionPolicy: policy,
    }),
    "normal"
  );
});

test("first long provider call ages from execution start even with fresh heartbeats", () => {
  const job = jobFixture({
    progress: {
      currentStep: "waiting_on_provider",
      provider: "openai",
      startedAt: "2026-07-15T11:50:00.000Z",
      lastProgressAt: "2026-07-15T11:50:00.000Z",
      heartbeatAt: "2026-07-15T11:59:59.000Z",
    },
  });

  assert.equal(
    generationJobAttentionState(job, {
      now: () => new Date(NOW),
      attentionPolicy: { slowAfterMs: 60_000, possiblyStalledAfterMs: 5 * 60_000 },
    }),
    "possibly_stalled"
  );
});

test("raw provider and retry diagnostics require the explicit operator projection", () => {
  const job = jobFixture({
    progress: {
      ...jobFixture().progress,
      message: "Provider failed with api_key=definitely-not-a-real-provider-key",
    },
  });
  const creator = projectRunDetailFromParts(
    runFixture(),
    [],
    [actionFixture([job.id])],
    new Map(),
    { jobs: new Map([[job.id, job]]) }
  );
  assert.equal(creator.operatorDiagnostics, undefined);
  const creatorActivity = creator.stages[0]?.jobActivities?.[0];
  assert.equal(creatorActivity && "jobId" in creatorActivity, false);
  assert.equal(creatorActivity && "message" in creatorActivity, false);

  const operator = projectRunDetailFromParts(
    runFixture(),
    [],
    [actionFixture([job.id])],
    new Map(),
    { jobs: new Map([[job.id, job]]), includeOperatorDiagnostics: true }
  );
  assert.deepEqual(operator.operatorDiagnostics?.[0], {
    ...operator.stages[0]?.jobActivities?.[0],
    jobId: "job_1",
    actionId: "action_anchor",
    runId: "run_1",
    message: "Provider failed with api_key=[REDACTED]",
    provider: "openai",
    attempt: 2,
    nextRetryAt: "2026-07-15T12:01:00.000Z",
    updatedAt: "2026-07-15T11:59:30.000Z",
  });
});

test("operator diagnostics use canonical current-workspace membership and fail closed", async () => {
  const membershipCalls: Array<[string, string]> = [];
  const authorize = (role: "owner" | "admin" | "member" | null) =>
    canViewOperatorDiagnostics(authFixture(), {
      nodeEnv: "production",
      getWorkspaceRole: async (workspaceId, userId) => {
        membershipCalls.push([workspaceId, userId]);
        return role;
      },
    });

  assert.equal(await authorize("owner"), true);
  assert.equal(await authorize("admin"), true);
  assert.equal(await authorize("member"), false);
  assert.equal(await authorize(null), false);
  assert.deepEqual(membershipCalls[0], ["workspace_1", "user_1"]);
  assert.equal(
    await canViewOperatorDiagnostics(authFixture(), {
      nodeEnv: "production",
      getWorkspaceRole: async () => {
        throw new Error("database unavailable");
      },
    }),
    false
  );
});

test("local diagnostics are authorized only outside production", async () => {
  const local = authFixture({
    mode: "local",
    actor: { id: "local_dev", type: "local" },
    isLocal: true,
  });
  assert.equal(await canViewOperatorDiagnostics(local, { nodeEnv: "development" }), true);
  assert.equal(await canViewOperatorDiagnostics(local, { nodeEnv: "test" }), true);
  assert.equal(await canViewOperatorDiagnostics(local, { nodeEnv: "production" }), false);
  assert.equal(
    await canViewOperatorDiagnostics(
      authFixture({ actor: { id: "guest_1", type: "user", isAnonymous: true } }),
      { nodeEnv: "production", getWorkspaceRole: async () => "owner" }
    ),
    false
  );
});

test("generation-run detail route gates operator projection at the server boundary", async () => {
  let diagnosticsFlag: boolean | undefined;
  const safeDetail = projectRunDetailFromParts(runFixture(), [], []);
  const result = await generationRunDetailRoute(
    { auth: authFixture() },
    { projectId: "project_1", runId: "run_1" },
    {
      requireProjectAccess: async () => undefined,
      recordProjectActivity: async () => undefined,
      canViewOperatorDiagnostics: (auth) =>
        canViewOperatorDiagnostics(auth, {
          nodeEnv: "production",
          getWorkspaceRole: async () => "admin",
        }),
      assembleRunDetail: async (_runId, _workspaceId, _projectId, includeDiagnostics) => {
        diagnosticsFlag = includeDiagnostics;
        return safeDetail;
      },
    }
  );

  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(diagnosticsFlag, true);
});

test("durable job loading is tenant-scoped, deduplicated, and tolerates legacy ids", async () => {
  const calls: Array<[string, string, string]> = [];
  const job = jobFixture();
  const jobs = await loadRunJobsForProjection({
    workspaceId: "workspace_1",
    projectId: "project_1",
    actions: [actionFixture([job.id, job.id, "legacy_job"])],
    loadJob: async (workspaceId, projectId, jobId) => {
      calls.push([workspaceId, projectId, jobId]);
      if (jobId === "legacy_job") throw new ApiError("not_found", "missing");
      return job;
    },
  });

  assert.deepEqual(calls, [
    ["workspace_1", "project_1", "job_1"],
    ["workspace_1", "project_1", "legacy_job"],
  ]);
  assert.deepEqual([...jobs.keys()], ["job_1"]);
});
