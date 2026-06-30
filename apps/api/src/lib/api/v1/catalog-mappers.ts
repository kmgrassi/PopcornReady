import { resolveAssetUrl } from "@/lib/storage/asset-urls";
import { iso } from "./store-internal";
import {
  CATALOG_SCHEMA_VERSION,
  type CatalogEntry,
  type CatalogEntryRow,
  type CatalogPage,
} from "./catalog-types";

export async function mapCatalogEntry(
  row: CatalogEntryRow,
  options: { viewerLikedEntryIds?: Set<string> } = {}
): Promise<CatalogEntry> {
  const entry: CatalogEntry = {
    id: row.id,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    kind: row.kind,
    status: row.status,
    publisherUserId: row.publisher_user_id,
    sourceWorkspaceId: row.source_workspace_id,
    sourceProjectId: row.source_project_id,
    sourceAssetId: row.source_asset_id,
    sourceStoryBlueprintId: row.source_story_blueprint_id,
    title: row.title,
    summary: row.summary,
    tags: row.tags ?? [],
    previewStorageKey: row.preview_storage_key,
    previewStorageBucket: row.preview_storage_bucket,
    previewContentType: row.preview_content_type,
    snapshot: row.snapshot ?? {},
    useCount: row.use_count,
    likeCount: row.like_count,
    viewerHasLiked: options.viewerLikedEntryIds?.has(row.id),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  const previewUrl = await resolveCatalogPreviewUrl(row);
  if (previewUrl) entry.previewUrl = previewUrl;
  return entry;
}

async function resolveCatalogPreviewUrl(row: CatalogEntryRow): Promise<string | undefined> {
  if (!row.preview_storage_key || !row.preview_storage_bucket) return undefined;
  return resolveAssetUrl({
    remote_url: null,
    storage_key: row.preview_storage_key,
    storage_bucket: row.preview_storage_bucket,
    visibility: "public",
  });
}

export async function mapCatalogEntries(
  rows: CatalogEntryRow[],
  options: { viewerLikedEntryIds?: Set<string> } = {}
): Promise<CatalogEntry[]> {
  return Promise.all(rows.map((row) => mapCatalogEntry(row, options)));
}

function pageFromRows(rows: CatalogEntryRow[], limit: number, offset: number): CatalogPage {
  return {
    items: [],
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  };
}

export async function pageResult(
  rows: CatalogEntryRow[],
  limit: number,
  offset: number
): Promise<CatalogPage> {
  const base = pageFromRows(rows, limit, offset);
  return { ...base, items: await mapCatalogEntries(rows.slice(0, limit)) };
}
