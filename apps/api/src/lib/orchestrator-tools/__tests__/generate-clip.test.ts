import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { ActiveProjectPlan, V1Asset } from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import { createGenerateClipTool, parseGenerateClipInput } from "../generate-clip";
import {
  runGenerateClipJob,
  type GenerateClipJobInput,
} from "../generate-clip-job";
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

test("visuals_revision generates the exact requested beat even when its clip is active", async () => {
  const assetLookups: string[] = [];
  let jobInput:
    | {
        execution: {
          input: {
            beats: Array<{ beatId: string; keyframeAssetId: string }>;
            bypassActiveClipSelection?: boolean;
          };
        };
      }
    | undefined;
  let kickedInput: GenerateClipJobInput | undefined;
  const tool = createGenerateClipTool({
    getActiveProjectPlan: async () => activePlan,
    getActiveProjectScopedAsset: async (input) => {
      assetLookups.push(input.slotRole);
      if (input.expectedRole === "beat_clip") {
        return asset({
          id: "active_clip_2",
          kind: "video",
          role: "beat_clip",
        });
      }
      if (input.expectedRole === "beat_keyframe") {
        return asset({
          id: "kf_beat_2",
          kind: "image",
          role: "beat_keyframe",
          contentHash: "kf_hash_2",
        });
      }
      return null;
    },
    getProjectRunGeneratedAsset: async () => null,
    createJob: async (input) => {
      jobInput = input as unknown as typeof jobInput;
      return queuedJob();
    },
    runGenerateClipJob: async (input) => {
      kickedInput = input;
    },
  });

  const result = (await tool.execute(
    { beatId: "beat_2", revisionInstruction: "Make the move more energetic." },
    {
      auth,
      projectId: "proj_1",
      orchestratorRunId: "visuals_run_1",
      sessionClaimGeneration: 2,
      domainTask: { taskKind: "visuals_revision" } as never,
    }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  assert.deepEqual(assetLookups, ["beat_keyframe:beat_2"]);
  assert.deepEqual(
    jobInput?.execution.input.beats.map((beat) => ({
      beatId: beat.beatId,
      keyframeAssetId: beat.keyframeAssetId,
    })),
    [{ beatId: "beat_2", keyframeAssetId: "kf_beat_2" }]
  );
  assert.equal(jobInput?.execution.input.bypassActiveClipSelection, true);
  assert.equal(kickedInput?.bypassActiveClipSelection, true);
});

test("visuals_revision reuses a same-child clip after a crash without reusing the active selection", async () => {
  const assetLookups: string[] = [];
  const runLookups: Array<{ runId: string; beatId?: string }> = [];
  let jobCalls = 0;
  const tool = createGenerateClipTool({
    getActiveProjectPlan: async () => activePlan,
    getActiveProjectScopedAsset: async (input) => {
      assetLookups.push(input.slotRole);
      if (input.expectedRole === "beat_clip") {
        return asset({
          id: "active_old_clip",
          kind: "video",
          role: "beat_clip",
        });
      }
      return null;
    },
    getProjectRunGeneratedAsset: async (input) => {
      runLookups.push({
        runId: input.orchestratorRunId,
        beatId: input.beatId,
      });
      return asset({
        id: "same_child_clip",
        kind: "video",
        role: "beat_clip",
      });
    },
    createJob: async () => {
      jobCalls += 1;
      return queuedJob();
    },
    runGenerateClipJob: async () => {
      throw new Error("must not launch a duplicate provider job");
    },
  });

  const result = (await tool.execute(
    { beatId: "beat_2" },
    {
      auth,
      projectId: "proj_1",
      orchestratorRunId: "visuals_run_1",
      sessionClaimGeneration: 2,
      domainTask: { taskKind: "visuals_revision" } as never,
    }
  )) as ToolCallResult;

  assert.equal(result.status, "succeeded");
  assert.deepEqual(assetLookups, []);
  assert.deepEqual(runLookups, [{
    runId: "visuals_run_1",
    beatId: "beat_2",
  }]);
  assert.equal(jobCalls, 0);
  if (result.status === "succeeded") {
    assert.deepEqual(
      (result.output as { skippedBeatIds?: string[] } | undefined)?.skippedBeatIds,
      ["beat_2"]
    );
  }
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
      getProjectRunGeneratedAsset: async () => null,
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
      enqueueOrchestratorDispatch: async (runId) => {
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
    {
      assetId: "kf_1",
      relation: "input",
      role: "generated_from",
      position: 1,
      contentHash: "kf_hash",
    },
  ]);
  assert.deepEqual(selected, [{ assetId: "clip_1", beatId: "beat_1" }]);
  assert.deepEqual(spy.succeededResult, { assetIds: ["clip_1"], skippedBeatIds: [] });
  assert.equal(resumedRun, "run_1");
  assert.ok(!spy.calls.includes("fail"));
});

test("domain clip completion stays pooled and cannot overwrite a newer selection", async () => {
  const spy = jobsSpy();
  const claims: Array<number | undefined> = [];
  let selectionAttempts = 0;

  await runGenerateClipJob(
    {
      jobId: "job_domain",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_domain",
      sessionClaimGeneration: 9,
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
      getProjectRunGeneratedAsset: async () => null,
      getActiveProjectScopedAsset: async () => null,
      createGeneratedAsset: async (args) => {
        claims.push(args.sessionClaimGeneration);
        return {
          status: 202,
          body: { job: { result: { assetIds: ["clip_domain"] } } },
        };
      },
      selectGeneratedBeatClipAsset: async () => {
        selectionAttempts += 1;
        throw new Error("domain jobs must not append selections");
      },
      enqueueOrchestratorDispatch: async () => {},
    }
  );

  assert.deepEqual(claims, [9]);
  assert.equal(selectionAttempts, 0);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["clip_domain"],
    skippedBeatIds: [],
  });
});

test("visuals revision worker bypasses the active clip and creates a pooled revision", async () => {
  const spy = jobsSpy();
  const generatedBodies: Record<string, unknown>[] = [];
  let selectionLookups = 0;
  let selectionAttempts = 0;

  await runGenerateClipJob(
    {
      jobId: "job_revision",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_revision",
      sessionClaimGeneration: 4,
      bypassActiveClipSelection: true,
      beats: [
        {
          beatId: "beat_1",
          prompt: "Maya unlocks the cafe with more urgency.",
          durationSec: 5,
          keyframeAssetId: "kf_1",
          keyframeContentHash: "kf_hash",
        },
      ],
    },
    {
      jobs: spy.jobs,
      getProjectRunGeneratedAsset: async () => null,
      getActiveProjectScopedAsset: async () => {
        selectionLookups += 1;
        return asset({
          id: "active_old_clip",
          kind: "video",
          role: "beat_clip",
        });
      },
      createGeneratedAsset: async (args) => {
        generatedBodies.push(args.body as Record<string, unknown>);
        return {
          status: 202,
          body: { job: { result: { assetIds: ["clip_revision"] } } },
        };
      },
      selectGeneratedBeatClipAsset: async () => {
        selectionAttempts += 1;
        return {} as never;
      },
      enqueueOrchestratorDispatch: async () => {},
    }
  );

  assert.equal(selectionLookups, 0);
  assert.equal(generatedBodies.length, 1);
  assert.equal(generatedBodies[0]?.runId, "run_revision");
  assert.equal(selectionAttempts, 0);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["clip_revision"],
    skippedBeatIds: [],
  });
});

test("recovered visuals revision worker reuses its same-child clip", async () => {
  const spy = jobsSpy();
  const runLookups: Array<{ runId: string; beatId?: string }> = [];
  let activeSelectionLookups = 0;
  let providerCalls = 0;

  await runGenerateClipJob(
    {
      jobId: "job_revision_recovery",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_revision",
      sessionClaimGeneration: 4,
      bypassActiveClipSelection: true,
      beats: [
        {
          beatId: "beat_1",
          prompt: "Maya unlocks the cafe with more urgency.",
          durationSec: 5,
          keyframeAssetId: "kf_1",
          keyframeContentHash: "kf_hash",
        },
      ],
    },
    {
      jobs: spy.jobs,
      getProjectRunGeneratedAsset: async (input) => {
        runLookups.push({
          runId: input.orchestratorRunId,
          beatId: input.beatId,
        });
        return asset({
          id: "same_child_clip",
          kind: "video",
          role: "beat_clip",
        });
      },
      getActiveProjectScopedAsset: async () => {
        activeSelectionLookups += 1;
        return asset({
          id: "active_old_clip",
          kind: "video",
          role: "beat_clip",
        });
      },
      createGeneratedAsset: async () => {
        providerCalls += 1;
        throw new Error("must not duplicate same-child provider work");
      },
      selectGeneratedBeatClipAsset: async () => {
        throw new Error("recovered domain clips must remain pooled");
      },
      enqueueOrchestratorDispatch: async () => {},
    }
  );

  assert.deepEqual(runLookups, [{ runId: "run_revision", beatId: "beat_1" }]);
  assert.equal(activeSelectionLookups, 0);
  assert.equal(providerCalls, 0);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["same_child_clip"],
    skippedBeatIds: [],
  });
});
