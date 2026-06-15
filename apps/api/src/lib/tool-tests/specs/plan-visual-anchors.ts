import {
  addProjectBrief,
  addProjectPlan,
  getActiveProjectBrief,
} from "@/lib/api/v1/store";
import type { ToolBattery } from "../types";

export const planVisualAnchorsBattery: ToolBattery = {
  tool: "plan_visual_anchors",
  cases: [
    {
      name: "requires a plan before identifying visual anchors",
      instruction: "Identify the visual anchors needed for this project's planned video.",
      expect: { tool: "plan_visual_anchors", callStatus: "failed" },
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
      name: "persists visual anchors from the active plan",
      instruction: "Identify the reusable visual anchors for this project's plan.",
      setup: async ({ sandbox }) => {
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
        await addProjectPlan({
          workspaceId: sandbox.workspaceId,
          projectId: sandbox.projectId,
          ...(brief
            ? { briefAssetId: brief.assetId, briefContentHash: brief.contentHash }
            : {}),
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
      },
      expect: { tool: "plan_visual_anchors", callStatus: "succeeded" },
      verify: async ({ sandbox, db }) => {
        const failures: string[] = [];

        const { data: assets, error: assetError } = await db
          .from("assets")
          .select("id, kind, media, role, content, inputs")
          .eq("project_id", sandbox.projectId)
          .eq("role", "visual_anchor_plan");
        if (assetError) failures.push(`asset query failed: ${assetError.message}`);
        const asset = assets?.[0];
        if (!asset) {
          failures.push("no visual_anchor_plan asset persisted");
        } else {
          if (asset.kind !== "plan") failures.push(`expected kind plan, got ${asset.kind}`);
          if (asset.media !== "data") failures.push(`expected media data, got ${asset.media}`);
          const content = asset.content as {
            schema_version?: string;
            anchors?: Array<{ id?: string; kind?: string }>;
          };
          if (content.schema_version !== "visual_anchor_plan.v1") {
            failures.push(`unexpected content schema ${content.schema_version}`);
          }
          const ids = (content.anchors ?? []).map((anchor) => anchor.id);
          if (!ids.includes("character_barista_maya")) {
            failures.push("missing character anchor for barista_maya");
          }
          if (!ids.includes("location_sunny_neighborhood_cafe")) {
            failures.push("missing location anchor for the cafe setting");
          }
        }

        const { data: selections, error: selError } = await db
          .from("selections")
          .select("id, slot_role")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "visual_anchors");
        if (selError) failures.push(`selection query failed: ${selError.message}`);
        if (!selections || selections.length === 0) {
          failures.push("no active visual_anchors selection was set");
        }

        const { data: plans } = await db
          .from("assets")
          .select("id")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "plan")
          .eq("role", "current_plan");
        const planId = plans?.[0]?.id as string | undefined;
        if (asset && planId) {
          const inputs = (asset.inputs as Array<{ assetId?: string }> | null) ?? [];
          if (!inputs.some((input) => input.assetId === planId)) {
            failures.push("visual anchor plan inputs do not reference the shot plan asset");
          }
          const { data: edges } = await db
            .from("asset_edges")
            .select("from_id, to_id")
            .eq("project_id", sandbox.projectId)
            .eq("from_id", asset.id)
            .eq("to_id", planId);
          if (!edges || edges.length === 0) {
            failures.push("no asset_edge visual-anchor-plan -> plan");
          }
        } else if (asset && !planId) {
          failures.push("seed shot plan not found for provenance check");
        }

        return failures;
      },
    },
  ],
};
