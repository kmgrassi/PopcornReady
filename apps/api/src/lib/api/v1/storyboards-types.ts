import type { StoryboardSearchChunkKind } from "./storyboard-search-chunks";

export type StoryboardStatus =
  | "draft"
  | "generating"
  | "ready"
  | "reviewing"
  | "approved"
  | "archived";

export type StoryboardItemStatus =
  | "draft"
  | "queued"
  | "generating"
  | "ready"
  | "approved"
  | "rejected"
  | "failed";

export interface StoryboardRow {
  id: string;
  project_id: string;
  plan_asset_id: string | null;
  status: StoryboardStatus;
  created_by_action_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoryboardSceneRow {
  id: string;
  project_id: string;
  storyboard_id: string;
  scene_index: number;
  title: string | null;
  summary: string | null;
  setting: string | null;
  mood: string | null;
  duration_sec: number | null;
  scene_asset_id: string | null;
  status: StoryboardItemStatus;
  created_at: string;
  updated_at: string;
}

export interface StoryboardBeatRow {
  id: string;
  project_id: string;
  scene_id: string;
  beat_index: number;
  intent: string;
  visual_description: string | null;
  dialogue_summary: string | null;
  narration: string | null;
  duration_sec: number | null;
  status: StoryboardItemStatus;
  beat_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoryboardPanelRow {
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

export interface BeatAssetRow {
  id: string;
  lineage_id: string;
  version: number;
}

export interface StoryboardSearchChunkRow {
  chunk_key: string;
  chunk_kind: StoryboardSearchChunkKind;
  source_hash: string;
  source_text: string;
  project_id: string;
  storyboard_id: string;
  scene_id: string | null;
  beat_id: string | null;
  scene_index: number | null;
  beat_index: number | null;
  linked_asset_id: string | null;
  rank: number;
}

export interface Storyboard {
  id: string;
  projectId: string;
  planAssetId: string | null;
  status: StoryboardStatus;
  createdByActionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardScene {
  id: string;
  projectId: string;
  storyboardId: string;
  sceneIndex: number;
  title: string | null;
  summary: string | null;
  setting: string | null;
  mood: string | null;
  durationSec: number | null;
  sceneAssetId: string | null;
  status: StoryboardItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardBeat {
  id: string;
  projectId: string;
  sceneId: string;
  beatIndex: number;
  intent: string;
  visualDescription: string | null;
  dialogueSummary: string | null;
  narration: string | null;
  durationSec: number | null;
  status: StoryboardItemStatus;
  beatAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardPanel {
  id: string;
  projectId: string;
  beatId: string;
  panelIndex: number;
  imageAssetId: string | null;
  promptAssetId: string | null;
  status: StoryboardItemStatus;
  isSelected: boolean;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardSearchResult {
  chunkKey: string;
  chunkKind: StoryboardSearchChunkKind;
  sourceHash: string;
  sourceText: string;
  projectId: string;
  storyboardId: string;
  sceneId: string | null;
  beatId: string | null;
  sceneIndex: number | null;
  beatIndex: number | null;
  linkedAssetId: string | null;
  rank: number;
}

export interface StoryboardInput {
  planAssetId?: string | null;
  status?: StoryboardStatus;
}

export interface SceneInput {
  sceneIndex?: number;
  title?: string | null;
  summary?: string | null;
  setting?: string | null;
  mood?: string | null;
  durationSec?: number | null;
  sceneAssetId?: string | null;
  status?: StoryboardItemStatus;
}

export interface BeatInput {
  beatIndex?: number;
  intent?: string;
  visualDescription?: string | null;
  dialogueSummary?: string | null;
  narration?: string | null;
  durationSec?: number | null;
  status?: StoryboardItemStatus;
  beatAssetId?: string | null;
}

export interface PanelInput {
  panelIndex?: number;
  imageAssetId?: string | null;
  promptAssetId?: string | null;
  status?: StoryboardItemStatus;
  isSelected?: boolean;
  approvedAt?: string | null;
}
