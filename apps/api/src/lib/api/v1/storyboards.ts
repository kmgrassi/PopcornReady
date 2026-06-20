import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditPlan } from "@popcorn/shared/types";
import type { AuthContext } from "./auth";
import { ApiError, notFound } from "./errors";
import { getProject } from "./store";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import {
  mapBeat,
  mapPanel,
  mapScene,
  mapSearchChunk,
  mapStoryboard,
} from "./storyboards-mappers";
import type {
  BeatAssetRow,
  BeatInput,
  PanelInput,
  SceneInput,
  Storyboard,
  StoryboardBeat,
  StoryboardBeatRow,
  StoryboardInput,
  StoryboardPanel,
  StoryboardPanelRow,
  StoryboardRow,
  StoryboardScene,
  StoryboardSceneRow,
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

async function defaultVisibilityForWorkspace(
  db: SupabaseClient,
  workspaceId: string
): Promise<"public" | "private"> {
  const data = await runQuery(
    "storyboards.defaultVisibilityForWorkspace",
    db.rpc("owner_tier", { ws_id: workspaceId })
  );
  return data === "paid" ? "private" : "public";
}

async function getStoryboardRow(
  db: SupabaseClient,
  projectId: string,
  storyboardId: string
): Promise<StoryboardRow> {
  const data = await runQuery(
    "storyboards.getStoryboard",
    db
      .from("storyboards")
      .select("*")
      .eq("project_id", projectId)
      .eq("id", storyboardId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Storyboard not found: ${storyboardId}`);
  return data as StoryboardRow;
}

async function getSceneRow(
  db: SupabaseClient,
  projectId: string,
  storyboardId: string,
  sceneId: string
): Promise<StoryboardSceneRow> {
  const data = await runQuery(
    "storyboards.getScene",
    db
      .from("storyboard_scenes")
      .select("*")
      .eq("project_id", projectId)
      .eq("storyboard_id", storyboardId)
      .eq("id", sceneId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Storyboard scene not found: ${sceneId}`);
  return data as StoryboardSceneRow;
}

async function getBeatRow(
  db: SupabaseClient,
  projectId: string,
  sceneId: string,
  beatId: string
): Promise<StoryboardBeatRow> {
  const data = await runQuery(
    "storyboards.getBeat",
    db
      .from("storyboard_beats")
      .select("*")
      .eq("project_id", projectId)
      .eq("scene_id", sceneId)
      .eq("id", beatId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Storyboard beat not found: ${beatId}`);
  return data as StoryboardBeatRow;
}

async function getPanelRow(
  db: SupabaseClient,
  projectId: string,
  beatId: string,
  panelId: string
): Promise<StoryboardPanelRow> {
  const data = await runQuery(
    "storyboards.getPanel",
    db
      .from("storyboard_panels")
      .select("*")
      .eq("project_id", projectId)
      .eq("beat_id", beatId)
      .eq("id", panelId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Storyboard panel not found: ${panelId}`);
  return data as StoryboardPanelRow;
}

async function nextIndex(
  db: SupabaseClient,
  table: "storyboard_scenes" | "storyboard_beats" | "storyboard_panels",
  parentColumn: "storyboard_id" | "scene_id" | "beat_id",
  parentId: string,
  indexColumn: "scene_index" | "beat_index" | "panel_index"
): Promise<number> {
  const data = await runQuery(
    `storyboards.nextIndex ${table}`,
    db
      .from(table)
      .select(indexColumn)
      .eq(parentColumn, parentId)
      .order(indexColumn, { ascending: false })
      .limit(1)
  );
  const row = (data as Array<Record<string, number>>)[0];
  return row ? row[indexColumn] + 1 : 0;
}

async function swapIndex(input: {
  db: SupabaseClient;
  table: "storyboard_scenes" | "storyboard_beats" | "storyboard_panels";
  idColumn?: "id";
  parentColumn: "storyboard_id" | "scene_id" | "beat_id";
  indexColumn: "scene_index" | "beat_index" | "panel_index";
  projectId: string;
  parentId: string;
  rowId: string;
  fromIndex: number;
  toIndex: number;
}): Promise<boolean> {
  if (input.fromIndex === input.toIndex) return true;

  const occupant = await runQuery(
    `storyboards.swapIndex ${input.table} lookup`,
    input.db
      .from(input.table)
      .select("id")
      .eq("project_id", input.projectId)
      .eq(input.parentColumn, input.parentId)
      .eq(input.indexColumn, input.toIndex)
      .maybeSingle()
  );
  if (!occupant) return false;

  const occupantId = (occupant as { id: string }).id;
  if (occupantId === input.rowId) return true;

  const tempIndex = Math.max(input.fromIndex, input.toIndex) + 1_000_000;
  for (const [rowId, index] of [
    [occupantId, tempIndex],
    [input.rowId, input.toIndex],
    [occupantId, input.fromIndex],
  ] as Array<[string, number]>) {
    await runQuery(
      `storyboards.swapIndex ${input.table}`,
      input.db
        .from(input.table)
        .update({ [input.indexColumn]: index })
        .eq("project_id", input.projectId)
        .eq("id", rowId)
    );
  }
  return true;
}

async function setSelectedPanel(
  db: SupabaseClient,
  projectId: string,
  beatId: string,
  panelId: string,
  isSelected: boolean
): Promise<void> {
  if (isSelected) {
    await runQuery(
      "storyboards.clearSelectedPanels",
      db
        .from("storyboard_panels")
        .update({ is_selected: false })
        .eq("project_id", projectId)
        .eq("beat_id", beatId)
        .eq("is_selected", true)
    );
  }
  await runQuery(
    "storyboards.setSelectedPanel",
    db
      .from("storyboard_panels")
      .update({ is_selected: isSelected })
      .eq("project_id", projectId)
      .eq("beat_id", beatId)
      .eq("id", panelId)
  );
}

async function insertBeatSnapshotAsset(input: {
  db: SupabaseClient;
  auth: AuthContext;
  projectId: string;
  beat: StoryboardBeatRow;
  previousAssetId: string;
}): Promise<string> {
  const previousAsset = await runQuery(
    "storyboards.previousBeatAsset",
    input.db
      .from("assets")
      .select("id,lineage_id,version")
      .eq("project_id", input.projectId)
      .eq("id", input.previousAssetId)
      .eq("kind", "beat")
      .eq("media", "data")
      .maybeSingle()
  );
  if (!previousAsset) {
    throw notFound(`Beat snapshot asset not found: ${input.previousAssetId}`);
  }

  const previous = previousAsset as BeatAssetRow;
  const now = new Date().toISOString();
  const visibility = await defaultVisibilityForWorkspace(input.db, input.auth.workspaceId);
  const data = await runQuery(
    "storyboards.insertBeatSnapshotAsset",
    input.db
      .from("assets")
      .insert({
        schema_version: "asset.v2",
        workspace_id: input.auth.workspaceId,
        project_id: input.projectId,
        lineage_id: previous.lineage_id,
        version: previous.version + 1,
        kind: "beat",
        media: "data",
        status: "ready",
        role: "storyboard_beat",
        content: {
          schema_version: "beat.v1",
          storyboardBeatId: input.beat.id,
          sceneId: input.beat.scene_id,
          intent: input.beat.intent,
          visualDescription: input.beat.visual_description,
          dialogueSummary: input.beat.dialogue_summary,
          narration: input.beat.narration,
          durationSec: input.beat.duration_sec,
        },
        visibility,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single()
  );
  return (data as { id: string }).id;
}

function semanticBeatChanged(before: StoryboardBeatRow, after: StoryboardBeatRow): boolean {
  return (
    before.intent !== after.intent ||
    before.visual_description !== after.visual_description ||
    before.dialogue_summary !== after.dialogue_summary ||
    before.narration !== after.narration ||
    before.duration_sec !== after.duration_sec
  );
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
      .from("storyboards")
      .select("*")
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: false })
  );
  return (data as StoryboardRow[]).map(mapStoryboard);
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
}): Promise<Storyboard> {
  await assertProject(input.auth, input.projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "storyboards.createStoryboard",
    db
      .from("storyboards")
      .insert({
        project_id: input.projectId,
        plan_asset_id: input.data.planAssetId ?? null,
        status: input.data.status ?? "draft",
      })
      .select("*")
      .single()
  );
  return mapStoryboard(data as StoryboardRow);
}

export async function getStoryboard(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
}): Promise<Storyboard> {
  await assertProject(input.auth, input.projectId);
  return mapStoryboard(
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
  if (input.data.planAssetId !== undefined) updates.plan_asset_id = input.data.planAssetId;
  if (input.data.status !== undefined) updates.status = input.data.status;
  if (Object.keys(updates).length === 0) return mapStoryboard(existing);
  const data = await runQuery(
    "storyboards.updateStoryboard",
    db
      .from("storyboards")
      .update(updates)
      .eq("project_id", input.projectId)
      .eq("id", input.storyboardId)
      .select("*")
      .single()
  );
  return mapStoryboard(data as StoryboardRow);
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
      .from("storyboards")
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
      .from("storyboard_scenes")
      .select("*")
      .eq("project_id", input.projectId)
      .eq("storyboard_id", input.storyboardId)
      .order("scene_index", { ascending: true })
  );
  return (data as StoryboardSceneRow[]).map(mapScene);
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
  const sceneIndex =
    input.data.sceneIndex ??
    (await nextIndex(db, "storyboard_scenes", "storyboard_id", input.storyboardId, "scene_index"));
  const data = await runQuery(
    "storyboards.createScene",
    db
      .from("storyboard_scenes")
      .insert({
        project_id: input.projectId,
        storyboard_id: input.storyboardId,
        scene_index: sceneIndex,
        title: input.data.title ?? null,
        summary: input.data.summary ?? null,
        setting: input.data.setting ?? null,
        mood: input.data.mood ?? null,
        duration_sec: input.data.durationSec ?? null,
        scene_asset_id: input.data.sceneAssetId ?? null,
        status: input.data.status ?? "draft",
      })
      .select("*")
      .single()
  );
  return mapScene(data as StoryboardSceneRow);
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
  if (input.data.sceneIndex !== undefined) updates.scene_index = input.data.sceneIndex;
  if (input.data.title !== undefined) updates.title = input.data.title;
  if (input.data.summary !== undefined) updates.summary = input.data.summary;
  if (input.data.setting !== undefined) updates.setting = input.data.setting;
  if (input.data.mood !== undefined) updates.mood = input.data.mood;
  if (input.data.durationSec !== undefined) updates.duration_sec = input.data.durationSec;
  if (input.data.sceneAssetId !== undefined) updates.scene_asset_id = input.data.sceneAssetId;
  if (input.data.status !== undefined) updates.status = input.data.status;

  if (input.data.sceneIndex !== undefined) {
    const swapped = await swapIndex({
      db,
      table: "storyboard_scenes",
      parentColumn: "storyboard_id",
      indexColumn: "scene_index",
      projectId: input.projectId,
      parentId: input.storyboardId,
      rowId: input.sceneId,
      fromIndex: existing.scene_index,
      toIndex: input.data.sceneIndex,
    });
    if (swapped) delete updates.scene_index;
  }

  if (Object.keys(updates).length === 0) {
    return mapScene(await getSceneRow(db, input.projectId, input.storyboardId, input.sceneId));
  }

  const data = await runQuery(
    "storyboards.updateScene",
    db
      .from("storyboard_scenes")
      .update(updates)
      .eq("project_id", input.projectId)
      .eq("storyboard_id", input.storyboardId)
      .eq("id", input.sceneId)
      .select("*")
      .single()
  );
  return mapScene(data as StoryboardSceneRow);
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
      .from("storyboard_scenes")
      .delete()
      .eq("project_id", input.projectId)
      .eq("storyboard_id", input.storyboardId)
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
      .from("storyboard_beats")
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
    (await nextIndex(db, "storyboard_beats", "scene_id", input.sceneId, "beat_index"));
  const data = await runQuery(
    "storyboards.createBeat",
    db
      .from("storyboard_beats")
      .insert({
        project_id: input.projectId,
        scene_id: input.sceneId,
        beat_index: beatIndex,
        intent: input.data.intent ?? "",
        visual_description: input.data.visualDescription ?? null,
        dialogue_summary: input.data.dialogueSummary ?? null,
        narration: input.data.narration ?? null,
        duration_sec: input.data.durationSec ?? null,
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
  };

  const updates: Record<string, unknown> = {};
  if (input.data.beatIndex !== undefined) updates.beat_index = input.data.beatIndex;
  if (input.data.intent !== undefined) updates.intent = input.data.intent;
  if (input.data.visualDescription !== undefined) {
    updates.visual_description = input.data.visualDescription;
  }
  if (input.data.dialogueSummary !== undefined) {
    updates.dialogue_summary = input.data.dialogueSummary;
  }
  if (input.data.narration !== undefined) updates.narration = input.data.narration;
  if (input.data.durationSec !== undefined) updates.duration_sec = input.data.durationSec;
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
      table: "storyboard_beats",
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
      .from("storyboard_beats")
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
      .from("storyboard_beats")
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
      .from("storyboard_panels")
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
    (await nextIndex(db, "storyboard_panels", "beat_id", input.beatId, "panel_index"));
  if (input.data.isSelected) {
    await runQuery(
      "storyboards.createPanel clearSelected",
      db
        .from("storyboard_panels")
        .update({ is_selected: false })
        .eq("project_id", input.projectId)
        .eq("beat_id", input.beatId)
        .eq("is_selected", true)
    );
  }
  const data = await runQuery(
    "storyboards.createPanel",
    db
      .from("storyboard_panels")
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
      table: "storyboard_panels",
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
      .from("storyboard_panels")
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
      .from("storyboard_panels")
      .delete()
      .eq("project_id", input.projectId)
      .eq("beat_id", input.beatId)
      .eq("id", input.panelId)
  );
}

// Build the relational storyboard for a plan: one scene per plan scene, one beat
// per plan beat, and a selected panel per beat linking to its generated tile
// asset. The storyboard links to the plan via plan_asset_id (provenance), and the
// per-beat tile assets independently record the plan as their input (stale graph).
export async function buildStoryboardForPlan(input: {
  auth: AuthContext;
  projectId: string;
  planAssetId: string;
  plan: EditPlan;
  /** beatId -> persisted tile image asset id. */
  tileAssetByBeatId: Map<string, string>;
}): Promise<{ storyboardId: string; panelCount: number }> {
  const storyboard = await createStoryboard({
    auth: input.auth,
    projectId: input.projectId,
    data: { planAssetId: input.planAssetId, status: "ready" },
  });

  let panelCount = 0;
  for (let s = 0; s < input.plan.scenes.length; s += 1) {
    const scene = input.plan.scenes[s];
    const sbScene = await createScene({
      auth: input.auth,
      projectId: input.projectId,
      storyboardId: storyboard.id,
      data: {
        sceneIndex: s,
        title: scene.name ?? null,
        setting: scene.setting ?? null,
        mood: scene.mood ?? null,
        status: "ready",
      },
    });

    for (let b = 0; b < scene.beats.length; b += 1) {
      const beat = scene.beats[b];
      const sbBeat = await createBeat({
        auth: input.auth,
        projectId: input.projectId,
        storyboardId: storyboard.id,
        sceneId: sbScene.id,
        data: {
          beatIndex: b,
          intent: beat.intent ?? "",
          durationSec: beat.durationSec ?? null,
          status: "ready",
        },
      });

      const tileAssetId = beat.id ? input.tileAssetByBeatId.get(beat.id) : undefined;
      if (tileAssetId) {
        await createPanel({
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
