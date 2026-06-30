import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { assetEmbeddingConfig } from "./asset-embeddings/config";
import { defaultAssetEmbeddingProvider } from "./asset-embeddings/provider";
import { ApiError, notFound } from "./errors";
import { cloneAssetEntry, cloneStoryEntry, materializePreview } from "./catalog-clone";
import { mapCatalogEntry, pageResult } from "./catalog-mappers";
import { assetSnapshot, storySnapshot } from "./catalog-snapshots";
import {
  CATALOG_COLUMNS,
  CATALOG_SCHEMA_VERSION,
  LOCAL_CATALOG_EMAIL,
  type CatalogDeps,
  type CatalogEntry,
  type CatalogEntryRow,
  type CatalogPage,
  type TargetProjectRow,
  type WorkspaceOwnerRow,
} from "./catalog-types";
import { buildSearchText } from "./catalog-utils";
import type {
  CatalogEntryKind,
  PublishCatalogEntryInput,
  UpdateCatalogEntryInput,
  UseCatalogEntryInput,
} from "./schemas";

export type { CatalogDeps, CatalogEntry, CatalogPage } from "./catalog-types";

function dbFrom(deps?: CatalogDeps): SupabaseClient {
  return deps?.db ?? getServiceSupabase();
}

interface CatalogSearchEmbedding {
  literal: string;
  model: string;
  dims: number;
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => String(value)).join(",")}]`;
}

// Builds the catalog-owned search vector from an entry's CURATED PUBLIC text
// (title/summary/tags + snapshot.searchText) — never the source asset's own
// embedding, which encodes private internal text. Degrades to null (full-text
// only) when no OPENAI_API_KEY is set or the embed call fails, so publish/search
// never hard-fail on the embedding path.
async function embedCatalogSearchText(
  text: string,
  deps?: CatalogDeps
): Promise<CatalogSearchEmbedding | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!process.env.OPENAI_API_KEY?.trim()) return null;
  try {
    const config = assetEmbeddingConfig();
    const provider = deps?.embeddingProvider ?? defaultAssetEmbeddingProvider;
    const vector = await provider.embed({ text: trimmed, config });
    return { literal: vectorLiteral(vector), model: config.model, dims: config.dimensions };
  } catch {
    // Non-fatal: the full-text index still serves search without the vector.
    return null;
  }
}

function cursorOffset(cursor: string | null): number {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ApiError("validation_failed", "cursor must be a non-negative integer.");
  }
  return parsed;
}

export async function listCatalogEntries(input: {
  limit: number;
  cursor: string | null;
  kind?: CatalogEntryKind;
}, deps?: CatalogDeps): Promise<CatalogPage> {
  const db = dbFrom(deps);
  const offset = cursorOffset(input.cursor);
  let query = db
    .from("catalog_entries")
    .select(CATALOG_COLUMNS)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + input.limit);
  if (input.kind) query = query.eq("kind", input.kind);
  const rows = await runQuery("catalog.listCatalogEntries", query);
  return pageResult((rows as CatalogEntryRow[]) ?? [], input.limit, offset);
}

export async function searchCatalogEntries(input: {
  q: string;
  limit: number;
  cursor: string | null;
  kind?: CatalogEntryKind;
}, deps?: CatalogDeps): Promise<CatalogPage> {
  const db = dbFrom(deps);
  const offset = cursorOffset(input.cursor);
  // Embed the query against the same model/curated-text space as the entries.
  // When unavailable (no API key / embed failure) the RPC falls back to
  // full-text via its null query_embedding default.
  const queryEmbedding = await embedCatalogSearchText(input.q, deps);
  const rows = await runQuery(
    "catalog.searchCatalogEntries",
    db.rpc("search_public_catalog_entries", {
      search_query: input.q,
      kind_filter: input.kind ?? null,
      limit_count: input.limit + 1,
      offset_count: offset,
      query_embedding: queryEmbedding?.literal ?? null,
      query_model: queryEmbedding?.model ?? null,
    })
  );
  return pageResult((rows as CatalogEntryRow[]) ?? [], input.limit, offset);
}

export async function getCatalogEntry(
  entryId: string,
  deps?: CatalogDeps
): Promise<CatalogEntry> {
  const db = dbFrom(deps);
  const row = await runQuery(
    "catalog.getCatalogEntry",
    db
      .from("catalog_entries")
      .select(CATALOG_COLUMNS)
      .eq("id", entryId)
      .eq("status", "published")
      .maybeSingle()
  );
  if (!row) throw notFound(`Catalog entry not found: ${entryId}`);
  return mapCatalogEntry(row as CatalogEntryRow);
}

export async function listMyCatalogEntries(input: {
  publisherUserId: string;
  limit: number;
  cursor: string | null;
}, deps?: CatalogDeps): Promise<CatalogPage> {
  const db = dbFrom(deps);
  const offset = cursorOffset(input.cursor);
  const rows = await runQuery(
    "catalog.listMyCatalogEntries",
    db
      .from("catalog_entries")
      .select(CATALOG_COLUMNS)
      .eq("publisher_user_id", input.publisherUserId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + input.limit)
  );
  return pageResult((rows as CatalogEntryRow[]) ?? [], input.limit, offset);
}

export async function listLikedCatalogEntryIds(input: {
  userId: string;
  entryIds: string[];
}, deps?: CatalogDeps): Promise<string[]> {
  const uniqueEntryIds = Array.from(new Set(input.entryIds)).filter(Boolean);
  if (uniqueEntryIds.length === 0) return [];

  const rows = await runQuery(
    "catalog.listLikedCatalogEntryIds",
    dbFrom(deps)
      .from("catalog_entry_likes")
      .select("catalog_entry_id")
      .eq("user_id", input.userId)
      .in("catalog_entry_id", uniqueEntryIds)
  );
  return ((rows as Array<{ catalog_entry_id: string }>) ?? []).map(
    (row) => row.catalog_entry_id
  );
}

export async function likeCatalogEntry(input: {
  entryId: string;
  userId: string;
}, deps?: CatalogDeps): Promise<CatalogEntry> {
  const db = dbFrom(deps);
  await publishedCatalogEntryRow(db, input.entryId);
  await runQuery(
    "catalog.likeCatalogEntry",
    db.from("catalog_entry_likes").upsert(
      {
        catalog_entry_id: input.entryId,
        user_id: input.userId,
      },
      { onConflict: "catalog_entry_id,user_id", ignoreDuplicates: true }
    )
  );
  const row = await publishedCatalogEntryRow(db, input.entryId);
  return mapCatalogEntry(row, { viewerLikedEntryIds: new Set([input.entryId]) });
}

export async function unlikeCatalogEntry(input: {
  entryId: string;
  userId: string;
}, deps?: CatalogDeps): Promise<CatalogEntry> {
  const db = dbFrom(deps);
  await runQuery(
    "catalog.unlikeCatalogEntry",
    db
      .from("catalog_entry_likes")
      .delete()
      .eq("catalog_entry_id", input.entryId)
      .eq("user_id", input.userId)
  );
  const row = await publishedCatalogEntryRow(db, input.entryId);
  return mapCatalogEntry(row, { viewerLikedEntryIds: new Set() });
}

export async function publishCatalogEntry(input: {
  authWorkspaceId: string;
  // Attribute the entry to this workspace's owner instead of authWorkspaceId.
  // Lets the system publisher own AI-generated entries while the source asset is
  // still read from the run's (authWorkspaceId) workspace. Defaults to
  // authWorkspaceId (the normal user-publishes-their-own-asset case).
  publisherWorkspaceId?: string;
  body: PublishCatalogEntryInput;
}, deps?: CatalogDeps): Promise<CatalogEntry> {
  const db = dbFrom(deps);
  const publisherUserId = await publisherUserIdForWorkspace(
    db,
    input.publisherWorkspaceId ?? input.authWorkspaceId
  );
  const snapshot =
    input.body.kind === "story"
      ? await storySnapshot(db, input.authWorkspaceId, input.body.sourceStoryBlueprintId!)
      : await assetSnapshot(db, input.authWorkspaceId, input.body.sourceAssetId!, input.body.kind);
  const source = snapshot.source;
  const searchText = buildSearchText([
    input.body.title,
    input.body.summary,
    ...input.body.tags,
    snapshot.searchText,
  ]);
  const embedding = await embedCatalogSearchText(searchText, deps);
  const row = await runQuery(
    "catalog.publishCatalogEntry",
    db
      .from("catalog_entries")
      .insert({
        schema_version: CATALOG_SCHEMA_VERSION,
        kind: input.body.kind,
        status: input.body.kind === "story" ? input.body.status : "draft",
        publisher_user_id: publisherUserId,
        source_workspace_id: source.workspaceId,
        source_project_id: source.projectId,
        source_asset_id: source.assetId,
        source_story_blueprint_id: source.storyBlueprintId,
        title: input.body.title,
        summary: input.body.summary ?? null,
        tags: input.body.tags,
        snapshot: {
          schema_version: "catalogEntrySnapshot.v1",
          ...snapshot.body,
          searchText,
        },
        search_embedding: embedding?.literal ?? null,
        search_model: embedding?.model ?? null,
        search_dims: embedding?.dims ?? null,
      })
      .select(CATALOG_COLUMNS)
      .single()
  );
  const inserted = row as CatalogEntryRow;
  if (input.body.kind === "story") {
    return mapCatalogEntry(inserted);
  }

  let preview: { storageKey: string; storageBucket: string; contentType: string };
  try {
    preview = await materializePreview({
      db,
      entryId: inserted.id,
      workspaceId: input.authWorkspaceId,
      sourceAssetId: input.body.sourceAssetId!,
      store: deps?.store,
    });
  } catch (error) {
    try {
      await runQuery(
        "catalog.publishCatalogEntry cleanup",
        db.from("catalog_entries").delete().eq("id", inserted.id)
      );
    } catch {
      // Preserve the publish failure; cleanup is best effort.
    }
    throw error;
  }
  const updated = await runQuery(
    "catalog.publishCatalogEntry preview",
    db
      .from("catalog_entries")
      .update({
        status: input.body.status,
        preview_storage_key: preview.storageKey,
        preview_storage_bucket: preview.storageBucket,
        preview_content_type: preview.contentType,
      })
      .eq("id", inserted.id)
      .select(CATALOG_COLUMNS)
      .single()
  );
  return mapCatalogEntry(updated as CatalogEntryRow);
}

export async function updateCatalogEntry(input: {
  entryId: string;
  publisherUserId: string;
  body: UpdateCatalogEntryInput;
}, deps?: CatalogDeps): Promise<CatalogEntry> {
  const db = dbFrom(deps);
  const existing = await ownedCatalogEntryRow(db, input.entryId, input.publisherUserId);
  const patch: Record<string, unknown> = {};
  if (input.body.title !== undefined) patch.title = input.body.title;
  if (input.body.summary !== undefined) patch.summary = input.body.summary;
  if (input.body.tags !== undefined) patch.tags = input.body.tags;
  if (input.body.status !== undefined) patch.status = input.body.status;

  const nextTitle = (patch.title as string | undefined) ?? existing.title;
  const nextSummary =
    patch.summary !== undefined ? (patch.summary as string | null) : existing.summary;
  const nextTags = (patch.tags as string[] | undefined) ?? existing.tags ?? [];
  const { searchText: _oldSearchText, ...snapshotWithoutSearchText } = existing.snapshot;
  void _oldSearchText;
  const searchText = buildSearchText([
    nextTitle,
    nextSummary ?? undefined,
    ...nextTags,
    JSON.stringify(snapshotWithoutSearchText),
  ]);
  patch.snapshot = {
    ...snapshotWithoutSearchText,
    searchText,
  };
  // Re-embed the curated text so the vector tracks edits. Degrades to null
  // (full-text only) when embedding is unavailable.
  const embedding = await embedCatalogSearchText(searchText, deps);
  patch.search_embedding = embedding?.literal ?? null;
  patch.search_model = embedding?.model ?? null;
  patch.search_dims = embedding?.dims ?? null;

  const row = await runQuery(
    "catalog.updateCatalogEntry",
    db
      .from("catalog_entries")
      .update(patch)
      .eq("id", input.entryId)
      .eq("publisher_user_id", input.publisherUserId)
      .select(CATALOG_COLUMNS)
      .single()
  );
  return mapCatalogEntry(row as CatalogEntryRow);
}

export async function archiveCatalogEntry(input: {
  entryId: string;
  publisherUserId: string;
}, deps?: CatalogDeps): Promise<CatalogEntry> {
  return updateCatalogEntry(
    {
      entryId: input.entryId,
      publisherUserId: input.publisherUserId,
      body: { status: "archived" },
    },
    deps
  );
}

export async function useCatalogEntry(input: {
  authWorkspaceId: string;
  entryId: string;
  body: UseCatalogEntryInput;
}, deps?: CatalogDeps): Promise<{
  catalogEntry: CatalogEntry;
  asset?: Record<string, unknown>;
  storyBlueprint?: Record<string, unknown>;
}> {
  const db = dbFrom(deps);
  const entry = await publishedCatalogEntryRow(db, input.entryId);
  const targetProject = await targetProjectRow(
    db,
    input.authWorkspaceId,
    input.body.targetProjectId
  );
  const result =
    entry.kind === "story"
      ? await cloneStoryEntry(db, entry, targetProject)
      : await cloneAssetEntry(db, entry, targetProject, deps);
  const updated = await incrementUseCount(db, entry.id);
  return { catalogEntry: await mapCatalogEntry(updated), ...result };
}

export async function publisherUserIdForWorkspace(
  db: SupabaseClient,
  workspaceId: string
): Promise<string> {
  const workspace = await runQuery(
    "catalog.publisherUserIdForWorkspace workspace",
    db.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle()
  );
  const ownerId = (workspace as WorkspaceOwnerRow | null)?.owner_id;
  if (ownerId) return ownerId;

  const existing = await runQuery(
    "catalog.publisherUserIdForWorkspace existing local user",
    db.from("users").select("id").eq("email", LOCAL_CATALOG_EMAIL).maybeSingle()
  );
  if ((existing as { id: string } | null)?.id) return (existing as { id: string }).id;

  const inserted = await runQuery(
    "catalog.publisherUserIdForWorkspace insert local user",
    db
      .from("users")
      .insert({ email: LOCAL_CATALOG_EMAIL, full_name: "Local Catalog Publisher" })
      .select("id")
      .single()
  );
  return (inserted as { id: string }).id;
}

async function ownedCatalogEntryRow(
  db: SupabaseClient,
  entryId: string,
  publisherUserId: string
): Promise<CatalogEntryRow> {
  const row = await runQuery(
    "catalog.ownedCatalogEntryRow",
    db
      .from("catalog_entries")
      .select(CATALOG_COLUMNS)
      .eq("id", entryId)
      .eq("publisher_user_id", publisherUserId)
      .maybeSingle()
  );
  if (!row) throw notFound(`Catalog entry not found: ${entryId}`);
  return row as CatalogEntryRow;
}

async function publishedCatalogEntryRow(
  db: SupabaseClient,
  entryId: string
): Promise<CatalogEntryRow> {
  const row = await runQuery(
    "catalog.publishedCatalogEntryRow",
    db
      .from("catalog_entries")
      .select(CATALOG_COLUMNS)
      .eq("id", entryId)
      .eq("status", "published")
      .maybeSingle()
  );
  if (!row) throw notFound(`Catalog entry not found: ${entryId}`);
  return row as CatalogEntryRow;
}

async function targetProjectRow(
  db: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<TargetProjectRow> {
  const row = await runQuery(
    "catalog.targetProjectRow",
    db
      .from("projects")
      .select("id,workspace_id,visibility")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!row) throw notFound(`Project not found: ${projectId}`);
  return row as TargetProjectRow;
}

async function incrementUseCount(
  db: SupabaseClient,
  entryId: string
): Promise<CatalogEntryRow> {
  const current = await runQuery(
    "catalog.incrementUseCount read",
    db.from("catalog_entries").select("use_count").eq("id", entryId).single()
  );
  const next = ((current as { use_count: number }).use_count ?? 0) + 1;
  return (await runQuery(
    "catalog.incrementUseCount update",
    db
      .from("catalog_entries")
      .update({ use_count: next })
      .eq("id", entryId)
      .select(CATALOG_COLUMNS)
      .single()
  )) as CatalogEntryRow;
}

export { buildCatalogAssetSource, buildSearchText } from "./catalog-utils";
