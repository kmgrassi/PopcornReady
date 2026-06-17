import {
  addStoryboardTiles,
  addProjectBrief,
  addProjectPlan,
  addProjectVisualAnchorPlan,
  getActiveProjectBrief,
} from "@/lib/api/v1/store";
import { buildStoryboardForPlan } from "@/lib/api/v1/storyboards";
import type { Asset } from "@popcorn/shared/assets/types";
import type { ToolBattery } from "../types";

async function seedPlan(sandbox: { workspaceId: string; projectId: string }) {
  const plan = {
    targetLengthSec: 10,
    style: "warm documentary",
    aspectRatio: "16:9" as const,
    scenes: [
      {
        id: "scene_1",
        name: "Cafe opening",
        setting: "sunny neighborhood cafe",
        mood: "welcoming",
        characterIds: ["barista_maya"],
        beats: [
          { id: "beat_1", name: "Hook", durationSec: 5, intent: "Maya opens the cafe." },
          {
            id: "beat_2",
            name: "Payoff",
            durationSec: 5,
            intent: "Regulars gather at the counter.",
          },
        ],
      },
    ],
  };
  await addProjectBrief({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    brief: {
      goal: "A neighborhood cafe opens for a warm morning rush.",
      targetLengthSec: 10,
      aspectRatio: "16:9",
      style: "warm documentary",
    },
  });
  const brief = await getActiveProjectBrief(sandbox.projectId);
  const { planAssetId } = await addProjectPlan({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    ...(brief ? { briefAssetId: brief.assetId, briefContentHash: brief.contentHash } : {}),
    plan,
  });
  return { planAssetId, plan };
}

async function seedStoryboard(sandbox: { workspaceId: string; projectId: string }) {
  const { planAssetId, plan } = await seedPlan(sandbox);
  const tiles: Asset[] = plan.scenes[0].beats.map((beat) => ({
    id: `${beat.id}_tile`,
    schemaVersion: "asset.v1",
    projectId: sandbox.projectId,
    kind: "image",
    role: "beat_storyboard",
    depicts: { beatId: beat.id },
    description: beat.intent,
    media: {
      url: `/generated/${beat.id}_tile.png`,
      filename: `${beat.id}_tile.png`,
      durationSec: 4,
    },
    provenance: { provider: "mock", prompt: beat.intent },
    source: "generated",
  }));
  const persisted = await addStoryboardTiles({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    planAssetId,
    planContentHash: "",
    tiles,
  });
  await buildStoryboardForPlan({
    auth: {
      mode: "local",
      actor: { id: "tool_test", type: "local" },
      workspaceId: sandbox.workspaceId,
      isLocal: true,
    },
    projectId: sandbox.projectId,
    planAssetId,
    plan,
    tileAssetByBeatId: new Map(persisted.map((tile) => [tile.beatId, tile.assetId])),
  });
  await addProjectVisualAnchorPlan({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    visualAnchorPlan: {
      schemaVersion: "visual_anchor_plan.v1",
      anchors: [
        {
          id: "character_barista_maya",
          kind: "character",
          label: "barista_maya",
          description: "Continuity reference for Maya, the cafe barista in a red apron.",
          sourceSceneIds: ["scene_1"],
          sourceBeatIds: ["beat_1", "beat_2"],
        },
      ],
    },
    planAssetId,
    planContentHash: "",
  });
}

export const generateKeyframeBattery: ToolBattery = {
  tool: "generate_keyframe",
  cases: [
    {
      name: "requires a shot plan before generating keyframes",
      instruction: "Generate photoreal keyframes for this project's beats.",
      expect: { tool: "generate_keyframe", callStatus: "failed" },
      verify: ({ result }) => {
        const failures: string[] = [];
        if (result?.status !== "failed") {
          failures.push(`expected a failed result, got ${result?.status}`);
          return failures;
        }
        if (result.error.kind !== "precondition_unmet") {
          failures.push(`expected precondition_unmet, got ${result.error.kind}`);
        }
        const suggests = (result.error.unmetRequirements ?? []).some(
          (r) => r.satisfyWith.tool === "plan_shots"
        );
        if (!suggests) failures.push("expected the miss to suggest plan_shots");
        return failures;
      },
    },
    {
      name: "generates selected beat keyframes from plan and storyboard",
      instruction:
        "Generate photoreal beat keyframes for this project's storyboard. Use provider mock.",
      setup: async ({ sandbox }) => {
        await seedStoryboard(sandbox);
      },
      expect: {
        tool: "generate_keyframe",
        callStatus: "waiting_for_job",
        input: { provider: "mock" },
      },
      verify: async ({ sandbox, db }) => {
        const failures: string[] = [];
        const { data: keyframes, error: keyframeError } = await db
          .from("assets")
          .select("id, kind, media, role, inputs")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "keyframe")
          .eq("role", "beat_keyframe");
        if (keyframeError) failures.push(`keyframe query failed: ${keyframeError.message}`);
        if ((keyframes ?? []).length < 2) failures.push("expected keyframe per planned beat");

        const { data: selections } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId);
        const slotRoles = new Set((selections ?? []).map((selection) => selection.slot_role));
        if (!slotRoles.has("beat_keyframe:beat_1")) {
          failures.push("missing active keyframe selection for beat_1");
        }
        if (!slotRoles.has("beat_keyframe:beat_2")) {
          failures.push("missing active keyframe selection for beat_2");
        }

        for (const keyframe of keyframes ?? []) {
          const inputs = (keyframe.inputs as Array<{ role?: string }> | null) ?? [];
          const roles = new Set(inputs.map((input) => input.role));
          if (!roles.has("plan")) failures.push(`${keyframe.id} missing plan graph input`);
          if (!roles.has("beat_storyboard")) {
            failures.push(`${keyframe.id} missing storyboard graph input`);
          }
        }

        return failures;
      },
    },
    {
      name: "does not accept unsupported provider values",
      instruction:
        "Generate photoreal beat keyframes, but set provider to exactly banana.",
      setup: async ({ sandbox }) => {
        await seedStoryboard(sandbox);
      },
      expect: {
        tool: "generate_keyframe",
        callStatus: ["waiting_for_job", "failed"],
      },
      verify: ({ actualInput, result }) => {
        const failures: string[] = [];
        const provider = actualInput.provider;
        if (result?.status === "accepted" && provider === "banana") {
          failures.push("unsupported provider banana was accepted");
        }
        return failures;
      },
    },
  ],
};
