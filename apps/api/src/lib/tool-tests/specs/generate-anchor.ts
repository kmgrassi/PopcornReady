import {
  addProjectBrief,
  addProjectPlan,
  addProjectVisualAnchorPlan,
  getActiveProjectBrief,
} from "@/lib/api/v1/store";
import type { ToolBattery } from "../types";

async function seedVisualAnchorPlan(sandbox: { workspaceId: string; projectId: string }) {
  await addProjectBrief({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    brief: {
      goal: "A neighborhood cafe opens for a warm morning rush.",
      targetLengthSec: 20,
      aspectRatio: "16:9",
      style: "warm documentary",
    },
  });
  const brief = await getActiveProjectBrief(sandbox.projectId);
  const { planAssetId } = await addProjectPlan({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    ...(brief ? { briefAssetId: brief.assetId, briefContentHash: brief.contentHash } : {}),
    plan: {
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
            {
              id: "beat_2",
              name: "Payoff",
              durationSec: 6,
              intent: "Regulars gather at the counter.",
            },
          ],
        },
      ],
    },
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
        {
          id: "location_sunny_neighborhood_cafe",
          kind: "location",
          label: "sunny neighborhood cafe",
          description: "Warm cafe interior with a bright counter and regulars gathering.",
          sourceSceneIds: ["scene_1"],
          sourceBeatIds: ["beat_1", "beat_2"],
        },
      ],
    },
    planAssetId,
    planContentHash: brief?.contentHash ?? "",
  });
}

export const generateAnchorBattery: ToolBattery = {
  tool: "generate_anchor",
  cases: [
    {
      name: "requires a visual anchor plan before generating anchors",
      instruction: "Generate the reusable visual anchors for this project.",
      expect: { tool: "generate_anchor", callStatus: "failed" },
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
          (r) => r.satisfyWith.tool === "plan_visual_anchors"
        );
        if (!suggests) failures.push("expected the miss to suggest plan_visual_anchors");
        return failures;
      },
    },
    {
      name: "generates pooled anchors from the active visual anchor plan",
      instruction:
        "Generate the reusable visual anchors for this project's visual anchor plan. " +
        "Use provider mock.",
      setup: async ({ sandbox }) => {
        await seedVisualAnchorPlan(sandbox);
      },
      expect: {
        tool: "generate_anchor",
        callStatus: "waiting_for_job",
        input: { provider: "mock" },
      },
      verify: async ({ sandbox, db }) => {
        const failures: string[] = [];

        const { data: anchors, error: anchorError } = await db
          .from("assets")
          .select("id, kind, media, role, inputs")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "anchor")
          .in("role", ["character_anchor", "scene_anchor"]);
        if (anchorError) failures.push(`anchor query failed: ${anchorError.message}`);

        const roles = new Set((anchors ?? []).map((asset) => asset.role));
        if (!roles.has("character_anchor")) failures.push("missing generated character_anchor");
        if (!roles.has("scene_anchor")) failures.push("missing generated scene_anchor");

        const { data: plans } = await db
          .from("assets")
          .select("id")
          .eq("project_id", sandbox.projectId)
          .eq("role", "visual_anchor_plan");
        const planId = plans?.[0]?.id as string | undefined;
        if (planId) {
          for (const anchor of anchors ?? []) {
            const inputs = (anchor.inputs as Array<{ assetId?: string }> | null) ?? [];
            if (!inputs.some((input) => input.assetId === planId)) {
              failures.push(`${anchor.id} inputs do not reference the visual anchor plan`);
            }
          }
          const { data: edges } = await db
            .from("asset_edges")
            .select("from_id, to_id")
            .eq("project_id", sandbox.projectId)
            .eq("to_id", planId);
          if (!edges || edges.length < 2) {
            failures.push("expected asset_edges from generated anchors to visual anchor plan");
          }
        } else {
          failures.push("seed visual anchor plan not found");
        }

        const { data: selections } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId);
        const slotRoles = new Set((selections ?? []).map((selection) => selection.slot_role));
        if (!slotRoles.has("character_anchor:character_barista_maya")) {
          failures.push("missing active character anchor selection");
        }
        if (!slotRoles.has("scene_anchor:location_sunny_neighborhood_cafe")) {
          failures.push("missing active scene anchor selection");
        }

        return failures;
      },
    },
    {
      name: "does not accept unsupported provider values",
      instruction:
        "Generate the reusable visual anchors, but set provider to exactly banana.",
      setup: async ({ sandbox }) => {
        await seedVisualAnchorPlan(sandbox);
      },
      expect: {
        tool: "generate_anchor",
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
