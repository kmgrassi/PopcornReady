import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { ActiveAssetSelection, ActiveProjectPlan, V1Asset } from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import { createPlanTransitionsTool } from "../plan-transitions";

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
      name: "Cafe",
      beats: [
        { id: "plan_beat_1", name: "Hook", durationSec: 5, intent: "Maya opens the cafe." },
      ],
    },
    {
      id: "scene_2",
      name: "Street",
      beats: [
        { id: "plan_beat_2", name: "Turn", durationSec: 7, intent: "She steps outside." },
      ],
    },
  ],
};

const activePlan: ActiveProjectPlan = {
  plan,
  assetId: "plan_asset_1",
  contentHash: "plan_hash",
};

const storyboard: ProjectStoryboard = {
  id: "storyboard_1",
  projectId: "proj_1",
  planAssetId: "plan_asset_1",
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
          status: "ready",
          beatAssetId: null,
          panels: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    {
      id: "sb_scene_2",
      projectId: "proj_1",
      storyboardId: "storyboard_1",
      sceneIndex: 1,
      title: "Street",
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
          id: "sb_beat_2",
          projectId: "proj_1",
          sceneId: "sb_scene_2",
          beatIndex: 0,
          intent: "She steps outside.",
          visualDescription: null,
          dialogueSummary: null,
          narration: null,
          durationSec: 7,
          status: "ready",
          beatAssetId: null,
          panels: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  ],
};

function asset(id: string): V1Asset {
  return {
    id,
    schemaVersion: "asset.v1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    kind: "video",
    role: "beat_clip",
    filename: `${id}.mp4`,
    status: "ready",
    source: { type: "generated", generatedAssetId: id },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function selection(beatId: string, assetId: string): ActiveAssetSelection {
  return {
    slotRole: `beat_clip:${beatId}`,
    asset: asset(assetId),
  };
}

test("plan_transitions resolves beat clips with plan beat ids when storyboard ids differ", async () => {
  const writes: Array<{
    fromBeatId: string;
    fromClipAssetId: string;
    toClipAssetId?: string | null;
  }> = [];
  const tool = createPlanTransitionsTool({
    getActiveProjectPlan: async () => activePlan,
    getProjectStoryboard: async () => storyboard,
    listActiveProjectAssetSelections: async (input) => {
      assert.deepEqual(input.slotRoles, ["beat_clip:plan_beat_1", "beat_clip:plan_beat_2"]);
      return [selection("plan_beat_1", "clip_1"), selection("plan_beat_2", "clip_2")];
    },
    insertProjectTransition: async (input) => {
      writes.push(input);
      return { transitionAssetId: "transition_1" };
    },
  });

  const result = await tool.execute({}, { auth, projectId: "proj_1" });

  assert.equal(result.status, "succeeded");
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.fromBeatId, "plan_beat_1");
  assert.equal(writes[0]?.fromClipAssetId, "clip_1");
  assert.equal(writes[0]?.toClipAssetId, "clip_2");
});

test("plan_transitions requires the to-beat clip before writing a transition", async () => {
  const tool = createPlanTransitionsTool({
    getActiveProjectPlan: async () => activePlan,
    getProjectStoryboard: async () => storyboard,
    listActiveProjectAssetSelections: async () => [selection("plan_beat_1", "clip_1")],
    insertProjectTransition: async () => {
      throw new Error("must not write a transition without both endpoint clips");
    },
  });

  const result = await tool.execute({}, { auth, projectId: "proj_1" });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.suggestedNextTools?.[0]?.tool, "generate_clip");
  }
});
