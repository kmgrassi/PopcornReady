import type { EditPlan } from "@popcorn/shared/types";
import type { AuthContext } from "./auth";
import { ApiError } from "./errors";
import { getProject } from "./store";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import {
  mapBeat,
  mapPanel,
  mapSearchChunk,
} from "./storyboards-mappers";
import {
  ensureStoryboardAct,
  getBeatRow,
  getPanelRow,
  getSceneRow,
  getStoryboardRow,
  insertBeatSnapshotAsset,
  nextIndex,
  semanticBeatChanged,
  setSelectedPanel,
  swapIndex,
  type StoryBlueprintRow,
  type StoryBlueprintSceneRow,
} from "./storyboards-repository";
import type {
  BeatInput,
  PanelInput,
  SceneInput,
  Storyboard,
  StoryboardBeat,
  StoryboardBeatRow,
  StoryboardInput,
  StoryboardPanel,
  StoryboardPanelRow,
  StoryboardScene,
  StoryboardSearchChunkRow,
  StoryboardSearchResult,
} from "./storyboards-types";

export {
  parseBeatInput,
  parsePanelInput,
  parseSceneInput,
  parseStoryboardInput,
} from "./storyboards-input";

export type {
  BeatInput,
  PanelInput,
  SceneInput,
  Storyboard,
  StoryboardBeat,
  StoryboardInput,
  StoryboardPanel,
  StoryboardScene,
  StoryboardSearchResult,
} from "./storyboards-types";

async function assertProject(auth: AuthContext, projectId: string): Promise<void> {
  await getProject(auth.workspaceId, projectId);
}

function iso(value: string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return new Date(value).toISOString();
}

function mapStoryboardFromBlueprint(row: StoryBlueprintRow): Storyboard {
  const planAssetId =
    typeof row.provenance?.planAssetId === "string" ? row.provenance.planAssetId : null;
  return {
    id: row.id,
    projectId: row.project_id,
    planAssetId,
    status: row.status === "approved" ? "approved" : "ready",
    createdByActionId: null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSceneFromSpine(row: StoryBlueprintSceneRow): StoryboardScene {
  return {
    id: row.id,
    projectId: row.project_id,
    storyboardId: row.story_blueprint_id,
    sceneIndex: row.position,
    title: row.title,
    summary: row.summary,
    setting: row.setting,
    mood: row.mood,
    durationSec: row.target_duration_sec,
    sceneAssetId: row.scene_asset_id,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listStoryboards(input: {
  auth: AuthContext;
  projectId: string;
}): Promise<Storyboard[]> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "storyboards.listStoryboards",
    db
      .from("story_blueprints")
      .select("id, project_id, asset_id, status, provenance, created_at, updated_at")
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: false })
  );
  return (data as StoryBlueprintRow[]).map(mapStoryboardFromBlueprint);
}

export async function searchStoryboardChunks(input: {
  auth: AuthContext;
  projectId: string;
  query: string;
  storyboardId?: string | null;
  limit: number;
}): Promise<StoryboardSearchResult[]> {
  const normalized = input.query.trim();
  if (!normalized) return [];

  await assertProject(input.auth, input.projectId);
  const data = await runQuery(
    "storyboards.searchStoryboardChunks",
    getServiceSupabase().rpc("search_storyboard_chunks", {
      p_workspace_id: input.auth.workspaceId,
      p_project_id: input.projectId,
      p_query: normalized,
      p_storyboard_id: input.storyboardId ?? null,
      p_limit: input.limit,
    })
  );

  return (data as StoryboardSearchChunkRow[]).map(mapSearchChunk);
}

export async function createStoryboard(input: {
  auth: AuthContext;
  projectId: string;
  data: StoryboardInput;
  publishCurrent?: boolean;
}): Promise<Storyboard> {
  const project = await getProject(input.auth.workspaceId, input.projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "storyboards.createStoryboard",
    db
      .from("story_blueprints")
      .insert({
        schema_version: "storyBlueprint.v1",
        workspace_id: input.auth.workspaceId,
        project_id: input.projectId,
        status: input.data.status === "approved" ? "approved" : "draft",
        snapshot: {
          schema_version: "storyBlueprint.v1",
          title: project.name,
          characters: [],
          acts: [],
          scenes: [],
        },
        provenance: {
          schema_version: "story_blueprint_provenance.v1",
          planAssetId: input.data.planAssetId ?? null,
        },
        created_by: {
          schema_version: "story_blueprint_creator.v1",
          tool: "storyboards.createStoryboard",
        },
      })
      .select("id, project_id, asset_id, status, provenance, created_at, updated_at")
      .single()
  );
  const storyboard = data as StoryBlueprintRow;
  if (input.publishCurrent !== false) {
    await publishStoryboard({
      auth: input.auth,
      projectId: input.projectId,
      storyboardId: storyboard.id,
    });
  }
  return mapStoryboardFromBlueprint(storyboard);
}

export async function publishStoryboard(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
}): Promise<void> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getStoryboardRow(db, input.projectId, input.storyboardId);
  await runQuery(
    "storyboards.publishStoryboard",
    db
      .from("projects")
      .update({ current_story_blueprint_id: input.storyboardId })
      .eq("id", input.projectId)
      .eq("workspace_id", input.auth.workspaceId)
  );
}

export async function markStoryboardHandoffReady(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
}): Promise<void> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  const storyboard = await getStoryboardRow(db, input.projectId, input.storyboardId);
  await runQuery(
    "storyboards.markStoryboardHandoffReady",
    db
      .from("story_blueprints")
      .update({
        provenance: {
          ...(storyboard.provenance ?? {}),
          handoffReady: true,
        },
      })
      .eq("id", input.storyboardId)
      .eq("project_id", input.projectId)
  );
}

export async function getStoryboard(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
}): Promise<Storyboard> {
  await assertProject(input.auth, input.projectId);
  return mapStoryboardFromBlueprint(
    await getStoryboardRow(getServiceSupabase(), input.projectId, input.storyboardId)
  );
}

export async function updateStoryboard(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  data: StoryboardInput;
}): Promise<Storyboard> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  const existing = await getStoryboardRow(db, input.projectId, input.storyboardId);
  const updates: Record<string, unknown> = {};
  if (input.data.status !== undefined) {
    updates.status = input.data.status === "approved" ? "approved" : "draft";
  }
  if (input.data.planAssetId !== undefined) {
    updates.provenance = {
      ...(existing.provenance ?? {}),
      planAssetId: input.data.planAssetId,
    };
  }
  if (Object.keys(updates).length === 0) return mapStoryboardFromBlueprint(existing);
  const data = await runQuery(
    "storyboards.updateStoryboard",
    db
      .from("story_blueprints")
      .update(updates)
      .eq("project_id", input.projectId)
      .eq("id", input.storyboardId)
      .select("id, project_id, asset_id, status, provenance, created_at, updated_at")
      .single()
  );
  return mapStoryboardFromBlueprint(data as StoryBlueprintRow);
}

export async function deleteStoryboard(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
}): Promise<void> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getStoryboardRow(db, input.projectId, input.storyboardId);
  await runQuery(
    "storyboards.deleteStoryboard",
    db
      .from("story_blueprints")
      .delete()
      .eq("project_id", input.projectId)
      .eq("id", input.storyboardId)
  );
}

export async function listScenes(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
}): Promise<StoryboardScene[]> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getStoryboardRow(db, input.projectId, input.storyboardId);
  const data = await runQuery(
    "storyboards.listScenes",
    db
      .from("story_blueprint_scenes")
      .select("*")
      .eq("project_id", input.projectId)
      .eq("story_blueprint_id", input.storyboardId)
      .order("position", { ascending: true })
  );
  return (data as StoryBlueprintSceneRow[]).map(mapSceneFromSpine);
}

export async function createScene(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  data: SceneInput;
}): Promise<StoryboardScene> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getStoryboardRow(db, input.projectId, input.storyboardId);
  const actId = await ensureStoryboardAct({
    db,
    auth: input.auth,
    projectId: input.projectId,
    storyboardId: input.storyboardId,
  });
  const sceneIndex =
    input.data.sceneIndex ??
    (await nextIndex(db, "story_blueprint_scenes", "story_blueprint_id", input.storyboardId, "position"));
  const data = await runQuery(
    "storyboards.createScene",
    db
      .from("story_blueprint_scenes")
      .insert({
        story_blueprint_id: input.storyboardId,
        story_blueprint_act_id: actId,
        workspace_id: input.auth.workspaceId,
        project_id: input.projectId,
        stable_id: input.data.stableId ?? `scene_${sceneIndex + 1}`,
        position: sceneIndex,
        title: input.data.title ?? `Scene ${sceneIndex + 1}`,
        summary: input.data.summary ?? "",
        setting: input.data.setting ?? null,
        mood: input.data.mood ?? null,
        target_duration_sec: input.data.durationSec ?? 0,
        scene_asset_id: input.data.sceneAssetId ?? null,
        status: input.data.status ?? "draft",
      })
      .select("*")
      .single()
  );
  return mapSceneFromSpine(data as StoryBlueprintSceneRow);
}

export async function updateScene(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  data: SceneInput;
}): Promise<StoryboardScene> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  const existing = await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  const updates: Record<string, unknown> = {};
  if (input.data.sceneIndex !== undefined) updates.position = input.data.sceneIndex;
  if (input.data.title !== undefined) updates.title = input.data.title ?? "";
  if (input.data.summary !== undefined) updates.summary = input.data.summary ?? "";
  if (input.data.setting !== undefined) updates.setting = input.data.setting;
  if (input.data.mood !== undefined) updates.mood = input.data.mood;
  if (input.data.durationSec !== undefined) updates.target_duration_sec = input.data.durationSec ?? 0;
  if (input.data.sceneAssetId !== undefined) updates.scene_asset_id = input.data.sceneAssetId;
  if (input.data.status !== undefined) updates.status = input.data.status;

  if (input.data.sceneIndex !== undefined) {
    const swapped = await swapIndex({
      db,
      table: "story_blueprint_scenes",
      parentColumn: "story_blueprint_id",
      indexColumn: "position",
      projectId: input.projectId,
      parentId: input.storyboardId,
      rowId: input.sceneId,
      fromIndex: existing.position,
      toIndex: input.data.sceneIndex,
    });
    if (swapped) delete updates.position;
  }

  if (Object.keys(updates).length === 0) {
    return mapSceneFromSpine(await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId));
  }

  const data = await runQuery(
    "storyboards.updateScene",
    db
      .from("story_blueprint_scenes")
      .update(updates)
      .eq("project_id", input.projectId)
      .eq("story_blueprint_id", input.storyboardId)
      .eq("id", input.sceneId)
      .select("*")
      .single()
  );
  return mapSceneFromSpine(data as StoryBlueprintSceneRow);
}

export async function deleteScene(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
}): Promise<void> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  await runQuery(
    "storyboards.deleteScene",
    db
      .from("story_blueprint_scenes")
      .delete()
      .eq("project_id", input.projectId)
      .eq("story_blueprint_id", input.storyboardId)
      .eq("id", input.sceneId)
  );
}

export async function listBeats(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
}): Promise<StoryboardBeat[]> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  const data = await runQuery(
    "storyboards.listBeats",
    db
      .from("story_beats")
      .select("*")
      .eq("project_id", input.projectId)
      .eq("scene_id", input.sceneId)
      .order("beat_index", { ascending: true })
  );
  return (data as StoryboardBeatRow[]).map(mapBeat);
}

export async function createBeat(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  data: BeatInput;
}): Promise<StoryboardBeat> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  const beatIndex =
    input.data.beatIndex ??
    (await nextIndex(db, "story_beats", "scene_id", input.sceneId, "beat_index"));
  const data = await runQuery(
    "storyboards.createBeat",
    db
      .from("story_beats")
      .insert({
        project_id: input.projectId,
        scene_id: input.sceneId,
        stable_id: input.data.stableId,
        beat_index: beatIndex,
        intent: input.data.intent ?? "",
        visual_description: input.data.visualDescription ?? null,
        dialogue_summary: input.data.dialogueSummary ?? null,
        narration: input.data.narration ?? null,
        duration_sec: input.data.durationSec ?? null,
        shot_type: input.data.shotType ?? null,
        camera: input.data.camera ?? null,
        framing: input.data.framing ?? null,
        status: input.data.status ?? "draft",
        beat_asset_id: input.data.beatAssetId ?? null,
      })
      .select("*")
      .single()
  );
  return mapBeat(data as StoryboardBeatRow);
}

export async function updateBeat(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  beatId: string;
  data: BeatInput;
}): Promise<StoryboardBeat> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  const existing = await getBeatRow(db, input.projectId, input.sceneId, input.beatId);
  const candidate: StoryboardBeatRow = {
    ...existing,
    intent: input.data.intent ?? existing.intent,
    visual_description:
      input.data.visualDescription !== undefined
        ? input.data.visualDescription
        : existing.visual_description,
    dialogue_summary:
      input.data.dialogueSummary !== undefined
        ? input.data.dialogueSummary
        : existing.dialogue_summary,
    narration: input.data.narration !== undefined ? input.data.narration : existing.narration,
    duration_sec:
      input.data.durationSec !== undefined ? input.data.durationSec : existing.duration_sec,
    shot_type: input.data.shotType !== undefined ? input.data.shotType : existing.shot_type,
    camera: input.data.camera !== undefined ? input.data.camera : existing.camera,
    framing: input.data.framing !== undefined ? input.data.framing : existing.framing,
  };

  const updates: Record<string, unknown> = {};
  if (input.data.beatIndex !== undefined) updates.beat_index = input.data.beatIndex;
  if (input.data.intent !== undefined) updates.intent = input.data.intent;
  if (input.data.visualDescription !== undefined) updates.visual_description = input.data.visualDescription;
  if (input.data.dialogueSummary !== undefined) updates.dialogue_summary = input.data.dialogueSummary;
  if (input.data.narration !== undefined) updates.narration = input.data.narration;
  if (input.data.durationSec !== undefined) updates.duration_sec = input.data.durationSec;
  if (input.data.shotType !== undefined) updates.shot_type = input.data.shotType;
  if (input.data.camera !== undefined) updates.camera = input.data.camera;
  if (input.data.framing !== undefined) updates.framing = input.data.framing;
  if (input.data.status !== undefined) updates.status = input.data.status;
  if (input.data.beatAssetId !== undefined && existing.beat_asset_id === null) {
    updates.beat_asset_id = input.data.beatAssetId;
  } else if (input.data.beatAssetId !== undefined) {
    throw new ApiError(
      "validation_failed",
      "beatAssetId can only be set before a beat snapshot lineage exists."
    );
  }

  if (semanticBeatChanged(existing, candidate) && existing.beat_asset_id) {
    updates.beat_asset_id = await insertBeatSnapshotAsset({
      db,
      auth: input.auth,
      projectId: input.projectId,
      beat: candidate,
      previousAssetId: existing.beat_asset_id,
    });
  }

  if (input.data.beatIndex !== undefined) {
    const swapped = await swapIndex({
      db,
      table: "story_beats",
      parentColumn: "scene_id",
      indexColumn: "beat_index",
      projectId: input.projectId,
      parentId: input.sceneId,
      rowId: input.beatId,
      fromIndex: existing.beat_index,
      toIndex: input.data.beatIndex,
    });
    if (swapped) delete updates.beat_index;
  }

  if (Object.keys(updates).length === 0) {
    return mapBeat(await getBeatRow(db, input.projectId, input.sceneId, input.beatId));
  }

  const data = await runQuery(
    "storyboards.updateBeat",
    db
      .from("story_beats")
      .update(updates)
      .eq("project_id", input.projectId)
      .eq("scene_id", input.sceneId)
      .eq("id", input.beatId)
      .select("*")
      .single()
  );
  return mapBeat(data as StoryboardBeatRow);
}

export async function deleteBeat(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  beatId: string;
}): Promise<void> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  await getBeatRow(db, input.projectId, input.sceneId, input.beatId);
  await runQuery(
    "storyboards.deleteBeat",
    db
      .from("story_beats")
      .delete()
      .eq("project_id", input.projectId)
      .eq("scene_id", input.sceneId)
      .eq("id", input.beatId)
  );
}

export async function listPanels(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  beatId: string;
}): Promise<StoryboardPanel[]> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  await getBeatRow(db, input.projectId, input.sceneId, input.beatId);
  const data = await runQuery(
    "storyboards.listPanels",
    db
      .from("story_panels")
      .select("*")
      .eq("project_id", input.projectId)
      .eq("beat_id", input.beatId)
      .order("panel_index", { ascending: true })
  );
  return (data as StoryboardPanelRow[]).map(mapPanel);
}

export async function createPanel(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  beatId: string;
  data: PanelInput;
}): Promise<StoryboardPanel> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  await getBeatRow(db, input.projectId, input.sceneId, input.beatId);
  const panelIndex =
    input.data.panelIndex ??
    (await nextIndex(db, "story_panels", "beat_id", input.beatId, "panel_index"));
  if (input.data.isSelected) {
    await runQuery(
      "storyboards.createPanel clearSelected",
      db
        .from("story_panels")
        .update({ is_selected: false })
        .eq("project_id", input.projectId)
        .eq("beat_id", input.beatId)
        .eq("is_selected", true)
    );
  }
  const data = await runQuery(
    "storyboards.createPanel",
    db
      .from("story_panels")
      .insert({
        project_id: input.projectId,
        beat_id: input.beatId,
        panel_index: panelIndex,
        image_asset_id: input.data.imageAssetId ?? null,
        prompt_asset_id: input.data.promptAssetId ?? null,
        status: input.data.status ?? "queued",
        is_selected: input.data.isSelected ?? false,
        approved_at: input.data.approvedAt ?? null,
      })
      .select("*")
      .single()
  );
  return mapPanel(data as StoryboardPanelRow);
}

export async function updatePanel(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  beatId: string;
  panelId: string;
  data: PanelInput;
}): Promise<StoryboardPanel> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  await getBeatRow(db, input.projectId, input.sceneId, input.beatId);
  const existing = await getPanelRow(db, input.projectId, input.beatId, input.panelId);
  const updates: Record<string, unknown> = {};
  if (input.data.panelIndex !== undefined) updates.panel_index = input.data.panelIndex;
  if (input.data.imageAssetId !== undefined) updates.image_asset_id = input.data.imageAssetId;
  if (input.data.promptAssetId !== undefined) updates.prompt_asset_id = input.data.promptAssetId;
  if (input.data.status !== undefined) updates.status = input.data.status;
  if (input.data.approvedAt !== undefined) updates.approved_at = input.data.approvedAt;

  if (input.data.panelIndex !== undefined) {
    const swapped = await swapIndex({
      db,
      table: "story_panels",
      parentColumn: "beat_id",
      indexColumn: "panel_index",
      projectId: input.projectId,
      parentId: input.beatId,
      rowId: input.panelId,
      fromIndex: existing.panel_index,
      toIndex: input.data.panelIndex,
    });
    if (swapped) delete updates.panel_index;
  }
  if (input.data.isSelected !== undefined) {
    await setSelectedPanel(
      db,
      input.projectId,
      input.beatId,
      input.panelId,
      input.data.isSelected
    );
  }

  if (Object.keys(updates).length === 0) {
    return mapPanel(await getPanelRow(db, input.projectId, input.beatId, input.panelId));
  }

  const data = await runQuery(
    "storyboards.updatePanel",
    db
      .from("story_panels")
      .update(updates)
      .eq("project_id", input.projectId)
      .eq("beat_id", input.beatId)
      .eq("id", input.panelId)
      .select("*")
      .single()
  );
  return mapPanel(data as StoryboardPanelRow);
}

export async function deletePanel(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  beatId: string;
  panelId: string;
}): Promise<void> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId);
  await getBeatRow(db, input.projectId, input.sceneId, input.beatId);
  await getPanelRow(db, input.projectId, input.beatId, input.panelId);
  await runQuery(
    "storyboards.deletePanel",
    db
      .from("story_panels")
      .delete()
      .eq("project_id", input.projectId)
      .eq("beat_id", input.beatId)
      .eq("id", input.panelId)
  );
}

export async function buildStoryboardForPlan(input: {
  auth: AuthContext;
  projectId: string;
  planAssetId: string;
  plan: EditPlan;
  /** plan beat id -> persisted tile image asset id. */
  tileAssetByBeatId: Map<string, string>;
}, deps: {
  createStoryboard: typeof createStoryboard;
  createScene: typeof createScene;
  createBeat: typeof createBeat;
  createPanel: typeof createPanel;
} = {
  createStoryboard,
  createScene,
  createBeat,
  createPanel,
}): Promise<{ storyboardId: string; panelCount: number }> {
  const storyboard = await deps.createStoryboard({
    auth: input.auth,
    projectId: input.projectId,
    data: { planAssetId: input.planAssetId, status: "ready" },
    // The worker publishes this immutable attempt only after every row and
    // backing tile has passed the keyframe handoff checks.
    publishCurrent: false,
  });

  let panelCount = 0;
  for (let s = 0; s < input.plan.scenes.length; s += 1) {
    const scene = input.plan.scenes[s];
    const sbScene = await deps.createScene({
      auth: input.auth,
      projectId: input.projectId,
      storyboardId: storyboard.id,
      data: {
        stableId: scene.id,
        sceneIndex: s,
        title: scene.name ?? null,
        setting: scene.setting ?? null,
        mood: scene.mood ?? null,
        status: "ready",
      },
    });

    for (let b = 0; b < scene.beats.length; b += 1) {
      const beat = scene.beats[b];
      const sbBeat = await deps.createBeat({
        auth: input.auth,
        projectId: input.projectId,
        storyboardId: storyboard.id,
        sceneId: sbScene.id,
        data: {
          stableId: beat.id,
          beatIndex: b,
          intent: beat.intent ?? "",
          durationSec: beat.durationSec ?? null,
          shotType: beat.shotType ?? null,
          camera: beat.camera ?? null,
          framing: beat.framing ?? null,
          status: "ready",
        },
      });

      const tileAssetId = beat.id ? input.tileAssetByBeatId.get(beat.id) : undefined;
      if (tileAssetId) {
        await deps.createPanel({
          auth: input.auth,
          projectId: input.projectId,
          storyboardId: storyboard.id,
          sceneId: sbScene.id,
          beatId: sbBeat.id,
          data: { panelIndex: 0, imageAssetId: tileAssetId, isSelected: true, status: "ready" },
        });
        panelCount += 1;
      }
    }
  }

  return { storyboardId: storyboard.id, panelCount };
}
