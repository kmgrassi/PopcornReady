import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { V1Asset } from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import { createGenerateStoryboardTool } from "../generate-storyboard";
import { runStoryboardJob } from "../storyboard-job";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const samplePlan: ShotPlan = {
  targetLengthSec: 15,
  style: "playful",
  aspectRatio: "9:16",
  scenes: [
    { id: "s1", name: "Setup", beats: [{ id: "b1", name: "Hook", durationSec: 5, intent: "hook" }] },
  ],
};

const activePlan = { plan: samplePlan, assetId: "plan_1", contentHash: "ph" };

function queuedJob() {
  return {
    job: {
      id: "job_1",
      type: "asset_generation" as const,
      status: "queued" as const,
      projectId: "proj_1",
      createdAt: "t",
      updatedAt: "t",
    },
    created: true,
  };
}

// ---------- tool ----------

test("generate_storyboard requires a plan (suggests plan_shots)", async () => {
  const tool = createGenerateStoryboardTool({
    getActiveProjectPlan: async () => null,
    createJob: async () => {
      throw new Error("must not create a job without a plan");
    },
    runStoryboardJob: async () => {},
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "plan_shots");
  }
});

test("generate_storyboard accepts and kicks off the worker with run + plan", async () => {
  let kicked: { jobId: string; orchestratorRunId?: string; planAssetId: string } | undefined;
  const tool = createGenerateStoryboardTool({
    getActiveProjectPlan: async () => activePlan,
    createJob: async () => queuedJob(),
    runStoryboardJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    {},
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  if (result.status === "accepted") {
    assert.equal(result.jobId, "job_1");
    assert.equal(result.resumesWhen, "job_terminal");
  }
  await new Promise((resolve) => setImmediate(resolve)); // let the fire-and-forget run
  assert.equal(kicked?.jobId, "job_1");
  assert.equal(kicked?.orchestratorRunId, "run_1");
  assert.equal(kicked?.planAssetId, "plan_1");
});

// ---------- worker ----------

function jobsSpy() {
  const calls: string[] = [];
  let succeededResult: unknown;
  let failedError: unknown;
  return {
    calls,
    get succeededResult() {
      return succeededResult;
    },
    get failedError() {
      return failedError;
    },
    jobs: {
      async setStep() {
        calls.push("setStep");
        return {} as never;
      },
      async succeed(_id: string, result: unknown) {
        calls.push("succeed");
        succeededResult = result;
        return {} as never;
      },
      async fail(_id: string, error: unknown) {
        calls.push("fail");
        failedError = error;
        return {} as never;
      },
    },
  };
}

const workerInput = {
  jobId: "job_1",
  workspaceId: "ws_1",
  projectId: "proj_1",
  orchestratorRunId: "run_1",
  plan: samplePlan,
  planAssetId: "plan_1",
  planContentHash: "ph",
};

const persistedStoryboard: ProjectStoryboard = {
  id: "sb_1",
  projectId: "proj_1",
  planAssetId: "plan_1",
  status: "ready",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  scenes: [
    {
      id: "sb_scene_1",
      projectId: "proj_1",
      storyboardId: "sb_1",
      sceneIndex: 0,
      title: "Setup",
      summary: null,
      setting: null,
      mood: null,
      durationSec: null,
      sceneAssetId: null,
      status: "ready",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      beats: [
        {
          id: "sb_beat_1",
          projectId: "proj_1",
          sceneId: "sb_scene_1",
          beatIndex: 0,
          intent: "hook",
          visualDescription: null,
          dialogueSummary: null,
          narration: null,
          durationSec: 5,
          shotType: null,
          camera: null,
          framing: null,
          status: "ready",
          beatAssetId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          panels: [
            {
              id: "panel_1",
              projectId: "proj_1",
              beatId: "sb_beat_1",
              panelIndex: 0,
              imageAssetId: "tile_1",
              promptAssetId: null,
              status: "ready",
              isSelected: true,
              approvedAt: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    },
  ],
};

function storyboardAsset(id = "tile_1", beatId = "b1"): V1Asset {
  return {
    id,
    schemaVersion: "asset.v1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    kind: "image",
    role: "beat_storyboard",
    filename: `${id}.png`,
    status: "ready",
    source: { type: "generated", generatedAssetId: id },
    provenance: { provider: "mock", prompt: "storyboard tile", beatId },
    graphInputs: [{ assetId: "plan_1", relation: "input", role: "plan", position: 0 }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("runStoryboardJob persists tiles + storyboard, succeeds the job, and resumes the run", async () => {
  const spy = jobsSpy();
  let resumedRun: string | undefined;

  await runStoryboardJob(workerInput, {
    generateStoryboardTilesForPlan: async () => [{} as never],
    addStoryboardTiles: async () => [{ beatId: "b1", assetId: "tile_1" }],
    buildStoryboardForPlan: async () => ({ storyboardId: "sb_1", panelCount: 1 }),
    getProjectStoryboardById: async () => persistedStoryboard,
    getAsset: async () => storyboardAsset(),
    markStoryboardHandoffReady: async () => {},
    publishStoryboard: async () => {},
    jobs: spy.jobs,
    enqueueOrchestratorDispatch: async (runId) => {
      resumedRun = runId;
    },
  });

  assert.deepEqual(spy.succeededResult, { assetIds: ["tile_1"], storyboardId: "sb_1" });
  assert.equal(resumedRun, "run_1");
  assert.ok(!spy.calls.includes("fail"));
});

test("runStoryboardJob does not publish an attempt that fails handoff validation", async () => {
  const spy = jobsSpy();
  let publishCalls = 0;
  await runStoryboardJob(workerInput, {
    generateStoryboardTilesForPlan: async () => [{} as never],
    addStoryboardTiles: async () => [{ beatId: "b1", assetId: "tile_1" }],
    buildStoryboardForPlan: async () => ({ storyboardId: "sb_partial", panelCount: 1 }),
    getProjectStoryboardById: async () => persistedStoryboard,
    getAsset: async () => storyboardAsset("tile_1", "wrong_beat"),
    markStoryboardHandoffReady: async () => {},
    publishStoryboard: async () => {
      publishCalls += 1;
    },
    jobs: spy.jobs,
    enqueueOrchestratorDispatch: async () => {},
  });

  assert.equal(publishCalls, 0);
  assert.ok(spy.calls.includes("fail"));
  assert.ok(!spy.calls.includes("succeed"));
});

test("runStoryboardJob fails the job on error but still resumes the run", async () => {
  const spy = jobsSpy();
  let resumed = false;

  await runStoryboardJob(workerInput, {
    generateStoryboardTilesForPlan: async () => {
      throw new Error("provider boom");
    },
    jobs: spy.jobs,
    enqueueOrchestratorDispatch: async () => {
      resumed = true;
    },
  });

  assert.ok(spy.calls.includes("fail"));
  assert.ok(!spy.calls.includes("succeed"));
  assert.ok(resumed, "the run must resume so it can record the failure");
});

test("runStoryboardJob fails before building when persisted beat ids are incomplete", async () => {
  const spy = jobsSpy();
  let buildCalls = 0;

  await runStoryboardJob(workerInput, {
    generateStoryboardTilesForPlan: async () => [{} as never],
    addStoryboardTiles: async () => [{ beatId: "unexpected", assetId: "tile_1" }],
    buildStoryboardForPlan: async () => {
      buildCalls += 1;
      return { storyboardId: "sb_1", panelCount: 1 };
    },
    jobs: spy.jobs,
  });

  assert.equal(buildCalls, 0);
  assert.ok(spy.calls.includes("fail"));
  assert.ok(!spy.calls.includes("succeed"));
});

test("runStoryboardJob fails when the built storyboard has too few panels", async () => {
  const spy = jobsSpy();

  await runStoryboardJob(workerInput, {
    generateStoryboardTilesForPlan: async () => [{} as never],
    addStoryboardTiles: async () => [{ beatId: "b1", assetId: "tile_1" }],
    buildStoryboardForPlan: async () => ({ storyboardId: "sb_partial", panelCount: 0 }),
    jobs: spy.jobs,
  });

  assert.ok(spy.calls.includes("fail"));
  assert.match(
    String((spy.failedError as { message?: string } | undefined)?.message),
    /0 selected panels for 1 planned beats/
  );
});
