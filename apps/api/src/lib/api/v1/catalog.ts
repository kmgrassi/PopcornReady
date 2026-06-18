import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { assetStorageKey, contentTypeForFilename } from "@/lib/storage/asset-write";
import { resolveAssetUrl } from "@/lib/storage/asset-urls";
import {
  readStorageConfig,
  visibilityForBucket,
  type AssetVisibility,
} from "@/lib/storage/config";
import { createObjectStore, type ObjectStore } from "@/lib/storage/object-store";
import { canonicalContentHash, inputsFingerprint } from "./asset-graph";
import { ApiError, notFound } from "./errors";
import { defaultVisibilityForWorkspace, type StoryBlueprint } from "./store";
import { iso, markedJson } from "./store-internal";
import type {
  CatalogEntryKind,
  CatalogEntryStatus,
  PublishCatalogEntryInput,
  UpdateCatalogEntryInput,
  UseCatalogEntryInput,
} from "./schemas";

const CATALOG_SCHEMA_VERSION = "catalogEntry.v1";
const LOCAL_CATALOG_EMAIL = "local-catalog@popcornready.local";

interface CatalogEntryRow {
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
  created_at: string;
  updated_at: string;
}

interface SourceAssetRow {
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

interface WorkspaceOwnerRow {
  owner_id: string | null;
}

interface StoryBlueprintRow {
  id: string;
  workspace_id: string;
  project_id: string;
  brief_asset_id: string | null;
  asset_id: string | null;
  status: string;
  snapshot: Record<string, unknown>;
}

interface StoryCharacterRow {
  stable_id: string;
  position: number;
  name: string;
  role: string;
  description: string;
}

interface StoryActRow {
  id: string;
  stable_id: string;
  position: number;
  title: string;
  purpose: string;
  summary: string;
  target_duration_sec: number;
}

interface StorySceneRow {
  stable_id: string;
  story_blueprint_act_id: string;
  position: number;
  title: string;
  summary: string;
  target_duration_sec: number;
}

interface TargetProjectRow {
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
  createdAt: string;
  updatedAt: string;
}

export interface CatalogPage {
  items: CatalogEntry[];
  nextCursor: string | null;
}

export interface CatalogDeps {
  db?: SupabaseClient;
  store?: ObjectStore;
}

function dbFrom(deps?: CatalogDeps): SupabaseClient {
  return deps?.db ?? getServiceSupabase();
}

function cursorOffset(cursor: string | null): number {
  if (!cursor) return 0;
  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ApiError("validation_failed", "cursor must be a non-negative integer.");
  }
  return parsed;
}

async function mapCatalogEntry(row: CatalogEntryRow): Promise<CatalogEntry> {
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

async function mapCatalogEntries(rows: CatalogEntryRow[]): Promise<CatalogEntry[]> {
  return Promise.all(rows.map(mapCatalogEntry));
}

function pageFromRows(rows: CatalogEntryRow[], limit: number, offset: number): CatalogPage {
  return {
    items: [],
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  };
}

async function pageResult(
  rows: CatalogEntryRow[],
  limit: number,
  offset: number
): Promise<CatalogPage> {
  const base = pageFromRows(rows, limit, offset);
  return { ...base, items: await mapCatalogEntries(rows.slice(0, limit)) };
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
    .select("*")
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
  const rows = await runQuery(
    "catalog.searchCatalogEntries",
    db.rpc("search_public_catalog_entries", {
      search_query: input.q,
      kind_filter: input.kind ?? null,
      limit_count: input.limit + 1,
      offset_count: offset,
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
      .select("*")
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
      .select("*")
      .eq("publisher_user_id", input.publisherUserId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + input.limit)
  );
  return pageResult((rows as CatalogEntryRow[]) ?? [], input.limit, offset);
}

export async function publishCatalogEntry(input: {
  authWorkspaceId: string;
  body: PublishCatalogEntryInput;
}, deps?: CatalogDeps): Promise<CatalogEntry> {
  const db = dbFrom(deps);
  const id = randomUUID();
  const publisherUserId = await publisherUserIdForWorkspace(db, input.authWorkspaceId);
  const snapshot =
    input.body.kind === "story"
      ? await storySnapshot(db, input.authWorkspaceId, input.body.sourceStoryBlueprintId!)
      : await assetSnapshot(db, input.authWorkspaceId, input.body.sourceAssetId!, input.body.kind);
  const preview =
    input.body.kind === "story"
      ? null
      : await materializePreview({
          db,
          entryId: id,
          workspaceId: input.authWorkspaceId,
          sourceAssetId: input.body.sourceAssetId!,
          store: deps?.store,
        });

  const source = snapshot.source;
  const row = await runQuery(
    "catalog.publishCatalogEntry",
    db
      .from("catalog_entries")
      .insert({
        id,
        schema_version: CATALOG_SCHEMA_VERSION,
        kind: input.body.kind,
        status: input.body.status,
        publisher_user_id: publisherUserId,
        source_workspace_id: source.workspaceId,
        source_project_id: source.projectId,
        source_asset_id: source.assetId,
        source_story_blueprint_id: source.storyBlueprintId,
        title: input.body.title,
        summary: input.body.summary ?? null,
        tags: input.body.tags,
        preview_storage_key: preview?.storageKey ?? null,
        preview_storage_bucket: preview?.storageBucket ?? null,
        preview_content_type: preview?.contentType ?? null,
        snapshot: {
          schema_version: "catalogEntrySnapshot.v1",
          ...snapshot.body,
          searchText: buildSearchText([
            input.body.title,
            input.body.summary,
            ...input.body.tags,
            snapshot.searchText,
          ]),
        },
      })
      .select("*")
      .single()
  );
  return mapCatalogEntry(row as CatalogEntryRow);
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
  patch.snapshot = {
    ...snapshotWithoutSearchText,
    searchText: buildSearchText([
      nextTitle,
      nextSummary ?? undefined,
      ...nextTags,
      JSON.stringify(snapshotWithoutSearchText),
    ]),
  };

  const row = await runQuery(
    "catalog.updateCatalogEntry",
    db
      .from("catalog_entries")
      .update(patch)
      .eq("id", input.entryId)
      .eq("publisher_user_id", input.publisherUserId)
      .select("*")
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
      .select("*")
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
      .select("*")
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
      .select("*")
      .single()
  )) as CatalogEntryRow;
}

async function cloneAssetEntry(
  db: SupabaseClient,
  entry: CatalogEntryRow,
  project: TargetProjectRow,
  deps?: CatalogDeps
): Promise<{ asset: Record<string, unknown> }> {
  if (!entry.preview_storage_key || !entry.preview_storage_bucket) {
    throw new ApiError("asset_invalid", "Catalog entry has no preview object to copy.");
  }
  const config = readStorageConfig();
  const store = deps?.store ?? createObjectStore(config);
  const assetId = randomUUID();
  const filename = path.basename(
    stringValue(recordValue(entry.snapshot.asset).filename) ?? `${entry.kind}-anchor.png`
  );
  const assetVisibility = await defaultVisibilityForWorkspace(db, project.workspace_id);
  const destinationVisibility =
    assetVisibility === "private" || project.visibility === "private" ? "private" : "public";
  const copied = await store.copyObject({
    sourceKey: entry.preview_storage_key,
    sourceVisibility: visibilityForBucket(config, entry.preview_storage_bucket),
    destinationKey: assetStorageKey({
      workspaceId: project.workspace_id,
      projectId: project.id,
      assetId,
      filename,
    }),
    destinationVisibility,
    contentType: entry.preview_content_type ?? contentTypeForFilename(filename),
  });
  const now = new Date().toISOString();
  const inserted = await runQuery(
    "catalog.cloneAssetEntry",
    db
      .from("assets")
      .insert({
        id: assetId,
        schema_version: "asset.v2",
        workspace_id: project.workspace_id,
        project_id: project.id,
        kind: "anchor",
        media: "image",
        status: "ready",
        role: entry.kind === "character" ? "character_anchor" : "scene_anchor",
        filename,
        storage_key: copied.key,
        storage_bucket: copied.bucket,
        source: buildCatalogAssetSource({
          catalogEntryId: entry.id,
          sourceAssetId: entry.source_asset_id,
        }),
        description: entry.summary,
        context: {
          userContext: {
            title: entry.title,
            description: entry.summary ?? undefined,
            tags: entry.tags,
            intendedUse:
              entry.kind === "character"
                ? ["character_reference"]
                : ["style_reference"],
          },
        },
        inputs: [],
        inputs_fingerprint: inputsFingerprint([], null),
        visibility: assetVisibility,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single()
  );
  return { asset: inserted as Record<string, unknown> };
}

async function cloneStoryEntry(
  db: SupabaseClient,
  entry: CatalogEntryRow,
  project: TargetProjectRow
): Promise<{ storyBlueprint: Record<string, unknown> }> {
  const blueprint = storyBlueprintFromCatalogEntry(entry);
  const action = await runQuery(
    "catalog.cloneStoryEntry action",
    db
      .from("actions")
      .insert({
        schema_version: "action.v1",
        project_id: project.id,
        tool: "use_catalog_entry",
        status: "running",
        params: markedJson("action_params.v1", {
          catalogEntryId: entry.id,
          sourceStoryBlueprintId: entry.source_story_blueprint_id,
        }),
        input_asset_ids: [],
        output_asset_ids: [],
        rationale: "Clone a published story anchor into this project.",
      })
      .select("*")
      .single()
  );
  const actionId = (action as { id: string }).id;
  const content = { schema_version: "story_blueprint", ...blueprint };
  const now = new Date().toISOString();
  const storyAsset = await runQuery(
    "catalog.cloneStoryEntry asset",
    db
      .from("assets")
      .insert({
        schema_version: "asset.v2",
        workspace_id: project.workspace_id,
        project_id: project.id,
        kind: "story_blueprint",
        media: "data",
        status: "ready",
        role: "current_story_blueprint",
        content,
        content_hash: canonicalContentHash(content),
        inputs: [],
        inputs_fingerprint: inputsFingerprint([], null),
        source: buildCatalogAssetSource({
          catalogEntryId: entry.id,
          sourceStoryBlueprintId: entry.source_story_blueprint_id,
        }),
        visibility: await defaultVisibilityForWorkspace(db, project.workspace_id),
        created_by_action_id: actionId,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single()
  );
  const storyAssetId = (storyAsset as { id: string }).id;
  const cloned = await runQuery(
    "catalog.cloneStoryEntry blueprint",
    db
      .from("story_blueprints")
      .insert({
        schema_version: "storyBlueprint.v1",
        workspace_id: project.workspace_id,
        project_id: project.id,
        brief_asset_id: null,
        asset_id: storyAssetId,
        status: "draft",
        snapshot: { schema_version: "story_blueprint", ...blueprint },
        provenance: markedJson("story_blueprint_provenance.v1", {
          via: "catalog",
          catalogEntryId: entry.id,
          sourceStoryBlueprintId: entry.source_story_blueprint_id,
          outputAssetId: storyAssetId,
        }),
        created_by: markedJson("story_blueprint_creator.v1", {
          actionId,
          tool: "use_catalog_entry",
        }),
      })
      .select("*")
      .single()
  );
  const clonedBlueprintId = (cloned as { id: string }).id;
  await cloneStoryChildrenFromSnapshot(
    db,
    blueprint,
    clonedBlueprintId,
    project.workspace_id,
    project.id
  );
  await runQuery(
    "catalog.cloneStoryEntry selection",
    db.from("selections").insert({
      project_id: project.id,
      slot_owner_lineage_id: null,
      slot_role: "story_blueprint",
      active_asset_id: storyAssetId,
      set_by_action_id: actionId,
    })
  );
  await runQuery(
    "catalog.cloneStoryEntry projectPointer",
    db.from("projects").update({ current_story_blueprint_id: clonedBlueprintId }).eq("id", project.id)
  );
  await runQuery(
    "catalog.cloneStoryEntry actionOutputs",
    db
      .from("actions")
      .update({ status: "applied", output_asset_ids: [storyAssetId] })
      .eq("id", actionId)
  );
  return { storyBlueprint: cloned as Record<string, unknown> };
}

async function sourceAssetRow(
  db: SupabaseClient,
  workspaceId: string,
  assetId: string
): Promise<SourceAssetRow> {
  const row = await runQuery(
    "catalog.sourceAssetRow",
    db
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!row) throw notFound(`Source asset not found: ${assetId}`);
  return row as SourceAssetRow;
}

async function assetSnapshot(
  db: SupabaseClient,
  workspaceId: string,
  sourceAssetId: string,
  kind: "character" | "image"
): Promise<{
  source: {
    workspaceId: string;
    projectId: string;
    assetId: string;
    storyBlueprintId: null;
  };
  body: Record<string, unknown>;
  searchText: string;
}> {
  const asset = await sourceAssetRow(db, workspaceId, sourceAssetId);
  if (asset.media !== "image") {
    throw new ApiError("asset_invalid", "Catalog character and image entries require an image asset.");
  }
  if (kind === "character" && asset.kind !== "anchor") {
    throw new ApiError("asset_invalid", "Character catalog entries require an anchor asset.");
  }
  const context = asset.context ?? {};
  const userContext = recordValue(context.userContext);
  const agentContext = recordValue(context.agentContext);
  const summary = stringValue(userContext.description) ??
    stringValue(agentContext.summary) ??
    stringValue(context.summary) ??
    asset.description ??
    undefined;
  const tags = stringArrayValue(userContext.tags);
  const searchText = buildSearchText([
    asset.filename ?? undefined,
    asset.role ?? undefined,
    summary,
    ...(tags ?? []),
    JSON.stringify(asset.semantic_analysis ?? {}),
  ]);
  return {
    source: {
      workspaceId: asset.workspace_id,
      projectId: asset.project_id,
      assetId: asset.id,
      storyBlueprintId: null,
    },
    body: {
      kind,
      source: "asset",
      asset: {
        id: asset.id,
        filename: asset.filename,
        role: asset.role,
        summary,
        tags: tags ?? [],
        contentType: contentTypeForFilename(asset.filename ?? "anchor.png"),
      },
    },
    searchText,
  };
}

async function storySnapshot(
  db: SupabaseClient,
  workspaceId: string,
  sourceStoryBlueprintId: string
): Promise<{
  source: {
    workspaceId: string;
    projectId: string;
    assetId: null;
    storyBlueprintId: string;
  };
  body: Record<string, unknown>;
  searchText: string;
}> {
  const blueprint = await runQuery(
    "catalog.storySnapshot blueprint",
    db
      .from("story_blueprints")
      .select("*")
      .eq("id", sourceStoryBlueprintId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!blueprint) throw notFound(`Source story blueprint not found: ${sourceStoryBlueprintId}`);
  const row = blueprint as StoryBlueprintRow;
  const [characters, acts, scenes] = await Promise.all([
    runQuery(
      "catalog.storySnapshot characters",
      db
        .from("story_blueprint_characters")
        .select("stable_id,position,name,role,description")
        .eq("story_blueprint_id", row.id)
        .order("position", { ascending: true })
    ),
    runQuery(
      "catalog.storySnapshot acts",
      db
        .from("story_blueprint_acts")
        .select("id,stable_id,position,title,purpose,summary,target_duration_sec")
        .eq("story_blueprint_id", row.id)
        .order("position", { ascending: true })
    ),
    runQuery(
      "catalog.storySnapshot scenes",
      db
        .from("story_blueprint_scenes")
        .select("stable_id,story_blueprint_act_id,position,title,summary,target_duration_sec")
        .eq("story_blueprint_id", row.id)
        .order("position", { ascending: true })
    ),
  ]);
  const snapshot = unmarked(row.snapshot);
  const logline =
    stringValue(snapshot.logline) ??
    stringValue(snapshot.summary) ??
    stringValue(snapshot.goal);
  const body = {
    kind: "story",
    source: "story_blueprint",
    story: {
      id: row.id,
      status: row.status,
      logline,
      snapshot,
      characters: (characters as StoryCharacterRow[]).map((character) => ({
        id: character.stable_id,
        name: character.name,
        role: character.role,
        description: character.description,
      })),
      acts: (acts as StoryActRow[]).map((act) => ({
        id: act.stable_id,
        title: act.title,
        purpose: act.purpose,
        summary: act.summary,
        targetDurationSec: act.target_duration_sec,
      })),
      scenes: (scenes as StorySceneRow[]).map((scene) => {
        const act = (acts as StoryActRow[]).find(
          (candidate) => candidate.id === scene.story_blueprint_act_id
        );
        return {
          id: scene.stable_id,
          title: scene.title,
          summary: scene.summary,
          ...(act ? { actId: act.stable_id } : {}),
          targetDurationSec: scene.target_duration_sec,
        };
      }),
    },
  };
  return {
    source: {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      assetId: null,
      storyBlueprintId: row.id,
    },
    body,
    searchText: buildSearchText([
      logline,
      ...((characters as StoryCharacterRow[]).flatMap((c) => [
        c.name,
        c.role,
        c.description,
      ])),
      ...((acts as StoryActRow[]).flatMap((a) => [a.title, a.purpose, a.summary])),
      ...((scenes as StorySceneRow[]).flatMap((s) => [s.title, s.summary])),
    ]),
  };
}

async function materializePreview(input: {
  db: SupabaseClient;
  entryId: string;
  workspaceId: string;
  sourceAssetId: string;
  store?: ObjectStore;
}): Promise<{ storageKey: string; storageBucket: string; contentType: string }> {
  const asset = await sourceAssetRow(input.db, input.workspaceId, input.sourceAssetId);
  if (!asset.storage_key || !asset.storage_bucket) {
    throw new ApiError(
      "asset_invalid",
      "Publishing to the catalog requires a managed-storage source asset."
    );
  }
  const config = readStorageConfig();
  const store = input.store ?? createObjectStore(config);
  const filename = path.basename(asset.filename ?? `${asset.id}.png`);
  const contentType = contentTypeForFilename(filename);
  const sourceVisibility = visibilityForBucket(config, asset.storage_bucket);
  const copied = await store.copyObject({
    sourceKey: asset.storage_key,
    sourceVisibility,
    destinationKey: `catalog/${input.entryId}/${filename}`,
    destinationVisibility: "public",
    contentType,
  });
  return {
    storageKey: copied.key,
    storageBucket: copied.bucket,
    contentType,
  };
}

function storyBlueprintFromCatalogEntry(entry: CatalogEntryRow): StoryBlueprint {
  const story = recordValue(entry.snapshot.story);
  const snapshot = recordValue(story.snapshot);
  return {
    schemaVersion: "storyBlueprint.v1",
    premise: stringValue(snapshot.premise) ?? stringValue(story.logline) ?? "",
    logline: stringValue(snapshot.logline) ?? stringValue(story.logline) ?? "",
    tone: stringValue(snapshot.tone) ?? "",
    ...(stringValue(snapshot.audience)
      ? { audience: stringValue(snapshot.audience) }
      : {}),
    targetLengthSec:
      typeof snapshot.targetLengthSec === "number" ? snapshot.targetLengthSec : 0,
    aspectRatio:
      snapshot.aspectRatio === "16:9" ||
      snapshot.aspectRatio === "9:16" ||
      snapshot.aspectRatio === "1:1"
        ? snapshot.aspectRatio
        : "16:9",
    characters: arrayValue(story.characters).map((character, index) => {
      const row = recordValue(character);
      return {
        id: stringValue(row.id) ?? `character_${index + 1}`,
        name: stringValue(row.name) ?? `Character ${index + 1}`,
        role: stringValue(row.role) ?? "character",
        description: stringValue(row.description) ?? "",
      };
    }),
    acts: arrayValue(story.acts).map((act, index) => {
      const row = recordValue(act);
      return {
        id: stringValue(row.id) ?? `act_${index + 1}`,
        title: stringValue(row.title) ?? `Act ${index + 1}`,
        purpose: stringValue(row.purpose) ?? "",
        summary: stringValue(row.summary) ?? "",
        targetDurationSec:
          typeof row.targetDurationSec === "number" ? row.targetDurationSec : 0,
      };
    }),
    scenes: arrayValue(story.scenes).map((scene, index) => {
      const row = recordValue(scene);
      return {
        id: stringValue(row.id) ?? `scene_${index + 1}`,
        title: stringValue(row.title) ?? `Scene ${index + 1}`,
        summary: stringValue(row.summary) ?? "",
        actId: stringValue(row.actId) ?? "act_1",
        targetDurationSec:
          typeof row.targetDurationSec === "number" ? row.targetDurationSec : 0,
      };
    }),
    ending: stringValue(snapshot.ending) ?? "",
  };
}

async function cloneStoryChildrenFromSnapshot(
  db: SupabaseClient,
  blueprint: StoryBlueprint,
  targetBlueprintId: string,
  targetWorkspaceId: string,
  targetProjectId: string
): Promise<void> {
  if (blueprint.characters.length > 0) {
    await runQuery(
      "catalog.cloneStoryChildren characters write",
      db.from("story_blueprint_characters").insert(
        blueprint.characters.map((character, index) => ({
          story_blueprint_id: targetBlueprintId,
          workspace_id: targetWorkspaceId,
          project_id: targetProjectId,
          stable_id: character.id,
          position: index,
          name: character.name,
          role: character.role,
          description: character.description,
        }))
      )
    );
  }

  const actIdByStableId = new Map<string, string>();
  if (blueprint.acts.length > 0) {
    const insertedActs = (await runQuery(
      "catalog.cloneStoryChildren acts write",
      db
        .from("story_blueprint_acts")
        .insert(
          blueprint.acts.map((act, index) => ({
            story_blueprint_id: targetBlueprintId,
            workspace_id: targetWorkspaceId,
            project_id: targetProjectId,
            stable_id: act.id,
            position: index,
            title: act.title,
            purpose: act.purpose,
            summary: act.summary,
            target_duration_sec: act.targetDurationSec,
          }))
        )
        .select("id, stable_id")
    )) as Array<{ id: string; stable_id: string }>;
    for (const act of insertedActs) {
      actIdByStableId.set(act.stable_id, act.id);
    }
  }

  if (blueprint.scenes.length > 0) {
    await runQuery(
      "catalog.cloneStoryChildren scenes write",
      db.from("story_blueprint_scenes").insert(
        blueprint.scenes.map((scene, index) => {
          const mappedActId = actIdByStableId.get(scene.actId);
          if (!mappedActId) {
            throw new Error(`Could not map scene ${scene.id} to a cloned act.`);
          }
          return {
            story_blueprint_id: targetBlueprintId,
            story_blueprint_act_id: mappedActId,
            workspace_id: targetWorkspaceId,
            project_id: targetProjectId,
            stable_id: scene.id,
            position: index,
            title: scene.title,
            summary: scene.summary,
            target_duration_sec: scene.targetDurationSec,
          };
        })
      )
    );
  }
}

function unmarked(value: Record<string, unknown> | null): Record<string, unknown> {
  if (!value) return {};
  const { schema_version: _schemaVersion, schema: _schema, ...rest } = value;
  void _schemaVersion;
  void _schema;
  return rest;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length ? strings : undefined;
}

export function buildSearchText(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 5000);
}

export function buildCatalogAssetSource(input: {
  catalogEntryId: string;
  sourceAssetId?: string | null;
  sourceStoryBlueprintId?: string | null;
}): Record<string, unknown> {
  return {
    type: "catalog",
    catalogEntryId: input.catalogEntryId,
    ...(input.sourceAssetId ? { sourceAssetId: input.sourceAssetId } : {}),
    ...(input.sourceStoryBlueprintId
      ? { sourceStoryBlueprintId: input.sourceStoryBlueprintId }
      : {}),
  };
}
