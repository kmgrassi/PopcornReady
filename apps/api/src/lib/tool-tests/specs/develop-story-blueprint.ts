import { addProjectBrief } from "@/lib/api/v1/store";
import type { ToolBattery } from "../types";

export const developStoryBlueprintBattery: ToolBattery = {
  tool: "develop_story_blueprint",
  cases: [
    {
      name: "requires a brief before developing the story blueprint",
      instruction: "Develop a story blueprint for this project.",
      expect: {
        tool: "develop_story_blueprint",
        callStatus: "failed",
      },
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
          (r) => r.satisfyWith.tool === "create_or_load_brief"
        );
        if (!suggests) failures.push("expected the miss to suggest create_or_load_brief");
        return failures;
      },
    },
    {
      name: "develops and persists a story blueprint from the brief",
      instruction:
        "Develop the story blueprint for a 30-second brand video about a cozy neighborhood coffee shop.",
      setup: async ({ sandbox }) => {
        await addProjectBrief({
          workspaceId: sandbox.workspaceId,
          projectId: sandbox.projectId,
          brief: {
            goal: "Introduce a cozy neighborhood coffee shop and its morning regulars.",
            targetLengthSec: 30,
            aspectRatio: "9:16",
            style: "warm, intimate, lightly funny",
          },
        });
      },
      expect: {
        tool: "develop_story_blueprint",
        callStatus: "succeeded",
      },
      verify: async ({ sandbox, db }) => {
        const failures: string[] = [];

        const { data: rows, error: rowError } = await db
          .from("story_blueprints")
          .select("id, asset_id, brief_asset_id, snapshot")
          .eq("project_id", sandbox.projectId);
        if (rowError) failures.push(`story_blueprints query failed: ${rowError.message}`);
        const blueprint = rows?.[0];
        if (!blueprint) {
          failures.push("no story_blueprints row persisted for the sandbox project");
        } else if (
          (blueprint.snapshot as { schema_version?: string }).schema_version !==
          "storyBlueprint.v1"
        ) {
          failures.push("story blueprint snapshot missing schema_version marker");
        }

        const { data: assets, error: assetError } = await db
          .from("assets")
          .select("id, kind, media, inputs")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "story_blueprint");
        if (assetError) failures.push(`asset query failed: ${assetError.message}`);
        const asset = assets?.[0];
        if (!asset) {
          failures.push("no story_blueprint asset persisted");
        } else if (asset.media !== "data") {
          failures.push(`story_blueprint asset media expected "data", got "${asset.media}"`);
        }

        if (blueprint) {
          const [
            { data: characters, error: charactersError },
            { data: acts, error: actsError },
            { data: scenes, error: scenesError },
          ] = await Promise.all([
            db
              .from("story_blueprint_characters")
              .select("id, stable_id")
              .eq("story_blueprint_id", blueprint.id),
            db
              .from("story_blueprint_acts")
              .select("id, stable_id, target_duration_sec")
              .eq("story_blueprint_id", blueprint.id),
            db
              .from("story_blueprint_scenes")
              .select("id, stable_id, story_blueprint_act_id, target_duration_sec")
              .eq("story_blueprint_id", blueprint.id),
          ]);
          if (charactersError) {
            failures.push(`story_blueprint_characters query failed: ${charactersError.message}`);
          }
          if (actsError) failures.push(`story_blueprint_acts query failed: ${actsError.message}`);
          if (scenesError) {
            failures.push(`story_blueprint_scenes query failed: ${scenesError.message}`);
          }
          if (!characters || characters.length === 0) {
            failures.push("no relational story_blueprint_characters rows persisted");
          }
          if (!acts || acts.length !== 3) {
            failures.push(`expected 3 relational story_blueprint_acts rows, got ${acts?.length ?? 0}`);
          }
          if (!scenes || scenes.length !== 3) {
            failures.push(`expected 3 relational story_blueprint_scenes rows, got ${scenes?.length ?? 0}`);
          }
          const actIds = new Set((acts ?? []).map((act) => act.id));
          for (const scene of scenes ?? []) {
            if (!actIds.has(scene.story_blueprint_act_id)) {
              failures.push(`scene ${scene.stable_id} does not point at a persisted act row`);
            }
          }
        }

        const { data: briefs } = await db
          .from("assets")
          .select("id")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "brief");
        const briefId = briefs?.[0]?.id as string | undefined;
        if (asset && briefId) {
          const inputs = (asset.inputs as Array<{ assetId?: string }> | null) ?? [];
          if (!inputs.some((input) => input.assetId === briefId)) {
            failures.push("story_blueprint asset inputs do not reference the brief asset");
          }
          const { data: edges } = await db
            .from("asset_edges")
            .select("from_id, to_id")
            .eq("project_id", sandbox.projectId)
            .eq("from_id", asset.id)
            .eq("to_id", briefId);
          if (!edges || edges.length === 0) {
            failures.push("no asset_edge story_blueprint -> brief");
          }
        } else if (asset && !briefId) {
          failures.push("seed brief not found for provenance check");
        }

        const { data: selections } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "story_blueprint");
        if (!selections || selections.length === 0) {
          failures.push("no active story_blueprint selection was set");
        }

        const { data: project, error: projectError } = await db
          .from("projects")
          .select("current_story_blueprint_id")
          .eq("id", sandbox.projectId)
          .single();
        if (projectError) failures.push(`project query failed: ${projectError.message}`);
        if (blueprint && project?.current_story_blueprint_id !== (blueprint.id as string)) {
          failures.push("project current_story_blueprint_id does not point to the row");
        }

        return failures;
      },
    },
    {
      name: "rejects malformed input before writing",
      instruction:
        "Develop the story blueprint, but set feedback to the number 12 instead of text.",
      setup: async ({ sandbox }) => {
        await addProjectBrief({
          workspaceId: sandbox.workspaceId,
          projectId: sandbox.projectId,
          brief: {
            goal: "A crisp product explainer for a calendar app.",
            targetLengthSec: 20,
            aspectRatio: "16:9",
            style: "clean, calm",
          },
        });
      },
      expect: {
        tool: "develop_story_blueprint",
        callStatus: ["succeeded", "failed"],
      },
      verify: ({ actualInput, result }) => {
        const failures: string[] = [];
        if (result?.status === "succeeded" && typeof actualInput.feedback === "number") {
          failures.push("numeric feedback was accepted");
        }
        return failures;
      },
    },
  ],
};
