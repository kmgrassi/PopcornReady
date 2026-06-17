import {
  addProjectBrief,
  addProjectStoryBlueprint,
  getActiveProjectBrief,
} from "@/lib/api/v1/store";
import { createDraftScriptTool } from "@/lib/orchestrator-tools/draft-script";
import type { ToolBattery } from "../types";

async function seedBriefAndBlueprint(sandbox: { workspaceId: string; projectId: string }) {
  await addProjectBrief({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    brief: {
      goal: "A comedy set in space where explorers keep cloning themselves.",
      targetLengthSec: 180,
      aspectRatio: "16:9",
      style: "dry sci-fi comedy",
      audience: "streaming comedy fans",
    },
  });
  const brief = await getActiveProjectBrief(sandbox.projectId);
  if (!brief) throw new Error("seed brief was not persisted");
  await addProjectStoryBlueprint({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    briefAssetId: brief.assetId,
    briefContentHash: brief.contentHash,
    blueprint: {
      schemaVersion: "storyBlueprint.v1",
      targetLengthSec: brief.brief.targetLengthSec,
      premise: brief.brief.goal,
      logline: "A ship crew loses track of who is original and who is clone.",
      tone: brief.brief.style ?? "dry sci-fi comedy",
      audience: brief.brief.audience ?? "streaming comedy fans",
      aspectRatio: brief.brief.aspectRatio,
      characters: [
        {
          id: "captain_ren",
          name: "Captain Ren",
          role: "protagonist",
          description: "A precise commander trying to keep order.",
        },
        {
          id: "clone_mira",
          name: "Mira Prime",
          role: "supporting",
          description: "The first clone, suspiciously more competent than everyone else.",
        },
      ],
      acts: [
        {
          id: "act_1",
          title: "Survey Trouble",
          summary: "The crew discovers the cloning pod is making duplicates.",
          purpose: "Establish the absurd rules of the ship.",
          targetDurationSec: 60,
        },
        {
          id: "act_2",
          title: "Clone Caucus",
          summary: "The duplicates organize and overwhelm the chain of command.",
          purpose: "Escalate identity confusion into comedy.",
          targetDurationSec: 60,
        },
        {
          id: "act_3",
          title: "Everyone Has A Job",
          summary: "The crew and clones cooperate to complete the mission.",
          purpose: "Resolve the conflict with an ensemble payoff.",
          targetDurationSec: 60,
        },
      ],
      scenes: [
        {
          id: "scene_1",
          title: "Pod Malfunction",
          summary: "The cloning pod starts producing duplicates during the survey.",
          actId: "act_1",
          targetDurationSec: 60,
        },
        {
          id: "scene_2",
          title: "Clone Caucus",
          summary: "The duplicates organize and challenge the chain of command.",
          actId: "act_2",
          targetDurationSec: 60,
        },
        {
          id: "scene_3",
          title: "Mission Roster",
          summary: "The crew gives every clone a useful job and survives.",
          actId: "act_3",
          targetDurationSec: 60,
        },
      ],
      ending: "The ship survives, but the crew directory becomes a comedy wall chart.",
    },
  });
}

export const draftScriptBattery: ToolBattery = {
  tool: "draft_script",
  cases: [
    {
      name: "requires a brief before drafting",
      instruction: "Draft the script for this project's story.",
      expect: { tool: "draft_script", callStatus: "failed" },
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
      name: "requires a story blueprint after the brief",
      instruction: "Draft the script for this project's story.",
      setup: async ({ sandbox }) => {
        await addProjectBrief({
          workspaceId: sandbox.workspaceId,
          projectId: sandbox.projectId,
          brief: {
            goal: "A cozy cooking show about making soup on a spaceship.",
            targetLengthSec: 90,
            aspectRatio: "16:9",
            style: "warm comedic",
          },
        });
      },
      expect: { tool: "draft_script", callStatus: "failed" },
      verify: ({ result }) => {
        const failures: string[] = [];
        if (result?.status !== "failed") {
          failures.push(`expected a failed result, got ${result?.status}`);
          return failures;
        }
        const suggests = (result.error.unmetRequirements ?? []).some(
          (r) => r.satisfyWith.tool === "develop_story_blueprint"
        );
        if (!suggests) failures.push("expected the miss to suggest develop_story_blueprint");
        return failures;
      },
    },
    {
      name: "persists a relational script draft and provenance asset",
      instruction:
        "Draft the scene-level narration and dialogue from the active story blueprint.",
      setup: async ({ sandbox }) => {
        await seedBriefAndBlueprint(sandbox);
      },
      expect: { tool: "draft_script", callStatus: "succeeded" },
      verify: async ({ sandbox, db, result }) => {
        const failures: string[] = [];
        if (result?.status !== "succeeded") {
          failures.push(`expected succeeded, got ${result?.status}`);
          return failures;
        }

        const { data: rows, error: rowError } = await db
          .from("script_drafts")
          .select("id, story_blueprint_id, asset_id, content")
          .eq("project_id", sandbox.projectId);
        if (rowError) failures.push(`script_drafts query failed: ${rowError.message}`);
        const row = rows?.[0];
        if (!row) {
          failures.push("no script_drafts row persisted");
          return failures;
        }
        const content = row.content as { scenes?: unknown[]; schemaVersion?: string };
        if (content.schemaVersion !== "scriptDraft.v1") {
          failures.push(`unexpected script schema ${content.schemaVersion}`);
        }
        if (content.scenes !== undefined) {
          failures.push("script_drafts.content should not canonically store scenes");
        }

        const { data: scenes, error: scenesError } = await db
          .from("script_scenes")
          .select("id, scene_key, position, title")
          .eq("project_id", sandbox.projectId)
          .eq("script_draft_id", row.id)
          .order("position", { ascending: true });
        if (scenesError) failures.push(`script_scenes query failed: ${scenesError.message}`);
        if (!scenes || scenes.length !== 3) {
          failures.push(`expected 3 relational script scenes, got ${scenes?.length ?? 0}`);
        }

        const sceneIds = (scenes ?? []).map((scene) => scene.id as string);
        if (sceneIds.length > 0) {
          const { data: lines, error: linesError } = await db
            .from("script_dialogue_lines")
            .select("id, script_scene_id, text")
            .eq("project_id", sandbox.projectId)
            .eq("script_draft_id", row.id)
            .in("script_scene_id", sceneIds);
          if (linesError) {
            failures.push(`script_dialogue_lines query failed: ${linesError.message}`);
          }
          if (!lines || lines.length === 0) {
            failures.push("expected relational script dialogue lines");
          }
        }

        const { data: assets, error: assetError } = await db
          .from("assets")
          .select("id, kind, media, role, inputs")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "narration_script")
          .eq("role", "script_draft");
        if (assetError) failures.push(`script asset query failed: ${assetError.message}`);
        const asset = assets?.[0];
        if (!asset) {
          failures.push("no narration_script asset persisted");
        } else if (row.asset_id !== asset.id) {
          failures.push("script_drafts.asset_id does not point at the narration_script asset");
        }

        const { data: selections } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "script_draft");
        if (!selections || selections.length === 0) {
          failures.push("no active script_draft selection was set");
        }

        const { data: blueprints } = await db
          .from("story_blueprints")
          .select("id, asset_id")
          .eq("project_id", sandbox.projectId);
        const blueprintAssetId = blueprints?.[0]?.asset_id as string | undefined;
        if (asset && blueprintAssetId) {
          const inputs = (asset.inputs as Array<{ assetId?: string; role?: string }> | null) ?? [];
          if (!inputs.some((input) => input.assetId === blueprintAssetId)) {
            failures.push("script asset inputs do not reference the story blueprint asset");
          }
          const { data: edges } = await db
            .from("asset_edges")
            .select("from_id, to_id")
            .eq("project_id", sandbox.projectId)
            .eq("from_id", asset.id)
            .eq("to_id", blueprintAssetId);
          if (!edges || edges.length === 0) {
            failures.push("no asset_edge script → story blueprint");
          }
        } else if (asset) {
          failures.push("seed story blueprint asset not found");
        }

        return failures;
      },
    },
    {
      name: "rejects unsupported schema fields",
      instruction: "Schema invariant: draft_script must reject unknown input fields.",
      setup: async ({ sandbox }) => {
        await seedBriefAndBlueprint(sandbox);
      },
      expect: { tool: "draft_script", callStatus: "succeeded" },
      verify: async ({ sandbox }) => {
        const tool = createDraftScriptTool();
        try {
          const parsed = tool.parseInput({ unsupported: "nope" });
          await tool.execute(parsed, {
            auth: {
              mode: "local",
              actor: { id: "tool_test", type: "local" },
              workspaceId: sandbox.workspaceId,
              isLocal: true,
            },
            projectId: sandbox.projectId,
          });
          return ["unsupported input field was accepted"];
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return message.includes("unsupported fields")
            ? []
            : [`unexpected schema rejection error: ${message}`];
        }
      },
    },
  ],
};
