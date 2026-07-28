import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import type { V1Asset } from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import type { CreateOrchestratorJobInput } from "@/lib/orchestrator/job-gateway";
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

const activePlan = {
  plan: samplePlan,
  assetId: "plan_1",
  contentHash: "ph",
  selectionSeq: 7,
};

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

test("generate_storyboard only links jobs to an engine-reserved action", async () => {
  let jobInput: CreateOrchestratorJobInput | undefined;
  const tool = createGenerateStoryboardTool({
    getActiveProjectPlan: async () => activePlan,
    createJob: async (input) => {
      jobInput = input;
      return queuedJob();
    },
    runStoryboardJob: async () => {},
  });

  await tool.execute(
    {},
    {
      auth,
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      toolCallId: "ephemeral-tool-call",
    }
  );

  assert.equal(jobInput?.actionId, undefined);
  assert.equal(jobInput?.idempotencyKey, undefined);
});

test("domain generate_storyboard fails closed when its session claim is missing", async () => {
  let createCalls = 0;
  const tool = createGenerateStoryboardTool({
    getActiveProjectPlan: async () => activePlan,
    createJob: async () => {
      createCalls += 1;
      return queuedJob();
    },
    runStoryboardJob: async () => {},
  });

  await assert.rejects(
    async () =>
      tool.execute(
        {},
        {
          auth,
          projectId: "proj_1",
          orchestratorRunId: "run_1",
          actionId: "action_1",
          domainTask: {} as never,
        }
      ),
    /requires its exact run, session claim, and invocation action/
  );
  assert.equal(createCalls, 0);
});

test("generate_storyboard persists the exact claim and action in durable and inline worker input", async () => {
  let jobInput: CreateOrchestratorJobInput | undefined;
  let workerInput: Parameters<typeof runStoryboardJob>[0] | undefined;
  const tool = createGenerateStoryboardTool({
    getActiveProjectPlan: async () => activePlan,
    getProjectCurrentStoryboardId: async () => "storyboard_current",
    createJob: async (input) => {
      jobInput = input;
      return queuedJob();
    },
    runStoryboardJob: async (input) => {
      workerInput = input;
    },
  });

  await tool.execute(
    {},
    {
      auth,
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      sessionClaimGeneration: 12,
      actionId: "action_1",
    }
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(jobInput?.sessionClaimGeneration, 12);
  assert.equal(jobInput?.actionId, "action_1");
  assert.deepEqual(jobInput?.execution?.input, {
    workspaceId: "ws_1",
    projectId: "proj_1",
    orchestratorRunId: "run_1",
    sessionClaimGeneration: 12,
    createdByActionId: "action_1",
    plan: samplePlan,
    planAssetId: "plan_1",
    planContentHash: "ph",
    expectedPlanSelectionSeq: 7,
    expectedCurrentStoryboardId: "storyboard_current",
  });
  assert.equal(workerInput?.sessionClaimGeneration, 12);
  assert.equal(workerInput?.createdByActionId, "action_1");
  assert.equal(workerInput?.expectedPlanSelectionSeq, 7);
  assert.equal(workerInput?.expectedCurrentStoryboardId, "storyboard_current");
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
    graphInputs: [{
      assetId: "plan_1",
      relation: "input",
      role: "plan",
      position: 0,
      contentHash: "ph",
    }],
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

test("claimed scoped storyboard generation commits one full merged bundle", async () => {
  const scopedPlan: ShotPlan = {
    ...samplePlan,
    scenes: [{
      ...samplePlan.scenes[0],
      beats: [
        samplePlan.scenes[0].beats[0],
        { id: "b2", name: "Payoff", durationSec: 5, intent: "payoff" },
      ],
    }],
  };
  const baseline = {
    ...persistedStoryboard,
    id: "sb_baseline",
    scenes: [{
      ...persistedStoryboard.scenes[0],
      storyboardId: "sb_baseline",
      beats: [
        persistedStoryboard.scenes[0].beats[0],
        {
          ...persistedStoryboard.scenes[0].beats[0],
          id: "sb_beat_2",
          beatIndex: 1,
          panels: [{
            ...persistedStoryboard.scenes[0].beats[0].panels[0],
            id: "panel_2",
            beatId: "sb_beat_2",
            imageAssetId: "tile_old_2",
          }],
        },
      ],
    }],
  } satisfies ProjectStoryboard;
  const committed = {
    ...baseline,
    id: "sb_committed",
    scenes: [{
      ...baseline.scenes[0],
      storyboardId: "sb_committed",
      beats: [
        baseline.scenes[0].beats[0],
        {
          ...baseline.scenes[0].beats[1],
          panels: [{
            ...baseline.scenes[0].beats[1].panels[0],
            imageAssetId: "tile_new_2",
          }],
        },
      ],
    }],
  } satisfies ProjectStoryboard;
  const spy = jobsSpy();
  let generatedBeatIds: string[] = [];
  let merged: Map<string, string> | undefined;
  let legacyWriteCalled = false;

  await runStoryboardJob(
    {
      jobId: "job_claimed",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      sessionClaimGeneration: 12,
      createdByActionId: "action_1",
      plan: scopedPlan,
      planAssetId: "plan_1",
      planContentHash: "ph",
      expectedPlanSelectionSeq: 7,
      expectedCurrentStoryboardId: null,
      targetBeatIds: ["b2"],
      baselineStoryboardId: "sb_baseline",
    },
    {
      getProjectCurrentStoryboardId: async () => null,
      getProjectStoryboardById: async (_workspaceId, _projectId, id) =>
        id === "sb_baseline" ? baseline : id === "sb_committed" ? committed : null,
      getAsset: async (_workspaceId, _projectId, id) =>
        storyboardAsset(id, id === "tile_1" ? "b1" : "b2"),
      generateStoryboardTilesForPlan: async ({ plan }) => {
        generatedBeatIds = plan.scenes.flatMap((scene) =>
          scene.beats.map((beat) => beat.id!)
        );
        return [{} as never];
      },
      uploadStoryboardTileObjects: async ({ assetIds }) => [{
        assetId: assetIds[0],
        beatId: "b2",
        filename: "b2.png",
        storageKey: "b2.png",
        storageBucket: "assets-private",
        visibility: "private",
        provider: "mock",
        prompt: "b2",
        contentHash: "b2-hash",
      }],
      commitClaimedStoryboardBundle: async (input) => {
        merged = input.tileAssetByBeatId;
        assert.equal(input.plan.scenes[0].beats.length, 2);
        assert.equal(input.preservation.length, 1);
        return {
          storyboardId: "sb_committed",
          panelCount: 2,
          assetIds: ["tile_new_2"],
        };
      },
      addStoryboardTiles: async () => {
        legacyWriteCalled = true;
        return [];
      },
      buildStoryboardForPlan: async () => {
        legacyWriteCalled = true;
        return { storyboardId: "wrong", panelCount: 0 };
      },
      markStoryboardHandoffReady: async () => {
        legacyWriteCalled = true;
      },
      publishStoryboard: async () => {
        legacyWriteCalled = true;
      },
      jobs: spy.jobs,
    }
  );

  assert.deepEqual(generatedBeatIds, ["b2"]);
  assert.equal(merged?.get("b1"), "tile_1");
  assert.ok(merged?.get("b2"));
  assert.equal(legacyWriteCalled, false);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["tile_new_2"],
    storyboardId: "sb_committed",
  });
});

test("claimed storyboard generation replays an identical deterministic bundle after a lost response", async () => {
  const spy = jobsSpy();
  let attempts = 0;
  let committedAssetId = "";
  let committedStoryboardId = "";
  let bundleCommitted = false;
  let firstIds: unknown;

  await runStoryboardJob(
    {
      jobId: "job_replay",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      sessionClaimGeneration: 12,
      createdByActionId: "action_1",
      plan: samplePlan,
      planAssetId: "plan_1",
      planContentHash: "ph",
      expectedPlanSelectionSeq: 7,
      expectedCurrentStoryboardId: null,
    },
    {
      getProjectCurrentStoryboardId: async () => null,
      generateStoryboardTilesForPlan: async () => [{} as never],
      uploadStoryboardTileObjects: async ({ assetIds }) => [{
        assetId: assetIds[0],
        beatId: "b1",
        filename: "b1.png",
        storageKey: "b1.png",
        storageBucket: "assets-private",
        visibility: "private",
        provider: "mock",
        prompt: "b1",
        contentHash: "b1-hash",
      }],
      commitClaimedStoryboardBundle: async (input) => {
        attempts += 1;
        committedAssetId = input.uploadedTiles[0].assetId;
        committedStoryboardId = input.ids.storyboardId;
        if (attempts === 1) {
          firstIds = structuredClone(input.ids);
          bundleCommitted = true;
        } else {
          assert.deepEqual(input.ids, firstIds);
        }
        throw new TypeError("connection closed after commit");
      },
      getProjectStoryboardById: async () =>
        bundleCommitted
          ? {
              ...persistedStoryboard,
              id: committedStoryboardId,
              scenes: [{
                ...persistedStoryboard.scenes[0],
                storyboardId: committedStoryboardId,
                beats: [{
                  ...persistedStoryboard.scenes[0].beats[0],
                  panels: [{
                    ...persistedStoryboard.scenes[0].beats[0].panels[0],
                    imageAssetId: committedAssetId,
                  }],
                }],
              }],
            }
          : null,
      getAsset: async (_workspaceId, _projectId, id) => storyboardAsset(id),
      jobs: spy.jobs,
    }
  );

  assert.equal(attempts, 2);
  assert.deepEqual(spy.succeededResult, {
    assetIds: [committedAssetId],
    storyboardId: committedStoryboardId,
  });
  assert.ok(!spy.calls.includes("fail"));
});

test("claimed storyboard crash recovery reloads the deterministic bundle before provider work", async () => {
  const spy = jobsSpy();
  let generationCalls = 0;

  await runStoryboardJob(
    {
      jobId: "job_committed_recovery",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      sessionClaimGeneration: 12,
      createdByActionId: "action_1",
      plan: samplePlan,
      planAssetId: "plan_1",
      planContentHash: "ph",
      expectedPlanSelectionSeq: 7,
      expectedCurrentStoryboardId: null,
    },
    {
      getProjectStoryboardById: async (_workspaceId, _projectId, id) => ({
        ...persistedStoryboard,
        id,
        scenes: persistedStoryboard.scenes.map((scene) => ({
          ...scene,
          storyboardId: id,
        })),
      }),
      getAsset: async (_workspaceId, _projectId, id) => storyboardAsset(id),
      generateStoryboardTilesForPlan: async () => {
        generationCalls += 1;
        return [];
      },
      jobs: spy.jobs,
    }
  );

  assert.equal(generationCalls, 0);
  const result = spy.succeededResult as {
    assetIds: string[];
    storyboardId: string;
  };
  assert.deepEqual(result.assetIds, ["tile_1"]);
  assert.match(result.storyboardId, /^[0-9a-f-]{36}$/);
  assert.ok(!spy.calls.includes("fail"));
});

test("a stale claimed storyboard commit does not attempt a fenced terminal job write", async () => {
  const spy = jobsSpy();
  await runStoryboardJob(
    {
      jobId: "job_stale",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      sessionClaimGeneration: 12,
      createdByActionId: "action_1",
      plan: samplePlan,
      planAssetId: "plan_1",
      planContentHash: "ph",
      expectedPlanSelectionSeq: 7,
      expectedCurrentStoryboardId: null,
    },
    {
      getProjectStoryboardById: async () => null,
      getProjectCurrentStoryboardId: async () => null,
      generateStoryboardTilesForPlan: async () => [{} as never],
      uploadStoryboardTileObjects: async ({ assetIds }) => [{
        assetId: assetIds[0],
        beatId: "b1",
        filename: "b1.png",
        storageKey: "b1.png",
        storageBucket: "assets-private",
        visibility: "private",
        provider: "mock",
        prompt: "b1",
        contentHash: "b1-hash",
      }],
      commitClaimedStoryboardBundle: async () => {
        throw new ApiError("database_error", "commit rejected", {
          dbCode: "55000",
          dbMessage: "stale_session_claim: run no longer owns generation",
        });
      },
      jobs: spy.jobs,
    }
  );
  assert.ok(!spy.calls.includes("fail"));
  assert.ok(!spy.calls.includes("succeed"));
});
