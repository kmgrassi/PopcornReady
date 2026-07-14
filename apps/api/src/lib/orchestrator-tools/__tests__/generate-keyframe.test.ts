import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { ApiResult } from "@/lib/api/v1/generated-assets";
import type { V1Asset, VisualAnchorPlan } from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import { createGenerateKeyframeTool } from "../generate-keyframe";
import { runGenerateKeyframeJob } from "../generate-keyframe-job";
import { ToolInputError } from "../types";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const plan: ShotPlan = {
  targetLengthSec: 10,
  style: "warm documentary",
  aspectRatio: "16:9",
  scenes: [
    {
      id: "scene_1",
      name: "Cafe",
      setting: "sunny cafe",
      beats: [
        { id: "beat_1", name: "Hook", durationSec: 5, intent: "Maya opens the cafe." },
        { id: "beat_2", name: "Payoff", durationSec: 5, intent: "Regulars arrive." },
      ],
    },
  ],
};

const storyboard: ProjectStoryboard = {
  id: "storyboard_1",
  projectId: "proj_1",
  planAssetId: "plan_1",
  status: "ready",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  scenes: [
    {
      id: "sb_scene_1",
      projectId: "proj_1",
      storyboardId: "storyboard_1",
      sceneIndex: 0,
      title: "Cafe",
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
          intent: "Maya opens the cafe.",
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
        {
          id: "sb_beat_2",
          projectId: "proj_1",
          sceneId: "sb_scene_1",
          beatIndex: 1,
          intent: "Regulars arrive.",
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
              id: "panel_2",
              projectId: "proj_1",
              beatId: "sb_beat_2",
              panelIndex: 0,
              imageAssetId: "tile_2",
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

const visualAnchorPlan: VisualAnchorPlan = {
  schemaVersion: "visual_anchor_plan.v1",
  anchors: [
    {
      id: "character_maya",
      kind: "character",
      label: "Maya",
      description: "Lead barista in a red apron.",
      sourceSceneIds: ["scene_1"],
      sourceBeatIds: ["beat_1"],
    },
  ],
};

const activePlan = { plan, assetId: "plan_1", contentHash: "plan_hash" };

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

function jobsSpy() {
  const calls: string[] = [];
  let succeededResult: unknown;
  return {
    calls,
    get succeededResult() {
      return succeededResult;
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
      async fail() {
        calls.push("fail");
        return {} as never;
      },
    },
  };
}

function asset(id: string, role: string, status: V1Asset["status"] = "ready"): V1Asset {
  return {
    id,
    schemaVersion: "asset.v1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    kind: "image",
    role,
    filename: `${id}.png`,
    status,
    source: { type: "generated", generatedAssetId: id },
    contentHash: `${id}_hash`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function jobResult(assetId: string): ApiResult {
  return {
    status: 202,
    body: {
      job: {
        id: "generated_job",
        type: "asset_generation",
        status: "succeeded",
        result: { assetIds: [assetId] },
      },
    },
  };
}

test("generate_keyframe requires a shot plan", async () => {
  const tool = createGenerateKeyframeTool({
    getActiveProjectPlan: async () => null,
    getProjectStoryboard: async () => {
      throw new Error("must not read storyboard without a plan");
    },
    createJob: async () => queuedJob(),
    runGenerateKeyframeJob: async () => {},
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "plan_shots");
  }
});

test("generate_keyframe requires a storyboard", async () => {
  const tool = createGenerateKeyframeTool({
    getActiveProjectPlan: async () => activePlan,
    getProjectStoryboard: async () => null,
    createJob: async () => queuedJob(),
    runGenerateKeyframeJob: async () => {},
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "generate_storyboard");
  }
});

test("generate_keyframe rejects a storyboard for an older plan", async () => {
  const tool = createGenerateKeyframeTool({
    getActiveProjectPlan: async () => ({ ...activePlan, assetId: "new_plan_2" }),
    getProjectStoryboard: async () => storyboard,
    createJob: async () => {
      throw new Error("must not create a job from a stale storyboard");
    },
    runGenerateKeyframeJob: async () => {},
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "generate_storyboard");
  }
});

test("generate_keyframe accepts and kicks off the worker with plan and storyboard", async () => {
  let kicked:
    | {
        jobId: string;
        orchestratorRunId?: string;
        planAssetId: string;
        provider?: string;
      }
    | undefined;
  const tool = createGenerateKeyframeTool({
    getActiveProjectPlan: async () => activePlan,
    getProjectStoryboard: async () => storyboard,
    createJob: async () => queuedJob(),
    runGenerateKeyframeJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    { provider: "mock" },
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  if (result.status === "accepted") {
    assert.equal(result.jobId, "job_1");
    assert.equal(result.resumesWhen, "job_terminal");
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kicked?.jobId, "job_1");
  assert.equal(kicked?.orchestratorRunId, "run_1");
  assert.equal(kicked?.planAssetId, "plan_1");
  assert.equal(kicked?.provider, "mock");
});

test("generate_keyframe omits provider so workspace settings can resolve it", async () => {
  let kicked: { provider?: string } | undefined;
  const tool = createGenerateKeyframeTool({
    getActiveProjectPlan: async () => activePlan,
    getProjectStoryboard: async () => storyboard,
    createJob: async () => queuedJob(),
    runGenerateKeyframeJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    {},
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kicked?.provider, undefined);
});

test("generate_keyframe validates input before reading graph state", async () => {
  let planReads = 0;
  const tool = createGenerateKeyframeTool({
    getActiveProjectPlan: async () => {
      planReads += 1;
      return activePlan;
    },
    getProjectStoryboard: async () => storyboard,
    createJob: async () => queuedJob(),
    runGenerateKeyframeJob: async () => {},
  });

  assert.throws(() => tool.parseInput({ provider: "banana" }), ToolInputError);
  assert.throws(() => tool.parseInput({ provider: "nanobanano" }), ToolInputError);
  assert.equal(planReads, 0);
});

test("runGenerateKeyframeJob generates missing beat keyframes, selects slots, and resumes", async () => {
  const spy = jobsSpy();
  const generatedBodies: Record<string, unknown>[] = [];
  const selected: Array<{ beatId: string; assetId: string }> = [];
  let resumedRun: string | undefined;

  await runGenerateKeyframeJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      plan,
      planAssetId: "plan_1",
      planContentHash: "plan_hash",
      storyboard,
      provider: "mock",
    },
    {
      jobs: spy.jobs,
      getActiveProjectVisualAnchorPlan: async () => ({
        visualAnchorPlan,
        assetId: "vap_1",
        contentHash: "vap_hash",
      }),
      getActiveProjectScopedAsset: async ({ slotRole }) => {
        if (slotRole === "character_anchor:character_maya") {
          return asset("char_anchor_1", "character_anchor");
        }
        return null;
      },
      getAsset: async (_workspaceId, _projectId, assetId) => asset(assetId, "beat_storyboard"),
      generateBeatKeyframe: async (args) => {
        generatedBodies.push(args.body as Record<string, unknown>);
        return jobResult(`kf_${generatedBodies.length}`);
      },
      selectGeneratedBeatKeyframeAsset: async (input) => {
        selected.push({ beatId: input.beatId, assetId: input.assetId });
        return asset(input.assetId, "beat_keyframe");
      },
      enqueueOrchestratorDispatch: async (runId) => {
        resumedRun = runId;
      },
    }
  );

  assert.equal(generatedBodies.length, 2);
  assert.equal(generatedBodies[0].provider, "mock");
  assert.equal(generatedBodies[0].assetRole, "beat_keyframe");
  assert.deepEqual(generatedBodies[0].anchorIds, ["char_anchor_1"]);
  assert.deepEqual(generatedBodies[0].structuralReferenceAssetIds, ["tile_1"]);
  assert.deepEqual(generatedBodies[1].anchorIds, []);
  assert.deepEqual(generatedBodies[1].structuralReferenceAssetIds, []);
  const graphInputs = generatedBodies[0].graphInputs as Array<{ assetId: string; role?: string }>;
  assert.deepEqual(
    graphInputs.map((input) => [input.assetId, input.role]),
    [
      ["plan_1", "plan"],
      ["char_anchor_1", "character_anchor"],
      ["tile_1", "beat_storyboard"],
    ]
  );
  assert.deepEqual(selected, [
    { beatId: "beat_1", assetId: "kf_1" },
    { beatId: "beat_2", assetId: "kf_2" },
  ]);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["kf_1", "kf_2"],
    skippedAssetIds: [],
  });
  assert.equal(resumedRun, "run_1");
  assert.ok(!spy.calls.includes("fail"));
});

test("runGenerateKeyframeJob skips beats with an active keyframe selection", async () => {
  const spy = jobsSpy();
  let generateCalls = 0;

  await runGenerateKeyframeJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      plan,
      planAssetId: "plan_1",
      planContentHash: "plan_hash",
      storyboard,
      provider: "mock",
    },
    {
      jobs: spy.jobs,
      getActiveProjectVisualAnchorPlan: async () => null,
      getActiveProjectScopedAsset: async ({ slotRole }) =>
        slotRole === "beat_keyframe:beat_1" ? asset("existing_kf", "beat_keyframe") : null,
      getAsset: async (_workspaceId, _projectId, assetId) => asset(assetId, "beat_storyboard"),
      generateBeatKeyframe: async () => {
        generateCalls += 1;
        return jobResult("new_kf");
      },
      selectGeneratedBeatKeyframeAsset: async () => asset("new_kf", "beat_keyframe"),
    }
  );

  assert.equal(generateCalls, 1);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["new_kf"],
    skippedAssetIds: ["existing_kf"],
  });
});

test("runGenerateKeyframeJob routes beats mentioning minors to Gemini by default", async () => {
  const spy = jobsSpy();
  let provider: string | undefined;

  await runGenerateKeyframeJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      plan: {
        ...plan,
        scenes: [
          {
            ...plan.scenes[0],
            beats: [
              { id: "beat_1", name: "Hook", durationSec: 5, intent: "A child enters the cafe." },
            ],
          },
        ],
      },
      planAssetId: "plan_1",
      planContentHash: "plan_hash",
      storyboard: {
        ...storyboard,
        scenes: [
          {
            ...storyboard.scenes[0],
            beats: [storyboard.scenes[0].beats[0]],
          },
        ],
      },
      provider: "openai",
    },
    {
      jobs: spy.jobs,
      getActiveProjectVisualAnchorPlan: async () => null,
      getActiveProjectScopedAsset: async () => null,
      getAsset: async (_workspaceId, _projectId, assetId) => asset(assetId, "beat_storyboard"),
      generateBeatKeyframe: async (args) => {
        provider = (args.body as { provider?: string }).provider;
        return jobResult("kf_child");
      },
      selectGeneratedBeatKeyframeAsset: async () => asset("kf_child", "beat_keyframe"),
    }
  );

  assert.equal(provider, "gemini");
  assert.ok(!spy.calls.includes("fail"));
});
