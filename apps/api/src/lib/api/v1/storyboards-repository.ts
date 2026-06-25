import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "./auth";
import { notFound } from "./errors";
import { defaultVisibilityForWorkspace } from "./store";
import { runQuery } from "@/lib/supabase/db-errors";
import type {
  BeatAssetRow,
  StoryboardBeatRow,
  StoryboardPanelRow,
} from "./storyboards-types";

export interface StoryBlueprintRow {
  id: string;
  project_id: string;
  asset_id: string | null;
  status: "draft" | "approved" | "superseded";
  provenance: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface StoryBlueprintActRow {
  id: string;
}

export interface StoryBlueprintSceneRow {
  id: string;
  project_id: string;
  story_blueprint_id: string;
  position: number;
  title: string | null;
  summary: string | null;
  setting: string | null;
  mood: string | null;
  target_duration_sec: number | null;
  scene_asset_id: string | null;
  status: "draft" | "queued" | "generating" | "ready" | "approved" | "rejected" | "failed";
  created_at: string;
  updated_at: string;
}

export async function getStoryboardRow(
  db: SupabaseClient,
  projectId: string,
  storyboardId: string
): Promise<StoryBlueprintRow> {
  const data = await runQuery(
    "storyboards.getStoryboard",
    db
      .from("story_blueprints")
      .select("id, project_id, asset_id, status, provenance, created_at, updated_at")
      .eq("project_id", projectId)
      .eq("id", storyboardId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Story blueprint not found: ${storyboardId}`);
  return data as StoryBlueprintRow;
}

export async function getSceneRow(
  db: SupabaseClient,
  projectId: string,
  storyboardId: string,
  sceneId: string
): Promise<StoryBlueprintSceneRow> {
  const data = await runQuery(
    "storyboards.getScene",
    db
      .from("story_blueprint_scenes")
      .select("*")
      .eq("project_id", projectId)
      .eq("story_blueprint_id", storyboardId)
      .eq("id", sceneId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Storyboard scene not found: ${sceneId}`);
  return data as StoryBlueprintSceneRow;
}

export async function getBeatRow(
  db: SupabaseClient,
  projectId: string,
  sceneId: string,
  beatId: string
): Promise<StoryboardBeatRow> {
  const data = await runQuery(
    "storyboards.getBeat",
    db
      .from("story_beats")
      .select("*")
      .eq("project_id", projectId)
      .eq("scene_id", sceneId)
      .eq("id", beatId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Storyboard beat not found: ${beatId}`);
  return data as StoryboardBeatRow;
}

export async function getPanelRow(
  db: SupabaseClient,
  projectId: string,
  beatId: string,
  panelId: string
): Promise<StoryboardPanelRow> {
  const data = await runQuery(
    "storyboards.getPanel",
    db
      .from("story_panels")
      .select("*")
      .eq("project_id", projectId)
      .eq("beat_id", beatId)
      .eq("id", panelId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Storyboard panel not found: ${panelId}`);
  return data as StoryboardPanelRow;
}

export async function nextIndex(
  db: SupabaseClient,
  table: "story_blueprint_scenes" | "story_beats" | "story_panels",
  parentColumn: "story_blueprint_id" | "scene_id" | "beat_id",
  parentId: string,
  indexColumn: "position" | "beat_index" | "panel_index"
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

export async function swapIndex(input: {
  db: SupabaseClient;
  table: "story_blueprint_scenes" | "story_beats" | "story_panels";
  parentColumn: "story_blueprint_id" | "scene_id" | "beat_id";
  indexColumn: "position" | "beat_index" | "panel_index";
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

export async function ensureStoryboardAct(input: {
  db: SupabaseClient;
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
}): Promise<string> {
  const rows = await runQuery(
    "storyboards.ensureAct lookup",
    input.db
      .from("story_blueprint_acts")
      .select("id")
      .eq("project_id", input.projectId)
      .eq("story_blueprint_id", input.storyboardId)
      .order("position", { ascending: true })
      .limit(1)
  );
  const existing = ((rows as StoryBlueprintActRow[]) ?? [])[0]?.id;
  if (existing) return existing;

  const data = await runQuery(
    "storyboards.ensureAct create",
    input.db
      .from("story_blueprint_acts")
      .insert({
        story_blueprint_id: input.storyboardId,
        workspace_id: input.auth.workspaceId,
        project_id: input.projectId,
        stable_id: "act_1",
        position: 0,
        title: "Act 1",
        purpose: "Storyboard",
        summary: "Storyboard scenes.",
        target_duration_sec: 0,
        status: "draft",
      })
      .select("id")
      .single()
  );
  return (data as StoryBlueprintActRow).id;
}

export async function setSelectedPanel(
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
        .from("story_panels")
        .update({ is_selected: false })
        .eq("project_id", projectId)
        .eq("beat_id", beatId)
        .eq("is_selected", true)
    );
  }
  await runQuery(
    "storyboards.setSelectedPanel",
    db
      .from("story_panels")
      .update({ is_selected: isSelected })
      .eq("project_id", projectId)
      .eq("beat_id", beatId)
      .eq("id", panelId)
  );
}

export async function insertBeatSnapshotAsset(input: {
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

export function semanticBeatChanged(
  before: StoryboardBeatRow,
  after: StoryboardBeatRow
): boolean {
  return (
    before.intent !== after.intent ||
    before.visual_description !== after.visual_description ||
    before.dialogue_summary !== after.dialogue_summary ||
    before.narration !== after.narration ||
    before.duration_sec !== after.duration_sec
  );
}
