import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { runQuery } from "../../supabase/db-errors";
import type { GraphAssetInput } from "./asset-graph";
import { iso } from "./store-internal";
import type { DataAssetRow } from "./store-content";
import type { InsertDataAssetInput } from "./store-composition-jobs";
import type { CreateActionInput, UpdateActionPatch, V1Action } from "./store-types";
import type { ScriptDraft } from "@popcorn/shared/types";

type ScriptDraftStatus = "draft" | "approved" | "archived";

interface ScriptDraftRow {
  id: string;
  schema_version: "scriptDraft.v1";
  workspace_id: string;
  project_id: string;
  brief_asset_id: string | null;
  story_blueprint_id: string;
  asset_id: string | null;
  supersedes_id: string | null;
  status: ScriptDraftStatus;
  content: Omit<
    ScriptDraft,
    | "id"
    | "projectId"
    | "briefAssetId"
    | "storyBlueprintId"
    | "scenes"
    | "createdAt"
    | "updatedAt"
    | "status"
  >;
  created_at: string;
  updated_at: string;
}

interface ScriptSceneRow {
  id: string;
  scene_key: string;
  position: number;
  title: string;
  summary: string;
  narration: string | null;
  visual_intent: string | null;
  duration_sec: number | null;
}

interface ScriptDialogueLineRow {
  script_scene_id: string;
  line_key: string;
  position: number;
  character_id: string | null;
  character_name: string | null;
  text: string;
  delivery: string | null;
}

export interface ActiveProjectScriptDraft {
  scriptDraft: ScriptDraft;
  scriptDraftId: string;
  assetId: string;
  contentHash: string;
}

export interface ScriptDraftStoreDeps {
  getDb(): SupabaseClient;
  dataAssetById(db: SupabaseClient, assetId: string): Promise<DataAssetRow | null>;
  insertDataAsset(input: InsertDataAssetInput): Promise<DataAssetRow>;
  createAction(input: CreateActionInput): Promise<V1Action>;
  updateAction(actionId: string, patch: UpdateActionPatch): Promise<V1Action>;
  setActiveProjectScopedAssetSelection(
    db: SupabaseClient,
    projectId: string,
    slotRole: string,
    assetId: string,
    actionId: string
  ): Promise<void>;
}

function scriptDraftContent(input: ScriptDraft): ScriptDraftRow["content"] {
  return {
    schemaVersion: "scriptDraft.v1",
    targetLengthSec: input.targetLengthSec,
    durationClass: input.durationClass,
    durationPlan: input.durationPlan,
    ...(input.narration ? { narration: input.narration } : {}),
    ...(input.supersedesId ? { supersedesId: input.supersedesId } : {}),
  };
}

function composeScriptDraft(input: {
  row: ScriptDraftRow;
  scenes: ScriptSceneRow[];
  dialogueLines: ScriptDialogueLineRow[];
}): ScriptDraft {
  const dialogueByScene = new Map<string, ScriptDialogueLineRow[]>();
  for (const line of input.dialogueLines) {
    const current = dialogueByScene.get(line.script_scene_id) ?? [];
    current.push(line);
    dialogueByScene.set(line.script_scene_id, current);
  }
  const scenes = input.scenes.map((scene) => ({
    id: scene.scene_key,
    title: scene.title,
    summary: scene.summary,
    ...(scene.narration ? { narration: scene.narration } : {}),
    dialogue: (dialogueByScene.get(scene.id) ?? [])
      .sort((left, right) => left.position - right.position)
      .map((line) => ({
        ...(line.character_id ? { characterId: line.character_id } : {}),
        ...(line.character_name ? { characterName: line.character_name } : {}),
        text: line.text,
        ...(line.delivery ? { delivery: line.delivery } : {}),
      })),
    ...(scene.visual_intent ? { visualIntent: scene.visual_intent } : {}),
    ...(scene.duration_sec != null ? { durationSec: scene.duration_sec } : {}),
  }));
  return {
    ...input.row.content,
    id: input.row.id,
    projectId: input.row.project_id,
    briefAssetId: input.row.brief_asset_id ?? "",
    storyBlueprintId: input.row.story_blueprint_id,
    scenes,
    createdAt: iso(input.row.created_at),
    updatedAt: iso(input.row.updated_at),
    status: input.row.status,
  };
}

async function loadScriptStructure(
  db: SupabaseClient,
  projectId: string,
  scriptDraftId: string
): Promise<{ scenes: ScriptSceneRow[]; dialogueLines: ScriptDialogueLineRow[] }> {
  const scenes = (await runQuery(
    "store.loadScriptStructure scenes",
    db
      .from("script_scenes")
      .select("*")
      .eq("project_id", projectId)
      .eq("script_draft_id", scriptDraftId)
      .order("position", { ascending: true })
  )) as ScriptSceneRow[];
  if (scenes.length === 0) return { scenes, dialogueLines: [] };
  const dialogueLines = (await runQuery(
    "store.loadScriptStructure dialogue",
    db
      .from("script_dialogue_lines")
      .select("*")
      .eq("project_id", projectId)
      .eq("script_draft_id", scriptDraftId)
      .order("position", { ascending: true })
  )) as ScriptDialogueLineRow[];
  return { scenes, dialogueLines };
}

async function insertScriptStructure(input: {
  db: SupabaseClient;
  workspaceId: string;
  projectId: string;
  scriptDraftId: string;
  scenes: ScriptDraft["scenes"];
}): Promise<void> {
  if (input.scenes.length === 0) return;
  const sceneRows = (await runQuery(
    "store.insertScriptStructure scenes",
    input.db
      .from("script_scenes")
      .insert(
        input.scenes.map((scene, index) => ({
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          script_draft_id: input.scriptDraftId,
          scene_key: scene.id,
          position: index,
          title: scene.title,
          summary: scene.summary,
          narration: scene.narration ?? null,
          visual_intent: scene.visualIntent ?? null,
          duration_sec: scene.durationSec ?? null,
        }))
      )
      .select("id, scene_key")
  )) as Array<{ id: string; scene_key: string }>;
  const sceneIdByKey = new Map(sceneRows.map((scene) => [scene.scene_key, scene.id]));
  const dialogueRows = input.scenes.flatMap((scene) => {
    const scriptSceneId = sceneIdByKey.get(scene.id);
    if (!scriptSceneId) return [];
    return scene.dialogue.map((line, index) => ({
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      script_draft_id: input.scriptDraftId,
      script_scene_id: scriptSceneId,
      line_key: `${scene.id}_line_${index + 1}`,
      position: index,
      character_id: line.characterId ?? null,
      character_name: line.characterName ?? null,
      text: line.text,
      delivery: line.delivery ?? null,
    }));
  });
  if (dialogueRows.length > 0) {
    await runQuery(
      "store.insertScriptStructure dialogue",
      input.db.from("script_dialogue_lines").insert(dialogueRows)
    );
  }
}

export async function addProjectScriptDraftWithDeps(
  deps: ScriptDraftStoreDeps,
  input: {
    workspaceId: string;
    projectId: string;
    scriptDraft: Omit<
      ScriptDraft,
      "id" | "projectId" | "briefAssetId" | "storyBlueprintId" | "createdAt" | "updatedAt"
    >;
    briefAssetId: string;
    briefContentHash?: string;
    storyBlueprintId: string;
    storyBlueprintAssetId: string;
    storyBlueprintContentHash?: string;
    groundingInputs?: GraphAssetInput[];
    supersedesId?: string;
  }
): Promise<{ scriptDraftId: string; scriptDraftAssetId: string }> {
  const db = deps.getDb();
  const graphInputs: GraphAssetInput[] = [
    {
      assetId: input.briefAssetId,
      relation: "input",
      role: "brief",
      position: 0,
      ...(input.briefContentHash ? { contentHash: input.briefContentHash } : {}),
    },
    {
      assetId: input.storyBlueprintAssetId,
      relation: "input",
      role: "story_blueprint",
      position: 1,
      ...(input.storyBlueprintContentHash
        ? { contentHash: input.storyBlueprintContentHash }
        : {}),
    },
    ...(input.groundingInputs ?? []),
  ];
  const action = await deps.createAction({
    projectId: input.projectId,
    tool: "draft_script",
    status: "running",
    params: { source: "draft_script" },
    inputAssetIds: graphInputs.map((assetInput) => assetInput.assetId),
    rationale: "Persist the scene-level script draft for later voice and shot planning.",
  });
  const now = new Date().toISOString();
  const scriptDraftId = randomUUID();
  const assetSnapshot: ScriptDraft = {
    ...input.scriptDraft,
    id: scriptDraftId,
    projectId: input.projectId,
    briefAssetId: input.briefAssetId,
    storyBlueprintId: input.storyBlueprintId,
    createdAt: now,
    updatedAt: now,
    ...(input.supersedesId ? { supersedesId: input.supersedesId } : {}),
  };
  const asset = await deps.insertDataAsset({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "narration_script",
    contentSchemaKind: "script_draft",
    role: "script_draft",
    content: assetSnapshot,
    inputs: graphInputs,
    createdByActionId: action.id,
  });
  const draft = (await runQuery(
    "store.addProjectScriptDraft insert",
    db
      .from("script_drafts")
      .insert({
        id: scriptDraftId,
        schema_version: "scriptDraft.v1",
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        brief_asset_id: input.briefAssetId,
        story_blueprint_id: input.storyBlueprintId,
        asset_id: asset.id,
        supersedes_id: input.supersedesId ?? null,
        status: input.scriptDraft.status,
        content: scriptDraftContent(assetSnapshot),
        created_by_action_id: action.id,
      })
      .select("*")
      .single()
  )) as ScriptDraftRow;
  await insertScriptStructure({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    scriptDraftId: draft.id,
    scenes: input.scriptDraft.scenes,
  });
  await deps.setActiveProjectScopedAssetSelection(
    db,
    input.projectId,
    "script_draft",
    asset.id,
    action.id
  );
  await runQuery(
    "store.addProjectScriptDraft current pointer",
    db.from("projects").update({ current_script_draft_id: draft.id }).eq("id", input.projectId)
  );
  await deps.updateAction(action.id, {
    status: "applied",
    outputAssetIds: [asset.id],
  });
  return { scriptDraftId: draft.id, scriptDraftAssetId: asset.id };
}

export async function getActiveProjectScriptDraftWithDeps(
  deps: ScriptDraftStoreDeps,
  projectId: string
): Promise<ActiveProjectScriptDraft | null> {
  const db = deps.getDb();
  const project = (await runQuery(
    "store.getActiveProjectScriptDraft project",
    db.from("projects").select("current_script_draft_id").eq("id", projectId).maybeSingle()
  )) as { current_script_draft_id: string | null } | null;
  const query = db.from("script_drafts").select("*").eq("project_id", projectId);
  const data = project?.current_script_draft_id
    ? await runQuery(
        "store.getActiveProjectScriptDraft current",
        query.eq("id", project.current_script_draft_id).maybeSingle()
      )
    : await runQuery(
        "store.getActiveProjectScriptDraft latest",
        query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle()
      );
  const row = data as ScriptDraftRow | null;
  if (!row?.asset_id) return null;
  const [asset, structure] = await Promise.all([
    deps.dataAssetById(db, row.asset_id),
    loadScriptStructure(db, projectId, row.id),
  ]);
  return {
    scriptDraft: composeScriptDraft({ row, ...structure }),
    scriptDraftId: row.id,
    assetId: row.asset_id,
    contentHash: asset?.content_hash ?? "",
  };
}
