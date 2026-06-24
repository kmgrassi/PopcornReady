import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { ActiveProjectPlan, V1Asset } from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import { createGenerateClipTool, parseGenerateClipInput } from "../generate-clip";
import { runGenerateClipJob } from "../generate-clip-job";
import { ToolInputError } from "../types";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const plan: ShotPlan = {
  targetLengthSec: 12,
  style: "warm documentary",
  aspectRatio: "16:9",
  scenes: [
    {
      id: "scene_1",
      name: "Cafe opening",
      beats: [
        { id: "beat_1", name: "Hook", durationSec: 5, intent: "Maya unlocks the cafe." },
        { id: "beat_2", name: "Payoff", durationSec: 7, intent: "Regulars enter." },
      ],
    },
  ],
};

const activePlan: ActiveProjectPlan = {
  plan,
  assetId: "plan_1",
  contentHash: "plan_hash",
};

function asset(overrides: Partial<V1Asset>): V1Asset {
  return {
    id: overrides.id ?? "asset_1",
    schemaVersion: "asset.v1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    kind: overrides.kind ?? "image",
    role: overrides.role,
    filename: overrides.filename ?? "asset.bin",
    status: overrides.status ?? "ready",
    source: overrides.source ?? { type: "generated", generatedAssetId: "asset_1" },
    durationSec: overrides.durationSec,
    provenance: overrides.provenance,
    graphInputs: overrides.graphInputs,
    contentHash: overrides.contentHash,
    createdAt: "t",
    updatedAt: "t",
  };
}

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

test("generate_clip rejects unsupported fields before reading project state", () => {
  assert.throws(() => parseGenerateClipInput({ temperature: 1 }), ToolInputError);
  assert.throws(
    () => parseGenerateClipInput({ beatId: "beat_1", beatIds: ["beat_2"] }),
    ToolInputError
  );
});

test("generate_clip requires active keyframes for requested beats", async () => {
  const tool = createGenerateClipTool({
    getActiveProjectPlan: async () => activePlan,
    getActiveProjectScopedAsset: async () => null,
    createJob: async () => {
      throw new Error("must not create a job without keyframes");
    },
    runGenerateClipJob: async () => {},
  });

  const result = (await tool.execute(
    { beatId: "beat_1" },
    { auth, projectId: "proj_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "generate_keyframe");
    assert.deepEqual(result.error.unmetRequirements?.[0]?.satisfyWith.inputHint, {
      beatId: "beat_1",
    });
  }
});

test("generate_clip queues only beats without an active clip", async () => {
  let kicked:
    | {
        beats: Array<{ beatId: string; keyframeAssetId: string }>;
        skippedBeatIds?: string[];
        provider?: string;
      }
    | undefined;

  const tool = createGenerateClipTool({
    getActiveProjectPlan: async () => activePlan,
    getActiveProjectScopedAsset: async (input) => {
      if (input.expectedRole === "beat_clip" && input.slotRole === "beat_clip:beat_2") {
        return asset({ id: "clip_2", kind: "video", role: "beat_clip" });
      }
      if (input.expectedRole === "beat_keyframe") {
        const beatId = input.slotRole.replace("beat_keyframe:", "");
        return asset({
          id: `kf_${beatId}`,
          kind: "image",
          role: "beat_keyframe",
          contentHash: `hash_${beatId}`,
        });
      }
      return null;
    },
    createJob: async () => queuedJob(),
    runGenerateClipJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    { provider: "mock" },
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(kicked?.beats.map((beat) => beat.beatId), ["beat_1"]);
  assert.equal(kicked?.beats[0]?.keyframeAssetId, "kf_beat_1");
  assert.deepEqual(kicked?.skippedBeatIds, ["beat_2"]);
  assert.equal(kicked?.provider, "mock");
});

test("generate_clip omits provider so workspace settings can resolve it", async () => {
  let kicked: { provider?: string; model?: string } | undefined;
  const tool = createGenerateClipTool({
    getActiveProjectPlan: async () => activePlan,
    getActiveProjectScopedAsset: async (input) => {
      if (input.expectedRole === "beat_keyframe") {
        const beatId = input.slotRole.replace("beat_keyframe:", "");
        return asset({
          id: `kf_${beatId}`,
          kind: "image",
          role: "beat_keyframe",
          contentHash: `hash_${beatId}`,
        });
      }
      return null;
    },
    createJob: async () => queuedJob(),
    runGenerateClipJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    { beatId: "beat_1" },
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kicked?.provider, undefined);
  assert.equal(kicked?.model, undefined);
});

test("generate_clip succeeds inline when every requested clip already exists", async () => {
  const tool = createGenerateClipTool({
    getActiveProjectPlan: async () => activePlan,
    getActiveProjectScopedAsset: async (input) =>
      input.expectedRole === "beat_clip"
        ? asset({
            id: `clip_${input.slotRole.replace("beat_clip:", "")}`,
            kind: "video",
            role: "beat_clip",
          })
        : null,
    createJob: async () => {
      throw new Error("must not create a job when no clips are missing");
    },
    runGenerateClipJob: async () => {},
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.output, {
      assetIds: [],
      skippedBeatIds: ["beat_1", "beat_2"],
    });
  }
});

test("runGenerateClipJob generates clips with keyframe graph inputs, selects them, and resumes", async () => {
  const spy = jobsSpy();
  const generatedBodies: Record<string, unknown>[] = [];
  const selected: Array<{ assetId: string; beatId: string }> = [];
  let resumedRun: string | undefined;

  await runGenerateClipJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      provider: "mock",
      beats: [
        {
          beatId: "beat_1",
          prompt: "Maya unlocks the cafe.",
          durationSec: 5,
          keyframeAssetId: "kf_1",
          keyframeContentHash: "kf_hash",
        },
      ],
    },
    {
      jobs: spy.jobs,
      getActiveProjectScopedAsset: async () => null,
      createGeneratedAsset: async (args) => {
        generatedBodies.push(args.body as Record<string, unknown>);
        return {
          status: 202,
          body: { job: { result: { assetIds: ["clip_1"] } } },
        };
      },
      selectGeneratedBeatClipAsset: async (input) => {
        selected.push({ assetId: input.assetId, beatId: input.beatId });
        return {} as never;
      },
      resumeOrchestratorRun: async (runId) => {
        resumedRun = runId;
      },
    }
  );

  assert.equal(generatedBodies[0]?.assetRole, "beat_clip");
  assert.deepEqual(generatedBodies[0]?.referenceAssetIds, ["kf_1"]);
  assert.deepEqual(generatedBodies[0]?.graphInputs, [
    {
      assetId: "kf_1",
      relation: "input",
      role: "beat_keyframe",
      position: 0,
      contentHash: "kf_hash",
    },
  ]);
  assert.deepEqual(selected, [{ assetId: "clip_1", beatId: "beat_1" }]);
  assert.deepEqual(spy.succeededResult, { assetIds: ["clip_1"], skippedBeatIds: [] });
  assert.equal(resumedRun, "run_1");
  assert.ok(!spy.calls.includes("fail"));
});
