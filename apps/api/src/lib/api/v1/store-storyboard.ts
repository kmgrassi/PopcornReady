// Storyboard persistence and hydration for the V1 store.

import type { SupabaseClient } from "@supabase/supabase-js";
import { runQuery } from "../../supabase/db-errors";
import { ApiError, notFound } from "./errors";
import { iso, markedJson } from "./store-internal";
import { markedContent } from "./store-content";
import type { ProjectStoryboard, StoryboardBeat, StoryboardItemStatus, StoryboardPanel, StoryboardScene, StoryboardStatus } from "@popcorn/shared/v1/types";
import { dataAssetById, getProject, getServiceSupabase, insertDataAsset } from "./store";
import type { AssetRow, ProjectRow, StoryBlueprintRow } from "./store";
import { resolveStoryboardMediaByAssetId } from "./store-storyboard-media";

export { assetGenerationPrompt } from "./store-storyboard-media";

interface StorySpineSceneRow {
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
  status: StoryboardItemStatus;
  created_at: string;
  updated_at: string;
}

interface StoryboardBeatRow {
  id: string;
  project_id: string;
  scene_id: string;
  beat_index: number;
  intent: string;
  visual_description: string | null;
  dialogue_summary: string | null;
  narration: string | null;
  duration_sec: number | null;
  shot_type: string | null;
  camera: string | null;
  framing: string | null;
  status: StoryboardItemStatus;
  beat_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

interface StoryboardPanelRow {
  id: string;
  project_id: string;
  beat_id: string;
  panel_index: number;
  image_asset_id: string | null;
  prompt_asset_id: string | null;
  status: StoryboardItemStatus;
  is_selected: boolean;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveStoryboardSceneInput {
  id: string;
  title: string | null;
  summary?: string | null;
  setting?: string | null;
  mood?: string | null;
  durationSec?: number | null;
  status?: StoryboardItemStatus;
  beats: SaveStoryboardBeatInput[];
}

export interface SaveStoryboardBeatInput {
  id: string;
  intent: string;
  visualDescription?: string | null;
  dialogueSummary?: string | null;
  narration?: string | null;
  durationSec?: number | null;
  shotType?: string | null;
  camera?: string | null;
  framing?: string | null;
  status?: StoryboardItemStatus;
}

export interface SaveStoryboardInput {
  id?: string | null;
  status?: StoryboardStatus;
  scenes: SaveStoryboardSceneInput[];
}

function mapStoryboardPanel(row: StoryboardPanelRow): StoryboardPanel {
  return {
    id: row.id,
    projectId: row.project_id,
    beatId: row.beat_id,
    panelIndex: row.panel_index,
    imageAssetId: row.image_asset_id,
    promptAssetId: row.prompt_asset_id,
    status: row.status,
    isSelected: row.is_selected,
    approvedAt: row.approved_at ? iso(row.approved_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapStoryboardBeat(
  row: StoryboardBeatRow,
  panels: StoryboardPanel[]
): StoryboardBeat {
  return {
    id: row.id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    beatIndex: row.beat_index,
    intent: row.intent,
    visualDescription: row.visual_description,
    dialogueSummary: row.dialogue_summary,
    narration: row.narration,
    durationSec: row.duration_sec,
    shotType: row.shot_type,
    camera: row.camera,
    framing: row.framing,
    status: row.status,
    beatAssetId: row.beat_asset_id,
    panels,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSpineScene(row: StorySpineSceneRow, beats: StoryboardBeat[]): StoryboardScene {
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
    beats,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSpineStoryboard(
  row: ProjectRow,
  storyBlueprintId: string,
  planAssetId: string | null,
  scenes: StoryboardScene[]
): ProjectStoryboard {
  return {
    id: storyBlueprintId,
    projectId: row.id,
    planAssetId,
    status: "ready",
    scenes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function getStoryBlueprintRow(
  db: SupabaseClient,
  projectId: string,
  storyBlueprintId?: string | null
): Promise<StoryBlueprintRow | null> {
  let query = db
    .from("story_blueprints")
    .select("*")
    .eq("project_id", projectId);
  if (storyBlueprintId) query = query.eq("id", storyBlueprintId);
  const data = await runQuery(
    "store.getStoryBlueprintRow",
    query.order("created_at", { ascending: false }).limit(1).maybeSingle()
  );
  return (data as StoryBlueprintRow | null) ?? null;
}

export async function requireProjectRow(
  db: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<ProjectRow> {
  const data = await runQuery(
    "store.requireProjectRow",
    db
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!data) throw notFound(`Project not found: ${projectId}`);
  return data as ProjectRow;
}

async function hydrateProjectStoryboardById(
  db: SupabaseClient,
  project: ProjectRow,
  workspaceId: string,
  projectId: string,
  storyBlueprintId: string
): Promise<ProjectStoryboard | null> {
  const storyBlueprint = await getStoryBlueprintRow(db, projectId, storyBlueprintId);
  if (!storyBlueprint) return null;
  const planAssetId =
    typeof storyBlueprint.provenance?.planAssetId === "string"
      ? storyBlueprint.provenance.planAssetId
      : null;
  const scenesData = await runQuery(
    "store.getProjectStoryboard spine scenes",
    db
      .from("story_blueprint_scenes")
      .select(
        "id, project_id, story_blueprint_id, position, title, summary, setting, mood, target_duration_sec, scene_asset_id, status, created_at, updated_at"
      )
      .eq("project_id", projectId)
      .eq("story_blueprint_id", storyBlueprintId)
      .order("position", { ascending: true })
  );
  const spineSceneRows = (scenesData ?? []) as StorySpineSceneRow[];
  const sceneIds = spineSceneRows.map((scene) => scene.id);

  const beatsData = sceneIds.length
    ? await runQuery(
        "store.getProjectStoryboard spine beats",
        db
          .from("story_beats")
          .select("*")
          .eq("project_id", projectId)
          .in("scene_id", sceneIds)
          .order("beat_index", { ascending: true })
      )
    : [];
  const beatRows = (beatsData ?? []) as StoryboardBeatRow[];
  const beatIds = beatRows.map((beat) => beat.id);

  const panelsData = beatIds.length
    ? await runQuery(
        "store.getProjectStoryboard spine panels",
        db
          .from("story_panels")
          .select("*")
          .eq("project_id", projectId)
          .in("beat_id", beatIds)
          .order("panel_index", { ascending: true })
      )
    : [];
  const panelRows = (panelsData ?? []) as StoryboardPanelRow[];

  const panelMedia = await resolveStoryboardMediaByAssetId(
    db,
    workspaceId,
    projectId,
    panelRows
      .map((row) => row.image_asset_id)
      .filter((id): id is string => Boolean(id))
  );

  const panelsByBeat = new Map<string, StoryboardPanel[]>();
  for (const row of panelRows) {
    const panel = mapStoryboardPanel(row);
    const media = panel.imageAssetId ? panelMedia.get(panel.imageAssetId) : undefined;
    if (media?.url) {
      panel.url = media.url;
      if (media.thumbnailUrl) panel.thumbnailUrl = media.thumbnailUrl;
    }
    if (media?.prompt) panel.prompt = media.prompt;
    panelsByBeat.set(panel.beatId, [...(panelsByBeat.get(panel.beatId) ?? []), panel]);
  }

  const beatsByScene = new Map<string, StoryboardBeat[]>();
  for (const beatRow of beatRows) {
    const beat = mapStoryboardBeat(beatRow, panelsByBeat.get(beatRow.id) ?? []);
    beatsByScene.set(beat.sceneId, [...(beatsByScene.get(beat.sceneId) ?? []), beat]);
  }

  const sceneMedia = await resolveStoryboardMediaByAssetId(
    db,
    workspaceId,
    projectId,
    spineSceneRows
      .map((scene) => scene.scene_asset_id)
      .filter((id): id is string => Boolean(id))
  );

  return mapSpineStoryboard(
    project,
    storyBlueprintId,
    planAssetId,
    spineSceneRows.map((scene) => {
      const mapped = mapSpineScene(scene, beatsByScene.get(scene.id) ?? []);
      const media = scene.scene_asset_id ? sceneMedia.get(scene.scene_asset_id) : undefined;
      if (media?.url) {
        mapped.url = media.url;
        if (media.thumbnailUrl) mapped.thumbnailUrl = media.thumbnailUrl;
      }
      return mapped;
    })
  );
}

export async function getProjectStoryboardById(
  workspaceId: string,
  projectId: string,
  storyboardId: string
): Promise<ProjectStoryboard | null> {
  const db = getServiceSupabase();
  const project = await requireProjectRow(db, workspaceId, projectId);
  return hydrateProjectStoryboardById(db, project, workspaceId, projectId, storyboardId);
}

export async function getProjectStoryboardsForPlan(
  workspaceId: string,
  projectId: string,
  planAssetId: string
): Promise<ProjectStoryboard[]> {
  const db = getServiceSupabase();
  const project = await requireProjectRow(db, workspaceId, projectId);
  const [readyRows, legacyRows] = await Promise.all([
    runQuery(
      "store.getProjectStoryboardsForPlan ready",
      db
        .from("story_blueprints")
        .select("id")
        .eq("project_id", projectId)
        .contains("provenance", { planAssetId, handoffReady: true })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(10)
    ),
    // Pre-marker production storyboards remain eligible after the mutable
    // current pointer moves. Full handoff validation decides usability.
    runQuery(
      "store.getProjectStoryboardsForPlan legacy",
      db
        .from("story_blueprints")
        .select("id")
        .eq("project_id", projectId)
        .contains("provenance", { planAssetId })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(25)
    ),
  ]);
  const candidateIds = [
    ...((readyRows ?? []) as Array<{ id: string }>),
    ...((legacyRows ?? []) as Array<{ id: string }>),
  ].filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index);
  const storyboards: ProjectStoryboard[] = [];
  for (const row of candidateIds) {
    const storyboard = await hydrateProjectStoryboardById(
      db,
      project,
      workspaceId,
      projectId,
      row.id
    );
    if (storyboard) storyboards.push(storyboard);
  }
  // Keep the current plan-bound storyboard eligible even if it falls outside
  // the bounded marked/legacy candidate windows; full handoff validation still
  // decides whether it is usable.
  const legacyCurrentId = project.current_story_blueprint_id ?? null;
  if (legacyCurrentId && !storyboards.some((storyboard) => storyboard.id === legacyCurrentId)) {
    const legacyCurrent = await hydrateProjectStoryboardById(
      db,
      project,
      workspaceId,
      projectId,
      legacyCurrentId
    );
    if (legacyCurrent?.planAssetId === planAssetId) storyboards.push(legacyCurrent);
  }
  return storyboards;
}

export async function getProjectStoryboard(
  workspaceId: string,
  projectId: string
): Promise<ProjectStoryboard | null> {
  const db = getServiceSupabase();
  const project = await requireProjectRow(db, workspaceId, projectId);
  const storyBlueprintId = project.current_story_blueprint_id ?? null;
  if (!storyBlueprintId) return null;
  return hydrateProjectStoryboardById(db, project, workspaceId, projectId, storyBlueprintId);
}

// Field list must match the story_beats_require_snapshot trigger: a semantic
// change the trigger sees but this misses would hit check_violation on update.
function semanticBeatChanged(
  before: StoryboardBeatRow,
  after: SaveStoryboardBeatInput
): boolean {
  return (
    before.intent !== after.intent ||
    before.visual_description !== (after.visualDescription ?? null) ||
    before.dialogue_summary !== (after.dialogueSummary ?? null) ||
    before.narration !== (after.narration ?? null) ||
    before.duration_sec !== (after.durationSec ?? null) ||
    before.shot_type !== (after.shotType ?? null) ||
    before.camera !== (after.camera ?? null) ||
    before.framing !== (after.framing ?? null)
  );
}

async function nextBeatSnapshotAssetId(input: {
  db: SupabaseClient;
  workspaceId: string;
  projectId: string;
  existing: StoryboardBeatRow | undefined;
  beat: SaveStoryboardBeatInput;
}): Promise<string | null> {
  if (!input.existing?.beat_asset_id) return input.existing?.beat_asset_id ?? null;
  if (!semanticBeatChanged(input.existing, input.beat)) return input.existing.beat_asset_id;

  const previous = await dataAssetById(input.db, input.existing.beat_asset_id);
  const asset = await insertDataAsset({
    db: input.db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "beat",
    role: "beat_snapshot",
    content: {
      intent: input.beat.intent,
      visual_description: input.beat.visualDescription ?? null,
      dialogue_summary: input.beat.dialogueSummary ?? null,
      narration: input.beat.narration ?? null,
      duration_sec: input.beat.durationSec ?? null,
      shot_type: input.beat.shotType ?? null,
      camera: input.beat.camera ?? null,
      framing: input.beat.framing ?? null,
    },
    lineageId: previous?.lineage_id,
    version: previous ? previous.version + 1 : undefined,
  });
  return asset.id;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string | null | undefined, path: string): void {
  if (value && !UUID_RE.test(value)) {
    throw new ApiError("validation_failed", `${path} must be a UUID.`);
  }
}

// `assets.id` is a uuid column, so a caller-supplied id that isn't a UUID can
// never match a row — Postgres instead raises `22P02` (invalid input syntax for
// type uuid), which `runQuery` surfaces as an opaque `database_error`. Every
// asset-by-id read must treat a malformed id the same way it treats an
// absent-but-well-formed one, so callers get the typed precondition they
// self-heal against (e.g. character-anchor autocreate) instead of a hard
// failure. Used by every direct `.eq("id", assetId)` read below — throwing
// `notFound` where the reader throws on a missing row, returning early where it
// returns null.
export function isAssetIdShape(assetId: string): boolean {
  return UUID_RE.test(assetId);
}

async function assertStoryBlueprintIdAvailable(
  db: SupabaseClient,
  projectId: string,
  storyBlueprintId: string | null | undefined
): Promise<void> {
  assertUuid(storyBlueprintId, "id");
  if (!storyBlueprintId) return;
  const data = await runQuery(
    "store.assertStoryBlueprintIdAvailable",
    db.from("story_blueprints").select("id, project_id").eq("id", storyBlueprintId).maybeSingle()
  );
  if (data && (data as StoryBlueprintRow).project_id !== projectId) {
    throw new ApiError("validation_failed", "Story blueprint id belongs to another project.");
  }
}

async function assertStoryboardRowsAreWritable(input: {
  db: SupabaseClient;
  projectId: string;
  storyBlueprintId: string;
  storyboard: SaveStoryboardInput;
}): Promise<void> {
  const sceneIds = input.storyboard.scenes.map((scene) => scene.id);
  const beatIds = input.storyboard.scenes.flatMap((scene) =>
    scene.beats.map((beat) => beat.id)
  );
  for (const [index, scene] of input.storyboard.scenes.entries()) {
    assertUuid(scene.id, `scenes[${index}].id`);
    for (const [beatIndex, beat] of scene.beats.entries()) {
      assertUuid(beat.id, `scenes[${index}].beats[${beatIndex}].id`);
    }
  }

  if (sceneIds.length > 0) {
    const data = await runQuery(
      "store.assertStoryboardRowsAreWritable scenes",
      input.db
        .from("story_blueprint_scenes")
        .select("id, project_id, story_blueprint_id")
        .in("id", sceneIds)
    );
    for (const row of (data ?? []) as StorySpineSceneRow[]) {
      if (row.project_id !== input.projectId || row.story_blueprint_id !== input.storyBlueprintId) {
        throw new ApiError(
          "validation_failed",
          `Scene id belongs to another story blueprint: ${row.id}.`
        );
      }
    }
  }

  if (beatIds.length === 0) return;
  const beatsData = await runQuery(
    "store.assertStoryboardRowsAreWritable beats",
    input.db
      .from("story_beats")
      .select("id, project_id, scene_id")
      .in("id", beatIds)
  );
  const existingBeatRows = (beatsData ?? []) as Pick<
    StoryboardBeatRow,
    "id" | "project_id" | "scene_id"
  >[];
  const existingBeatSceneIds = [
    ...new Set(existingBeatRows.map((beat) => beat.scene_id)),
  ];
  const beatScenesData = existingBeatSceneIds.length
    ? await runQuery(
        "store.assertStoryboardRowsAreWritable beat scenes",
        input.db
          .from("story_blueprint_scenes")
          .select("id, project_id, story_blueprint_id")
          .in("id", existingBeatSceneIds)
      )
    : [];
  const sceneById = new Map(
    ((beatScenesData ?? []) as StorySpineSceneRow[]).map((scene) => [scene.id, scene])
  );
  for (const row of existingBeatRows) {
    const scene = sceneById.get(row.scene_id);
    if (
      row.project_id !== input.projectId ||
      !scene ||
      scene.project_id !== input.projectId ||
      scene.story_blueprint_id !== input.storyBlueprintId
    ) {
      throw new ApiError(
        "validation_failed",
        `Beat id belongs to another story blueprint: ${row.id}.`
      );
    }
  }
}

async function restoreStoryboardOrder(
  db: SupabaseClient,
  projectId: string,
  scenes: Array<{ id: string; sceneIndex: number }>,
  beats: Array<{ id: string; beatIndex: number }>
): Promise<void> {
  for (const scene of scenes) {
    await runQuery(
      "store.restoreStoryboardOrder scene",
      db
        .from("story_blueprint_scenes")
        .update({ position: scene.sceneIndex })
        .eq("project_id", projectId)
        .eq("id", scene.id)
    );
  }
  for (const beat of beats) {
    await runQuery(
      "store.restoreStoryboardOrder beat",
      db
        .from("story_beats")
        .update({ beat_index: beat.beatIndex })
        .eq("project_id", projectId)
        .eq("id", beat.id)
    );
  }
}

export async function saveProjectStoryboard(
  workspaceId: string,
  projectId: string,
  input: SaveStoryboardInput
): Promise<ProjectStoryboard> {
  const db = getServiceSupabase();
  const project = await requireProjectRow(db, workspaceId, projectId);
  const now = new Date().toISOString();
  await assertStoryBlueprintIdAvailable(db, projectId, input.id);
  let storyBlueprint = await getStoryBlueprintRow(
    db,
    projectId,
    input.id ?? project.current_story_blueprint_id ?? null
  );
  let storyBlueprintId = storyBlueprint?.id ?? null;
  let createdStoryBlueprintId: string | null = null;
  if (!storyBlueprint) {
    const createRow: Record<string, unknown> = {
      schema_version: "storyBlueprint.v1",
      workspace_id: workspaceId,
      project_id: projectId,
      status: input.status === "approved" ? "approved" : "draft",
      snapshot: markedContent("story_blueprint", {
        schemaVersion: "storyBlueprint.v1",
        title: project.name,
        characters: [],
        acts: [],
        scenes: [],
      }),
      provenance: markedJson("story_blueprint_provenance.v1", {
        source: "saveProjectStoryboard",
      }),
      created_by: markedJson("story_blueprint_creator.v1", {
        tool: "save_project_storyboard",
      }),
      created_at: now,
      updated_at: now,
    };
    const data = await runQuery(
      "store.saveProjectStoryboard create story blueprint",
      db
        .from("story_blueprints")
        .insert(createRow)
        .select("*")
        .single()
    );
    storyBlueprint = data as StoryBlueprintRow;
    storyBlueprintId = storyBlueprint.id;
    createdStoryBlueprintId = storyBlueprint.id;
    await runQuery(
      "store.saveProjectStoryboard current pointer",
      db
        .from("projects")
        .update({ current_story_blueprint_id: storyBlueprint.id })
        .eq("id", projectId)
        .eq("workspace_id", workspaceId)
    );
  }
  if (!storyBlueprintId) {
    throw new Error("story blueprint insert did not return an id");
  }
  try {
    await assertStoryboardRowsAreWritable({
      db,
      projectId,
      storyBlueprintId,
      storyboard: input,
    });
  } catch (error) {
    if (createdStoryBlueprintId) {
      try {
        await runQuery(
          "store.saveProjectStoryboard rollback current pointer",
          db
            .from("projects")
            .update({ current_story_blueprint_id: project.current_story_blueprint_id })
            .eq("id", projectId)
            .eq("workspace_id", workspaceId)
        );
        await runQuery(
          "store.saveProjectStoryboard rollback story blueprint",
          db
            .from("story_blueprints")
            .delete()
            .eq("id", createdStoryBlueprintId)
            .eq("project_id", projectId)
        );
      } catch {
        // Preserve the validation failure; rollback is best effort.
      }
    }
    throw error;
  }
  const actRows = await runQuery(
    "store.saveProjectStoryboard act lookup",
    db
      .from("story_blueprint_acts")
      .select("id")
      .eq("project_id", projectId)
      .eq("story_blueprint_id", storyBlueprintId)
      .order("position", { ascending: true })
      .limit(1)
  );
  let storyBlueprintActId = ((actRows as Array<{ id: string }>) ?? [])[0]?.id;
  if (!storyBlueprintActId) {
    const act = await runQuery(
      "store.saveProjectStoryboard create act",
      db
        .from("story_blueprint_acts")
        .insert({
          story_blueprint_id: storyBlueprintId,
          workspace_id: workspaceId,
          project_id: projectId,
          stable_id: "act_1",
          position: 0,
          title: "Act 1",
          purpose: "Storyboard",
          summary: "Storyboard scenes.",
          target_duration_sec: input.scenes.reduce(
            (total, scene) => total + (scene.durationSec ?? 0),
            0
          ),
          status: "draft",
        })
        .select("id")
        .single()
    );
    storyBlueprintActId = (act as { id: string }).id;
  }

  const current = await getProjectStoryboard(workspaceId, projectId);
  const existingScenes = new Map(
    (current?.scenes ?? []).map((scene) => [scene.id, scene])
  );
  const existingBeats = new Map<string, StoryboardBeatRow>();
  for (const scene of current?.scenes ?? []) {
    for (const beat of scene.beats) {
      existingBeats.set(beat.id, {
        id: beat.id,
        project_id: beat.projectId,
        scene_id: beat.sceneId,
        beat_index: beat.beatIndex,
        intent: beat.intent,
        visual_description: beat.visualDescription,
        dialogue_summary: beat.dialogueSummary,
        narration: beat.narration,
        duration_sec: beat.durationSec,
        shot_type: beat.shotType,
        camera: beat.camera,
        framing: beat.framing,
        status: beat.status,
        beat_asset_id: beat.beatAssetId,
        created_at: beat.createdAt,
        updated_at: beat.updatedAt,
      });
    }
  }

  const sceneRows = input.scenes.map((scene, index) => ({
    id: scene.id,
    story_blueprint_id: storyBlueprintId,
    story_blueprint_act_id: storyBlueprintActId,
    workspace_id: workspaceId,
    project_id: projectId,
    stable_id: scene.id,
    position: index,
    title: scene.title ?? `Scene ${index + 1}`,
    summary: scene.summary ?? "",
    setting: scene.setting ?? null,
    mood: scene.mood ?? null,
    target_duration_sec: scene.durationSec ?? 0,
    status: scene.status ?? "draft",
    updated_at: now,
  }));
  const beatRowsByScene = new Map<string, Record<string, unknown>[]>();
  for (const scene of input.scenes) {
    const beatRows = [];
    for (const [index, beat] of scene.beats.entries()) {
      const existing = existingBeats.get(beat.id);
      beatRows.push({
        id: beat.id,
        project_id: projectId,
        scene_id: scene.id,
        stable_id: beat.id,
        beat_index: index,
        intent: beat.intent,
        visual_description: beat.visualDescription ?? null,
        dialogue_summary: beat.dialogueSummary ?? null,
        narration: beat.narration ?? null,
        duration_sec: beat.durationSec ?? null,
        shot_type: beat.shotType ?? null,
        camera: beat.camera ?? null,
        framing: beat.framing ?? null,
        status: beat.status ?? "draft",
        beat_asset_id: await nextBeatSnapshotAssetId({
          db,
          workspaceId,
          projectId,
          existing,
          beat,
        }),
        updated_at: now,
      });
    }
    beatRowsByScene.set(scene.id, beatRows);
  }

  const sceneOrderBackup = (current?.scenes ?? []).map((scene) => ({
    id: scene.id,
    sceneIndex: scene.sceneIndex,
  }));
  const beatOrderBackup = (current?.scenes ?? []).flatMap((scene) =>
    scene.beats.map((beat) => ({ id: beat.id, beatIndex: beat.beatIndex }))
  );

  try {
    const keepSceneIds = new Set(input.scenes.map((scene) => scene.id));
    const keepBeatIds = new Set(
      input.scenes.flatMap((scene) => scene.beats.map((beat) => beat.id))
    );
    const removeSceneIds = [...existingScenes.keys()].filter((id) => !keepSceneIds.has(id));
    const removeBeatIds = [...existingBeats.keys()].filter((id) => !keepBeatIds.has(id));

    const existingSceneIds = [...existingScenes.keys()];
    if (existingSceneIds.length > 0) {
      const updates = existingSceneIds.map((id, index) =>
        db
          .from("story_blueprint_scenes")
          .update({ position: 10000 + index })
          .eq("project_id", projectId)
          .eq("id", id)
      );
      for (const update of updates) {
        await runQuery("store.saveProjectStoryboard offset scenes", update);
      }
    }

    for (const sceneRow of sceneRows) {
      if (existingScenes.has(sceneRow.id)) {
        await runQuery(
          "store.saveProjectStoryboard update scene",
          db
            .from("story_blueprint_scenes")
            .update(sceneRow)
            .eq("project_id", projectId)
            .eq("id", sceneRow.id)
        );
      } else {
        await runQuery(
          "store.saveProjectStoryboard insert scene",
          db.from("story_blueprint_scenes").insert(sceneRow)
        );
      }
    }

    const existingBeatIds = [...existingBeats.keys()];
    for (const [index, id] of existingBeatIds.entries()) {
      await runQuery(
        "store.saveProjectStoryboard offset beats",
        db
          .from("story_beats")
          .update({ beat_index: 10000 + index })
          .eq("project_id", projectId)
          .eq("id", id)
      );
    }

    for (const scene of input.scenes) {
      for (const beatRow of beatRowsByScene.get(scene.id) ?? []) {
        const id = String(beatRow.id);
        if (existingBeats.has(id)) {
          await runQuery(
            "store.saveProjectStoryboard update beat",
            db
              .from("story_beats")
              .update(beatRow)
              .eq("project_id", projectId)
              .eq("id", id)
          );
        } else {
          await runQuery(
            "store.saveProjectStoryboard insert beat",
            db.from("story_beats").insert(beatRow)
          );
        }
      }
    }

    if (removeBeatIds.length > 0) {
      await runQuery(
        "store.saveProjectStoryboard remove beats",
        db
          .from("story_beats")
          .delete()
          .eq("project_id", projectId)
          .in("id", removeBeatIds)
      );
    }
    if (removeSceneIds.length > 0) {
      await runQuery(
        "store.saveProjectStoryboard remove scenes",
        db
          .from("story_blueprint_scenes")
          .delete()
          .eq("project_id", projectId)
          .in("id", removeSceneIds)
      );
    }

    await runQuery(
      "store.saveProjectStoryboard update story blueprint",
      db
        .from("story_blueprints")
        .update({
          status: input.status === "approved" ? "approved" : storyBlueprint.status,
          updated_at: now,
        })
        .eq("project_id", projectId)
        .eq("id", storyBlueprint.id)
    );
  } catch (err) {
    await restoreStoryboardOrder(db, projectId, sceneOrderBackup, beatOrderBackup);
    throw err;
  }

  const saved = await getProjectStoryboard(workspaceId, projectId);
  if (!saved) throw notFound(`Story blueprint not found: ${storyBlueprint.id}`);
  return saved;
}
