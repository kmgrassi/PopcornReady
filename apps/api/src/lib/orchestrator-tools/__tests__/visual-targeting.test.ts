import assert from "node:assert/strict";
import test from "node:test";

import type { ShotPlan } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import type { VisualAnchorPlan } from "@/lib/api/v1/store";
import {
  anchorPlanForTargets,
  shotPlanForTargetBeats,
  storyboardForTargetBeats,
} from "../visual-targeting";

const plan = {
  targetLengthSec: 4,
  style: "cinematic",
  aspectRatio: "16:9",
  scenes: [
    {
      id: "scene-1",
      name: "One",
      beats: [
        { id: "beat-1", name: "One", durationSec: 2, intent: "First" },
        { id: "beat-2", name: "Two", durationSec: 2, intent: "Second" },
      ],
    },
  ],
} as ShotPlan;

test("trusted beat filters narrow plans, storyboards, and anchor plans", () => {
  assert.deepEqual(
    shotPlanForTargetBeats(plan, ["beat-2"]).scenes[0]?.beats.map((beat) => beat.id),
    ["beat-2"]
  );
  const storyboard = {
    id: "storyboard-1",
    projectId: "project-1",
    planAssetId: "plan-1",
    status: "ready",
    scenes: [{
      id: "scene-1",
      projectId: "project-1",
      storyboardId: "storyboard-1",
      sceneIndex: 0,
      beats: [
        { id: "beat-1", panels: [] },
        { id: "beat-2", panels: [] },
      ],
    }],
  } as unknown as ProjectStoryboard;
  assert.deepEqual(
    storyboardForTargetBeats(storyboard, ["beat-2"]).scenes[0]?.beats.map(
      (beat) => beat.id
    ),
    ["beat-2"]
  );
  const anchors = {
    schemaVersion: "visual_anchor_plan.v1",
    anchors: [
      {
        id: "anchor-1",
        kind: "character",
        label: "One",
        description: "First",
        sourceSceneIds: ["scene-1"],
        sourceBeatIds: ["beat-1"],
      },
      {
        id: "anchor-2",
        kind: "location",
        label: "Two",
        description: "Second",
        sourceSceneIds: ["scene-2"],
        sourceBeatIds: ["beat-2"],
      },
    ],
  } as VisualAnchorPlan;
  assert.deepEqual(
    anchorPlanForTargets(anchors, ["beat-2"], []).anchors.map(
      (anchor) => anchor.id
    ),
    ["anchor-2"]
  );
});
