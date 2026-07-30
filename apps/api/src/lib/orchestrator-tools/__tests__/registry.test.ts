import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { VideoBrief } from "@/lib/api/v1/schemas";
import type { ShotPlan } from "@popcorn/shared/types";
import type { V1Action, V1Asset } from "@/lib/api/v1/store";
import { createAssembleTimelineTool } from "../assemble-timeline";
import { createBriefInputSchema } from "../create-or-load-brief";
import { createTestToolRegistry } from "./test-registry";
import {
  createPlanShotsTool,
  persistedShotPlanSchema,
  type PlanShotsDeps,
  type PlanShotsOutput,
} from "../plan-shots";
import { ToolRegistry } from "../registry";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "00000000-0000-0000-0000-000000000001",
  isLocal: true,
};

const samplePlan: ShotPlan = {
  targetLengthSec: 20,
  style: "playful",
  aspectRatio: "16:9",
  scenes: [
    {
      id: "scene_1",
      name: "Setup",
      beats: [
        { id: "beat_1", name: "Hook", durationSec: 5, intent: "Introduce the premise." },
      ],
    },
  ],
};

const sampleBrief: VideoBrief = {
  goal: "A comedy about a space diner.",
  targetLengthSec: 30,
  aspectRatio: "9:16",
  style: "deadpan",
  audience: "Late-night scrollers",
  platform: "tiktok",
  format: "challenge",
  hookQuestion: "What happens when the diner is in orbit?",
  strongestVisual: "A floating burger tray crossing a neon booth.",
  oneBigIdea: "Fast food service can feel cinematic in zero gravity.",
  caveat: "Keep the humor dry, not slapstick.",
  payoff: "The punchline lands when the order docks perfectly.",
  constraints: {
    callToAction: "Try the midnight special.",
  },
};

const activeBrief = {
  brief: sampleBrief,
  assetId: "brief_asset_1",
  contentHash: "brief_hash_1",
};

const sampleVideoAsset: V1Asset = {
  id: "clip_asset_1",
  schemaVersion: "asset.v1",
  workspaceId: auth.workspaceId,
  projectId: "proj_1",
  kind: "video",
  role: "beat_clip",
  filename: "clip_asset_1.mp4",
  status: "ready",
  source: { type: "generated", generatedAssetId: "clip_asset_1" },
  remoteUrl: "https://example.com/clip_asset_1.mp4",
  durationSec: 5,
  contentHash: "clip_hash_1",
  createdAt: "2026-06-17T00:00:00.000Z",
  updatedAt: "2026-06-17T00:00:00.000Z",
};

function uploadAsset(id: string, index: number): V1Asset {
  return {
    id,
    schemaVersion: "asset.v1",
    workspaceId: auth.workspaceId,
    projectId: "proj_1",
    kind: "video",
    role: "upload",
    filename: `${id}.mp4`,
    status: "ready",
    source: { type: "remote_url", url: `https://example.com/${id}.mp4` },
    remoteUrl: `https://example.com/${id}.mp4`,
    durationSec: 5 + index,
    contentHash: `${id}_hash`,
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
  };
}

function audioAsset(id: string, role: "voiceover" | "soundtrack"): V1Asset {
  return {
    id,
    schemaVersion: "asset.v1",
    workspaceId: auth.workspaceId,
    projectId: "proj_1",
    kind: "audio",
    role,
    filename: `${id}.mp3`,
    status: "ready",
    source: { type: "generated", generatedAssetId: id },
    remoteUrl: `https://example.com/${id}.mp3`,
    durationSec: 12,
    contentHash: `${id}_hash`,
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
  };
}

// Deps that satisfy plan_shots without touching the DB.
function planShotsDeps(over: Partial<Parameters<typeof createPlanShotsTool>[0]> = {}) {
  return {
    planEdit: async () => samplePlan,
    getActiveProjectBrief: async () => activeBrief,
    getActiveProjectStoryBlueprint: async () => null,
    getActiveProjectScriptDraft: async () => null,
    addProjectPlan: async () => ({ planAssetId: "plan_asset_1" }),
    buildFootageGroundingContext: async () => ({ excerpts: [], promptText: null }),
    ...over,
  };
}

test("registry rejects duplicate tool names", () => {
  const registry = new ToolRegistry();
  registry.register(createPlanShotsTool(planShotsDeps()));

  assert.throws(
    () => registry.register(createPlanShotsTool(planShotsDeps())),
    /already registered/
  );
});

test("default registry exposes plan_shots metadata", () => {
  const registry = createTestToolRegistry({ planShots: planShotsDeps() });
  const definition = registry.get("plan_shots");

  assert.equal(definition.name, "plan_shots");
  assert.equal(definition.execution, "sync");
  assert.equal(definition.inputSchema.type, "object");
  assert.equal(definition.outputSchema.type, "object");
});

test("create_or_load_brief schema constrains enum fields to validator values", () => {
  const platform = createBriefInputSchema.properties.platform as { enum: readonly string[] };
  const format = createBriefInputSchema.properties.format as { enum: readonly string[] };

  assert.deepEqual(platform.enum, [
    "youtube",
    "tiktok",
    "reels",
    "facebook",
    "vimeo",
    "general",
  ]);
  assert.deepEqual(format.enum, [
    "mystery_to_model",
    "visual_reveal",
    "challenge",
    "misconception",
    "animated_explainer",
    "classroom_demo",
    "aesthetic_montage",
  ]);
});

test("plan_shots output schema describes the post-processed plan ids", () => {
  const scenes = persistedShotPlanSchema.properties.scenes as {
    items: { properties: Record<string, unknown>; required: string[] };
  };
  const beats = scenes.items.properties.beats as {
    items: { properties: Record<string, unknown>; required: string[] };
  };

  assert.ok(scenes.items.properties.id);
  assert.ok(scenes.items.required.includes("id"));
  assert.ok(beats.items.properties.id);
  assert.ok(beats.items.required.includes("id"));
});

test("plan_shots validates input before reading the brief or calling the agent", async () => {
  let planCalls = 0;
  let briefCalls = 0;
  const registry = createTestToolRegistry({
    planShots: planShotsDeps({
      planEdit: async () => {
        planCalls += 1;
        return samplePlan;
      },
      getActiveProjectBrief: async () => {
        briefCalls += 1;
        return activeBrief;
      },
    }),
  });

  const result = await registry.execute(
    "plan_shots",
    { feedback: 123 },
    { auth, projectId: "proj_1" }
  );

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "invalid_input");
    assert.equal(result.error.recoverable, true);
  }
  assert.equal(planCalls, 0);
  assert.equal(briefCalls, 0);
});

test("plan_shots returns precondition_unmet (suggesting the brief) when none exists", async () => {
  let planCalls = 0;
  const registry = createTestToolRegistry({
    planShots: planShotsDeps({
      getActiveProjectBrief: async () => null,
      planEdit: async () => {
        planCalls += 1;
        return samplePlan;
      },
    }),
  });

  const result = (await registry.execute(
    "plan_shots",
    {},
    { auth, projectId: "proj_1" }
  )) as ToolCallResult<PlanShotsOutput>;

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.recoverable, true);
    assert.equal(
      result.error.unmetRequirements?.[0]?.satisfyWith.tool,
      "create_or_load_brief"
    );
  }
  assert.equal(planCalls, 0, "must not plan without a brief");
});

test("plan_shots derives the plan from the brief and persists it with brief provenance", async () => {
  let planEditInput:
    | {
        goal: string;
        aspectRatio: string;
        narrativeContext?: string | null;
        storyContext?: {
          audience?: string;
          platform?: string;
          format?: string;
          hookQuestion?: string;
          strongestVisual?: string;
          oneBigIdea?: string;
          caveat?: string;
          payoff?: string;
          callToAction?: string;
        } | null;
      }
    | undefined;
  let planInput:
    | {
        plan: ShotPlan;
        briefAssetId?: string;
        briefContentHash?: string;
        storyBlueprintAssetId?: string;
        scriptDraftAssetId?: string;
        groundingInputs?: { assetId: string; role?: string; contentHash?: string }[];
      }
    | undefined;
  const registry = createTestToolRegistry({
    planShots: planShotsDeps({
      getActiveProjectBrief: async () => activeBrief,
      planEdit: async (input) => {
        planEditInput = input;
        return samplePlan;
      },
      addProjectPlan: async (i) => {
        planInput = i;
        return { planAssetId: "plan_asset_1" };
      },
    }),
  });

  const result = (await registry.execute(
    "plan_shots",
    {},
    { auth, projectId: "proj_1" }
  )) as ToolCallResult<PlanShotsOutput>;

  // inputs are derived from the brief, not supplied by the model
  assert.equal(planEditInput?.goal, sampleBrief.goal);
  assert.equal(planEditInput?.aspectRatio, sampleBrief.aspectRatio);
  assert.equal(planEditInput?.storyContext?.audience, sampleBrief.audience);
  assert.equal(planEditInput?.storyContext?.platform, sampleBrief.platform);
  assert.equal(planEditInput?.storyContext?.format, sampleBrief.format);
  assert.equal(planEditInput?.storyContext?.hookQuestion, sampleBrief.hookQuestion);
  assert.equal(
    planEditInput?.storyContext?.strongestVisual,
    sampleBrief.strongestVisual
  );
  assert.equal(planEditInput?.storyContext?.oneBigIdea, sampleBrief.oneBigIdea);
  assert.equal(planEditInput?.storyContext?.caveat, sampleBrief.caveat);
  assert.equal(planEditInput?.storyContext?.payoff, sampleBrief.payoff);
  assert.equal(
    planEditInput?.storyContext?.callToAction,
    sampleBrief.constraints?.callToAction
  );
  // the generated ShotPlan is what gets persisted
  assert.equal(planInput?.plan, samplePlan);
  // the active brief is recorded as the plan's input (provenance / stale graph)
  assert.equal(planInput?.briefAssetId, "brief_asset_1");
  assert.equal(planInput?.briefContentHash, "brief_hash_1");
  assert.equal(planEditInput?.narrativeContext, null);
  assert.equal(planInput?.storyBlueprintAssetId, undefined);
  assert.equal(planInput?.scriptDraftAssetId, undefined);
  assert.deepEqual(planInput?.groundingInputs, []);

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.resourceIds, ["plan_asset_1"]);
    assert.equal(result.output?.planAssetId, "plan_asset_1");
    assert.equal(result.output?.plan.aspectRatio, "16:9");
  }
});

test("plan_shots incorporates and records a matching story blueprint and script", async () => {
  let planEditInput: { narrativeContext?: string | null } | undefined;
  let planInput:
    | {
        storyBlueprintAssetId?: string;
        storyBlueprintContentHash?: string;
        scriptDraftAssetId?: string;
        scriptDraftContentHash?: string;
        groundingInputs?: { position?: number }[];
      }
    | undefined;
  const storyBlueprint = {
    storyBlueprintId: "blueprint_1",
    assetId: "blueprint_asset_1",
    contentHash: "blueprint_hash_1",
    storyBlueprint: {
      premise: "A puppy learns a new trick.",
      logline: "A small leap becomes a big win.",
      ending: "The puppy lands the trick.",
      acts: [{ id: "act_1", title: "Try", purpose: "Set up", summary: "The first attempt fails.", targetDurationSec: 5 }],
      scenes: [{ id: "scene_1", title: "Backyard", summary: "The puppy practices.", actId: "act_1", targetDurationSec: 5 }],
    },
  } as unknown as Awaited<ReturnType<PlanShotsDeps["getActiveProjectStoryBlueprint"]>>;
  const scriptDraft = {
    scriptDraftId: "script_1",
    assetId: "script_asset_1",
    contentHash: "script_hash_1",
    scriptDraft: {
      storyBlueprintId: "blueprint_1",
      scenes: [{ title: "Backyard", narration: "One more try.", dialogue: [{ characterName: "Maya", text: "You can do it." }] }],
    },
  } as unknown as Awaited<ReturnType<PlanShotsDeps["getActiveProjectScriptDraft"]>>;
  const registry = createTestToolRegistry({
    planShots: planShotsDeps({
      getActiveProjectStoryBlueprint: async () => storyBlueprint,
      getActiveProjectScriptDraft: async () => scriptDraft,
      planEdit: async (input) => {
        planEditInput = input;
        return samplePlan;
      },
      addProjectPlan: async (input) => {
        planInput = input;
        return { planAssetId: "plan_asset_1" };
      },
    }),
  });

  const result = await registry.execute("plan_shots", {}, { auth, projectId: "proj_1" });

  assert.match(planEditInput?.narrativeContext ?? "", /A small leap becomes a big win/);
  assert.match(planEditInput?.narrativeContext ?? "", /One more try/);
  assert.match(planEditInput?.narrativeContext ?? "", /Maya: You can do it/);
  assert.equal(planInput?.storyBlueprintAssetId, "blueprint_asset_1");
  assert.equal(planInput?.storyBlueprintContentHash, "blueprint_hash_1");
  assert.equal(planInput?.scriptDraftAssetId, "script_asset_1");
  assert.equal(planInput?.scriptDraftContentHash, "script_hash_1");
  assert.deepEqual(planInput?.groundingInputs, []);
  assert.equal(result.status, "succeeded");
});

test("plan_shots ignores a script from an older blueprint", async () => {
  let planEditInput: { narrativeContext?: string | null } | undefined;
  let planInput: { scriptDraftAssetId?: string } | undefined;
  const storyBlueprint = {
    storyBlueprintId: "blueprint_current",
    assetId: "blueprint_asset_1",
    contentHash: "blueprint_hash_1",
    storyBlueprint: {
      premise: "Current premise.", logline: "Current logline.", ending: "Current ending.", acts: [], scenes: [],
    },
  } as unknown as Awaited<ReturnType<PlanShotsDeps["getActiveProjectStoryBlueprint"]>>;
  const olderScript = {
    scriptDraftId: "script_old", assetId: "script_asset_old", contentHash: "script_hash_old",
    scriptDraft: { storyBlueprintId: "blueprint_old", scenes: [{ title: "Old scene", narration: "Do not use this.", dialogue: [] }] },
  } as unknown as Awaited<ReturnType<PlanShotsDeps["getActiveProjectScriptDraft"]>>;
  const registry = createTestToolRegistry({
    planShots: planShotsDeps({
      getActiveProjectStoryBlueprint: async () => storyBlueprint,
      getActiveProjectScriptDraft: async () => olderScript,
      planEdit: async (input) => { planEditInput = input; return samplePlan; },
      addProjectPlan: async (input) => { planInput = input; return { planAssetId: "plan_asset_1" }; },
    }),
  });

  await registry.execute("plan_shots", {}, { auth, projectId: "proj_1" });

  assert.match(planEditInput?.narrativeContext ?? "", /Current logline/);
  assert.doesNotMatch(planEditInput?.narrativeContext ?? "", /Do not use this/);
  assert.equal(planInput?.scriptDraftAssetId, undefined);
});

test("plan_shots forwards transcript and moment grounding into the planner prompt", async () => {
  let footageGrounding: string | null | undefined;
  let groundingInputs: unknown;
  const registry = createTestToolRegistry({
    planShots: planShotsDeps({
      planEdit: async (input) => {
        footageGrounding = input.footageGrounding;
        return {
          ...samplePlan,
          scenes: [
            {
              ...samplePlan.scenes[0],
              beats: [
                {
                  ...samplePlan.scenes[0].beats[0],
                  sourceWindow: {
                    assetId: "clip_asset_1",
                    startSec: 1,
                    endSec: 4,
                    label: "birthday candle",
                  },
                },
              ],
            },
          ],
        };
      },
      addProjectPlan: async (input) => {
        groundingInputs = input.groundingInputs;
        return { planAssetId: "plan_asset_1" };
      },
      buildFootageGroundingContext: async () => ({
        excerpts: [
          {
            assetId: "clip_asset_1",
            contentHash: "clip_hash_1",
            label: "birthday.mov",
            transcript: "Maya says happy birthday",
            moments: [{ startSec: 1, endSec: 4, label: "birthday candle" }],
          },
        ],
        promptText:
          "Footage grounding from uploaded assets:\n- birthday.mov transcript: Maya says happy birthday\nmoment 1.00-4.00s: birthday candle",
      }),
    }),
  });

  const result = (await registry.execute(
    "plan_shots",
    {},
    { auth, projectId: "proj_1" }
  )) as ToolCallResult<PlanShotsOutput>;

  assert.match(footageGrounding ?? "", /Maya says happy birthday/);
  assert.match(footageGrounding ?? "", /1\.00-4\.00s/);
  assert.deepEqual(groundingInputs, [
    {
      assetId: "clip_asset_1",
      relation: "input",
      role: "footage_grounding",
      position: 1,
      contentHash: "clip_hash_1",
    },
  ]);
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.output?.plan.scenes[0].beats[0].sourceWindow, {
      assetId: "clip_asset_1",
      startSec: 1,
      endSec: 4,
      label: "birthday candle",
    });
  }
});

test("registry parses input before running cost estimate hook", async () => {
  const registry = createTestToolRegistry({ planShots: planShotsDeps() });

  const estimate = await registry.estimateCost(
    "plan_shots",
    {},
    { auth, projectId: "proj_1" }
  );

  assert.equal(estimate.estimatedCostUsd, 0);
  assert.equal(estimate.unit, "model_call");
});

test("default registry exposes assemble_timeline metadata", () => {
  const registry = createTestToolRegistry({
    assembleTimeline: {
      getActiveProjectPlan: async () => null,
    },
  });
  const definition = registry.get("assemble_timeline");

  assert.equal(definition.name, "assemble_timeline");
  assert.equal(definition.execution, "sync");
  assert.equal(definition.inputSchema.additionalProperties, false);
  assert.equal(definition.outputSchema.type, "object");
});

test("assemble_timeline validates input before reading graph state", async () => {
  let planReads = 0;
  const registry = new ToolRegistry();
  registry.register(
    createAssembleTimelineTool({
      getActiveProjectPlan: async () => {
        planReads += 1;
        return null;
      },
    })
  );

  const result = await registry.execute(
    "assemble_timeline",
    { unsupported: true },
    { auth, projectId: "proj_1" }
  );

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "invalid_input");
  }
  assert.equal(planReads, 0);
});

test("assemble_timeline requires selected beat clips", async () => {
  const registry = new ToolRegistry();
  registry.register(
    createAssembleTimelineTool({
      getActiveProjectPlan: async () => ({
        plan: samplePlan,
        assetId: "plan_asset_1",
        contentHash: "plan_hash_1",
      }),
      listActiveProjectAssetSelections: async () => [],
      listAssets: async () => ({ items: [], nextCursor: null }),
    })
  );

  const result = await registry.execute("assemble_timeline", {}, { auth, projectId: "proj_1" });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "generate_clip");
  }
});

test("assemble_timeline persists a timeline asset with plan and clip provenance", async () => {
  let selectedClipDescription = "";
  let timelineInput:
    | {
        graphInputs: { assetId: string; role?: string; contentHash?: string }[];
      }
    | undefined;
  let actionOutputIds: string[] | undefined;
  const registry = new ToolRegistry();
  registry.register(
    createAssembleTimelineTool({
      getActiveProjectPlan: async () => ({
        plan: samplePlan,
        assetId: "plan_asset_1",
        contentHash: "plan_hash_1",
      }),
      listActiveProjectAssetSelections: async () => [
        { slotRole: "beat_clip:beat_1", asset: sampleVideoAsset },
      ],
      listAssets: async () => ({ items: [], nextCursor: null }),
      selectClips: async ({ plan, clips }) => {
        selectedClipDescription = clips[0]?.description ?? "";
        return {
          aspectRatio: plan.aspectRatio,
          fps: 30,
          segments: [
            {
              id: "seg_1",
              clipId: clips[0].id,
              sourceInSec: 0,
              sourceOutSec: 4,
              role: "Hook",
              beatId: "beat_1",
              reason: "best clip",
            },
          ],
        };
      },
      createAction: async () =>
        ({
          id: "action_1",
          schemaVersion: "action.v1",
          projectId: "proj_1",
          tool: "assemble_timeline",
          status: "running",
          params: {},
          inputAssetIds: [],
          jobIds: [],
          outputAssetIds: [],
          createdAt: "",
          updatedAt: "",
        }) as V1Action,
      updateAction: async (_id, patch) => {
        actionOutputIds = patch.outputAssetIds;
        return {} as V1Action;
      },
      addProjectTimeline: async (input) => {
        timelineInput = input;
        return { timelineAssetId: "timeline_asset_1" };
      },
    })
  );

  const result = await registry.execute("assemble_timeline", {}, { auth, projectId: "proj_1" });

  assert.equal(result.status, "succeeded");
  assert.match(selectedClipDescription, /role=beat_clip/);
  assert.deepEqual(
    timelineInput?.graphInputs.map((input) => input.assetId),
    ["plan_asset_1", "clip_asset_1"]
  );
  assert.deepEqual(
    timelineInput?.graphInputs.map((input) => input.contentHash),
    ["plan_hash_1", "clip_hash_1"]
  );
  assert.deepEqual(actionOutputIds, ["timeline_asset_1"]);
});

test("assemble_timeline scopes uploaded-footage runs to selected assets and preserves order", async () => {
  let selectorClipIds: string[] = [];
  let persistedSegmentClipIds: string[] = [];
  let timelineInput:
    | {
        graphInputs: { assetId: string; role?: string; contentHash?: string }[];
      }
    | undefined;
  const uploads = ["upload_1", "upload_2", "upload_3", "upload_4", "upload_5", "upload_6"].map(
    uploadAsset
  );
  const soundtrack = audioAsset("audio_soundtrack", "soundtrack");
  const registry = new ToolRegistry();
  registry.register(
    createAssembleTimelineTool({
      getActiveProjectPlan: async () => ({
        plan: samplePlan,
        assetId: "plan_asset_1",
        contentHash: "plan_hash_1",
      }),
      listActiveProjectAssetSelections: async () => [],
      listAssets: async () => ({ items: [...uploads, soundtrack], nextCursor: null }),
      selectClips: async ({ plan, clips }) => {
        selectorClipIds = clips.map((clip) => clip.id);
        const visualClips = clips.filter((clip) => clip.kind !== "audio");
        return {
          aspectRatio: plan.aspectRatio,
          fps: 30,
          segments: [...visualClips].reverse().map((clip, index) => ({
            id: `seg_${index + 1}`,
            clipId: clip.id,
            sourceInSec: 0,
            sourceOutSec: 2,
            role: "Hook",
            beatId: "beat_1",
            reason: `select ${clip.id}`,
          })),
        };
      },
      createAction: async () =>
        ({
          id: "action_1",
          schemaVersion: "action.v1",
          projectId: "proj_1",
          tool: "assemble_timeline",
          status: "running",
          params: {},
          inputAssetIds: [],
          jobIds: [],
          outputAssetIds: [],
          createdAt: "",
          updatedAt: "",
        }) as V1Action,
      updateAction: async () => ({}) as V1Action,
      addProjectTimeline: async (input) => {
        timelineInput = input;
        persistedSegmentClipIds = input.timeline.segments.map((segment) => segment.clipId);
        return { timelineAssetId: "timeline_asset_1" };
      },
    })
  );

  const selectedAssetIds = ["upload_5", "upload_2", "upload_4"];
  const result = await registry.execute(
    "assemble_timeline",
    {},
    {
      auth,
      projectId: "proj_1",
      metadata: { entrypoint: "uploaded-footage", assetIds: selectedAssetIds },
    }
  );

  assert.equal(result.status, "succeeded");
  assert.deepEqual(selectorClipIds, [...selectedAssetIds, "audio_soundtrack"]);
  assert.deepEqual(persistedSegmentClipIds, selectedAssetIds);
  assert.deepEqual(
    timelineInput?.graphInputs.map((input) => input.assetId),
    ["plan_asset_1", ...selectedAssetIds, "audio_soundtrack"]
  );
  assert.deepEqual(
    timelineInput?.graphInputs.map((input) => input.role),
    ["plan", "upload", "upload", "upload", "soundtrack"]
  );
});
