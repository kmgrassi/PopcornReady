import type {
  Storyboard,
  StoryboardBeat,
  StoryboardBeatRow,
  StoryboardPanel,
  StoryboardPanelRow,
  StoryboardRow,
  StoryboardScene,
  StoryboardSceneRow,
  StoryboardSearchChunkRow,
  StoryboardSearchResult,
} from "./storyboards-types";

function iso(value: string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return new Date(value).toISOString();
}

export function mapStoryboard(row: StoryboardRow): Storyboard {
  return {
    id: row.id,
    projectId: row.project_id,
    planAssetId: row.plan_asset_id,
    status: row.status,
    createdByActionId: row.created_by_action_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function mapScene(row: StoryboardSceneRow): StoryboardScene {
  return {
    id: row.id,
    projectId: row.project_id,
    storyboardId: row.storyboard_id,
    sceneIndex: row.scene_index,
    title: row.title,
    summary: row.summary,
    setting: row.setting,
    mood: row.mood,
    durationSec: row.duration_sec,
    sceneAssetId: row.scene_asset_id,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function mapBeat(row: StoryboardBeatRow): StoryboardBeat {
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
    status: row.status,
    beatAssetId: row.beat_asset_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function mapPanel(row: StoryboardPanelRow): StoryboardPanel {
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

export function mapSearchChunk(row: StoryboardSearchChunkRow): StoryboardSearchResult {
  return {
    chunkKey: row.chunk_key,
    chunkKind: row.chunk_kind,
    sourceHash: row.source_hash,
    sourceText: row.source_text,
    projectId: row.project_id,
    storyboardId: row.storyboard_id,
    sceneId: row.scene_id,
    beatId: row.beat_id,
    sceneIndex: row.scene_index,
    beatIndex: row.beat_index,
    linkedAssetId: row.linked_asset_id,
    rank: row.rank,
  };
}
