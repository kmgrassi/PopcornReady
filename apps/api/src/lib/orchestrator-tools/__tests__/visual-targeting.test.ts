import assert from "node:assert/strict";
import test from "node:test";

import type { ActiveProjectPlan, VisualAnchorPlan } from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import {
  anchorPlanForTargets,
  resolveVisualTargets,
  shotPlanForTargetBeats,
  storyboardForTargetPlanBeats,
} from "../visual-targeting";

const plan = {
  targetLengthSec: 4,
  style: "cinematic",
  aspectRatio: "16:9",
  scenes: [
    {
      id: "plan-scene-1",
      name: "One",
      beats: [
        { id: "plan-beat-1", name: "One", durationSec: 2, intent: "First" },
        { id: "plan-beat-2", name: "Two", durationSec: 2, intent: "Second" },
      ],
    },
  ],
} as ShotPlan;
const activePlan: ActiveProjectPlan = {
  plan,
  assetId: "plan-asset-1",
  contentHash: "plan-hash",
  selectionSeq: 4,
};
const storyboard = {
  id: "storyboard-attempt-1",
  projectId: "project-1",
  planAssetId: "plan-asset-1",
  status: "ready",
  scenes: [{
    id: "rel-scene-a17",
    projectId: "project-1",
    storyboardId: "storyboard-attempt-1",
    sceneIndex: 0,
    beats: [
      { id: "rel-beat-c31", beatIndex: 0, panels: [] },
      { id: "rel-beat-f92", beatIndex: 1, panels: [] },
    ],
  }],
} as unknown as ProjectStoryboard;

test("relational beat ids resolve through storyboard coordinates before plan filtering", async () => {
  const resolved = await resolveVisualTargets({
    activePlan,
    targets: {
      storyboardIds: [],
      sourceStoryboardIds: [storyboard.id],
      sceneIds: [],
      beatIds: ["rel-beat-f92"],
      planBeatIds: [],
    },
    loadStoryboard: async (id) => id === storyboard.id ? storyboard : null,
  });
  assert.deepEqual(resolved?.planBeatIds, ["plan-beat-2"]);
  assert.equal(resolved?.sourceStoryboard?.id, storyboard.id);
  assert.deepEqual(
    shotPlanForTargetBeats(plan, resolved?.planBeatIds).scenes[0]?.beats.map(
      (beat) => beat.id
    ),
    ["plan-beat-2"]
  );
  assert.deepEqual(
    storyboardForTargetPlanBeats(
      plan,
      storyboard,
      resolved?.planBeatIds
    ).scenes[0]?.beats.map((beat) => beat.id),
    ["rel-beat-f92"]
  );
});

test("scene and selection-derived targets retain separate id namespaces", async () => {
  const resolved = await resolveVisualTargets({
    activePlan,
    targets: {
      storyboardIds: [],
      sourceStoryboardIds: [storyboard.id],
      sceneIds: ["rel-scene-a17"],
      beatIds: [],
      planBeatIds: ["plan-beat-2"],
    },
    loadStoryboard: async () => storyboard,
  });
  assert.deepEqual(resolved?.planBeatIds, ["plan-beat-2", "plan-beat-1"]);
  assert.deepEqual(resolved?.planSceneIds, ["plan-scene-1"]);
});

test("an explicit zero-beat scene target stays empty instead of widening to the full plan", async () => {
  const emptyScenePlan = {
    ...plan,
    scenes: [
      ...plan.scenes,
      { id: "plan-scene-empty", name: "Empty", beats: [] },
    ],
  };
  const emptySceneStoryboard = {
    ...storyboard,
    scenes: [
      ...storyboard.scenes,
      {
        ...storyboard.scenes[0],
        id: "rel-scene-empty",
        sceneIndex: 1,
        beats: [],
      },
    ],
  };
  const resolved = await resolveVisualTargets({
    activePlan: {
      ...activePlan,
      plan: emptyScenePlan,
    },
    targets: {
      storyboardIds: [],
      sourceStoryboardIds: [emptySceneStoryboard.id],
      sceneIds: ["rel-scene-empty"],
      beatIds: [],
      planBeatIds: [],
    },
    loadStoryboard: async () => emptySceneStoryboard,
  });

  assert.deepEqual(resolved?.planBeatIds, []);
  assert.deepEqual(resolved?.planSceneIds, ["plan-scene-empty"]);
  assert.deepEqual(
    shotPlanForTargetBeats(emptyScenePlan, resolved?.planBeatIds).scenes,
    []
  );
  assert.deepEqual(
    storyboardForTargetPlanBeats(
      emptyScenePlan,
      emptySceneStoryboard,
      resolved?.planBeatIds
    ).scenes,
    []
  );
});

test("targets bound to another plan fail instead of falling back to names", async () => {
  await assert.rejects(
    resolveVisualTargets({
      activePlan,
      targets: {
        storyboardIds: [],
        sourceStoryboardIds: [storyboard.id],
        sceneIds: [],
        beatIds: ["rel-beat-f92"],
        planBeatIds: [],
      },
      loadStoryboard: async () => ({ ...storyboard, planAssetId: "other-plan" }),
    }),
    /not bound to the active shot plan/
  );
});

test("resolved plan ids narrow anchor plans", () => {
  const anchors = {
    schemaVersion: "visual_anchor_plan.v1",
    anchors: [
      {
        id: "anchor-1",
        kind: "character",
        label: "One",
        description: "First",
        sourceSceneIds: ["plan-scene-1"],
        sourceBeatIds: ["plan-beat-1"],
      },
      {
        id: "anchor-2",
        kind: "location",
        label: "Two",
        description: "Second",
        sourceSceneIds: ["plan-scene-2"],
        sourceBeatIds: ["plan-beat-2"],
      },
    ],
  } as VisualAnchorPlan;
  assert.deepEqual(
    anchorPlanForTargets(anchors, ["plan-beat-2"], []).anchors.map(
      (anchor) => anchor.id
    ),
    ["anchor-2"]
  );
});
