import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetVisibility } from "@/lib/storage/config";
import type { ObjectStore } from "@/lib/storage/object-store";
import type { AssetEmbeddingProvider } from "./asset-embeddings/provider";
import type { CatalogEntryKind, CatalogEntryStatus } from "./schemas";

export type CatalogDb = Pick<SupabaseClient, "from" | "rpc">;

export const CATALOG_SCHEMA_VERSION = "catalogEntry.v1";
export const LOCAL_CATALOG_EMAIL = "local-catalog@popcornready.local";

// Public column projection: every catalog_entries column EXCEPT the heavy
// search_embedding vector (and its model/dims metadata). Reads never need the
// vector - ranking happens in SQL - so we avoid shipping 1536 floats per row.
export const CATALOG_COLUMNS =
  "id, schema_version, kind, status, publisher_user_id, source_workspace_id, source_project_id, source_asset_id, source_story_blueprint_id, title, summary, tags, preview_storage_key, preview_storage_bucket, preview_content_type, snapshot, use_count, like_count, created_at, updated_at" as const;

export interface CatalogEntryRow {
  id: string;
  schema_version: string;
  kind: CatalogEntryKind;
  status: CatalogEntryStatus;
  publisher_user_id: string;
  source_workspace_id: string | null;
  source_project_id: string | null;
  source_asset_id: string | null;
  source_story_blueprint_id: string | null;
  title: string;
  summary: string | null;
  tags: string[];
  preview_storage_key: string | null;
  preview_storage_bucket: string | null;
  preview_content_type: string | null;
  snapshot: Record<string, unknown>;
  use_count: number;
  like_count: number;
  created_at: string;
  updated_at: string;
}

export interface SourceAssetRow {
  id: string;
  workspace_id: string;
  project_id: string;
  kind: string;
  media: string;
  role: string | null;
  status: string;
  filename: string | null;
  storage_key: string | null;
  storage_bucket: string | null;
  remote_url: string | null;
  visibility: AssetVisibility;
  description: string | null;
  content: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  semantic_analysis: Record<string, unknown> | null;
}

export interface WorkspaceOwnerRow {
  owner_id: string | null;
}

export interface StoryBlueprintRow {
  id: string;
  workspace_id: string;
  project_id: string;
  brief_asset_id: string | null;
  asset_id: string | null;
  status: string;
  snapshot: Record<string, unknown>;
}

export interface StoryCharacterRow {
  stable_id: string;
  position: number;
  name: string;
  role: string;
  description: string;
}

export interface StoryActRow {
  id: string;
  stable_id: string;
  position: number;
  title: string;
  purpose: string;
  summary: string;
  target_duration_sec: number;
}

export interface StorySceneRow {
  stable_id: string;
  story_blueprint_act_id: string;
  position: number;
  title: string;
  summary: string;
  target_duration_sec: number;
}

export interface TargetProjectRow {
  id: string;
  workspace_id: string;
  visibility: AssetVisibility;
}

export interface CatalogEntry {
  id: string;
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  kind: CatalogEntryKind;
  status: CatalogEntryStatus;
  publisherUserId: string;
  sourceWorkspaceId: string | null;
  sourceProjectId: string | null;
  sourceAssetId: string | null;
  sourceStoryBlueprintId: string | null;
  title: string;
  summary: string | null;
  tags: string[];
  previewUrl?: string;
  previewStorageKey: string | null;
  previewStorageBucket: string | null;
  previewContentType: string | null;
  snapshot: Record<string, unknown>;
  useCount: number;
  likeCount: number;
  viewerHasLiked?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogPage {
  items: CatalogEntry[];
  nextCursor: string | null;
}

export interface CatalogDeps {
  db?: CatalogDb;
  store?: ObjectStore;
  embeddingProvider?: AssetEmbeddingProvider;
}
