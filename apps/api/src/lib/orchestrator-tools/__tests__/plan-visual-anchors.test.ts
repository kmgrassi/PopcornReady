import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { VisualAnchorPlan } from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import {
  createPlanVisualAnchorsTool,
  deriveVisualAnchorPlan,
  deriveVisualAnchorPlanFromStoryboard,
  type PlanVisualAnchorsOutput,
} from "../plan-visual-anchors";
import { ToolRegistry } from "../registry";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const samplePlan: ShotPlan = {
  targetLengthSec: 20,
  style: "warm documentary",
  aspectRatio: "16:9",
  scenes: [
    {
      id: "scene_1",
      name: "Cafe opening",
      setting: "sunny neighborhood cafe",
      mood: "welcoming",
      characterIds: ["barista_maya"],
      beats: [
        { id: "beat_1", name: "Hook", durationSec: 5, intent: "Maya opens the cafe." },
        { id: "beat_2", name: "Payoff", durationSec: 6, intent: "Regulars gather at the counter." },
      ],
    },
  ],
};

const activePlan = {
  plan: samplePlan,
  assetId: "plan_asset_1",
  contentHash: "plan_hash_1",
};

test("deriveVisualAnchorPlan extracts character and location anchors from the plan", () => {
  const plan = deriveVisualAnchorPlan(samplePlan);

  assert.equal(plan.schemaVersion, "visual_anchor_plan.v1");
  assert.deepEqual(
    plan.anchors.map((anchor) => anchor.id).sort(),
    ["character_barista_maya", "location_sunny_neighborhood_cafe"]
  );
  assert.deepEqual(plan.anchors[0].sourceBeatIds, ["beat_1", "beat_2"]);
});

test("deriveVisualAnchorPlanFromStoryboard extracts location anchors from persisted beats", () => {
  const plan = deriveVisualAnchorPlanFromStoryboard(
    {
      id: "story_1",
      projectId: "proj_1",
      planAssetId: null,
      status: "ready",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      scenes: [
        {
          id: "scene_row_1",
          projectId: "proj_1",
          storyboardId: "story_1",
          sceneIndex: 0,
          title: "Cafe opening",
          summary: "Maya opens the cafe.",
          setting: "sunny neighborhood cafe",
          mood: "welcoming",
          durationSec: 10,
          sceneAssetId: null,
          status: "ready",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          beats: [
            {
              id: "beat_row_1",
              projectId: "proj_1",
              sceneId: "scene_row_1",
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
              panels: [],
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
            },
          ],
        },
      ],
    },
    "warm documentary"
  );

  assert.deepEqual(plan.anchors.map((anchor) => anchor.id), [
    "location_sunny_neighborhood_cafe",
  ]);
  assert.deepEqual(plan.anchors[0]?.sourceSceneIds, ["scene_row_1"]);
  assert.deepEqual(plan.anchors[0]?.sourceBeatIds, ["beat_row_1"]);
});

test("plan_visual_anchors validates input before reading the plan", async () => {
  let readPlan = false;
  const registry = new ToolRegistry();
  registry.register(createPlanVisualAnchorsTool({
    getActiveProjectPlan: async () => {
      readPlan = true;
      return activePlan;
    },
    addProjectVisualAnchorPlan: async () => ({ visualAnchorPlanAssetId: "anchors_1" }),
  }));

  const result = await registry.execute(
    "plan_visual_anchors",
    { unexpected: true },
    { auth, projectId: "proj_1" }
  );

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "invalid_input");
  }
  assert.equal(readPlan, false);
});

test("plan_visual_anchors requires a shot plan and suggests plan_shots", async () => {
  const tool = createPlanVisualAnchorsTool({
    getActiveProjectPlan: async () => null,
    addProjectVisualAnchorPlan: async () => {
      throw new Error("must not persist without a plan");
    },
  });

  const result = await tool.execute({}, { auth, projectId: "proj_1" });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "plan_shots");
  }
});

test("plan_visual_anchors accepts approval retry revisionInstruction", async () => {
  const noAnchorPlan: ShotPlan = {
    targetLengthSec: 12,
    style: "warm documentary",
    aspectRatio: "16:9",
    scenes: [
      {
        id: "scene_1",
        name: "Morning texture",
        beats: [{ id: "beat_1", name: "Hook", durationSec: 5, intent: "Show morning light." }],
      },
    ],
  };
  let persisted:
    | {
        visualAnchorPlan: VisualAnchorPlan;
      }
    | undefined;
  const tool = createPlanVisualAnchorsTool({
    getActiveProjectPlan: async () => ({
      ...activePlan,
      plan: noAnchorPlan,
    }),
    getProjectStoryboard: async () => null,
    addProjectVisualAnchorPlan: async (input) => {
      persisted = input;
      return { visualAnchorPlanAssetId: "anchors_1" };
    },
  });
  const registry = new ToolRegistry();
  registry.register(tool);

  const result = await registry.execute(
    "plan_visual_anchors",
    { revisionInstruction: "Lean into the cafe regulars." },
    { auth, projectId: "proj_1" }
  );

  assert.equal(result.status, "succeeded");
  assert.match(persisted?.visualAnchorPlan.anchors[0]?.description ?? "", /cafe regulars/);
});

test("plan_visual_anchors persists a typed anchor plan with plan provenance", async () => {
  let persisted:
    | {
        visualAnchorPlan: VisualAnchorPlan;
        planAssetId: string;
        planContentHash: string;
      }
    | undefined;
  const tool = createPlanVisualAnchorsTool({
    getActiveProjectPlan: async () => activePlan,
    getProjectStoryboard: async () => null,
    addProjectVisualAnchorPlan: async (input) => {
      persisted = input;
      return { visualAnchorPlanAssetId: "anchors_1" };
    },
  });

  const result = (await tool.execute(
    {},
    { auth, projectId: "proj_1" }
  )) as ToolCallResult<PlanVisualAnchorsOutput>;

  assert.equal(persisted?.planAssetId, "plan_asset_1");
  assert.equal(persisted?.planContentHash, "plan_hash_1");
  assert.equal(persisted?.visualAnchorPlan.schemaVersion, "visual_anchor_plan.v1");
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.resourceIds, ["anchors_1"]);
    assert.equal(result.output?.visualAnchorPlanAssetId, "anchors_1");
  }
});
