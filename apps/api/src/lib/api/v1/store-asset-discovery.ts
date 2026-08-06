// Read-oriented asset catalog queries kept separate from the write-heavy V1 store.

import { runQuery } from "../../supabase/db-errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import { iso } from "./store-internal";
import { paginate, type PageResult } from "./pagination";
import { assetMediaUrlsForRow } from "./asset-media-urls";
import { type AssetMedia, type GraphAssetKind } from "./store-content";
import { remoteAssetUrlForDelivery, resolveAssetUrl } from "../../storage/asset-urls";
import { listRunGates, listOrchestratorRunsForProject } from "./orchestrator-store";
import { agentApiStore } from "../../agent-api/jobs";
import { AssetKind, AssetEmbeddingMedia, AssetSearchGraphKind, type AssetSemanticSearchInput } from "./schemas";
import type { GenerationRunStatus } from "@popcorn/shared/v1/types";
import type { V1Project } from "./store-types";
import type { GetWorkspaceDashboardSummaryDeps, ListWorkspaceGenerationRunsDeps, ListWorkspaceOutputsDeps, WorkspaceGenerationRunSummary, WorkspaceOutputSummary, WorkspaceProjectRef } from "./workspace-dashboard";
import { getWorkspaceDashboardSummaryWithDeps, listWorkspaceGenerationRunsWithDeps, listWorkspaceOutputsWithDeps } from "./workspace-dashboard";
import { assetMediaToKind, embeddingVectorLiteral, getProject, getServiceSupabase, mapAsset, mapAssets, mapProject, selectedDataAsset } from "./store";
import type { AssetRow, AssetSemanticSearchResponse, AssetSemanticSearchRpcRow, AssetWithProjectRow, CurrentSelectionRow, ProjectRow, V1Asset } from "./store";

export interface WorkspaceAssetSummary {
  id: string;
  assetId: string;
  projectId: string;
  projectName: string;
  kind: AssetKind;
  status: "ready" | "pending";
  source: string;
  filename?: string;
  description?: string;
  prompt?: string;
  promptPreview?: string;
  url?: string;
  thumbnailUrl?: string;
  expiresAt?: string | null;
  durationSec?: number;
  visibility: "public" | "private";
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceAssetJoinRow extends AssetRow {
  projects?: { name: string; status: "active" | "deleted" };
}

function assetGenerationPrompt(row: Pick<AssetRow, "params">): string | undefined {
  const prompt = row.params?.provenance?.prompt?.trim();
  return prompt || undefined;
}

export async function listWorkspaceAssets(
  workspaceId: string,
  opts: { kind?: AssetKind; source?: "uploaded" | "generated"; projectId?: string },
  limit: number,
  cursor: string | null
): Promise<PageResult<WorkspaceAssetSummary>> {
  const db = getServiceSupabase();
  let query = db
    .from("assets")
    .select("*, projects!inner(name, status)")
    .eq("workspace_id", workspaceId)
    .neq("projects.status", "deleted")
    .neq("media", "data");
  if (opts.kind) query = query.eq("media", opts.kind);
  if (opts.projectId) query = query.eq("project_id", opts.projectId);

  const data = await runQuery("store.listWorkspaceAssets", query);
  const filtered = (data as WorkspaceAssetJoinRow[]).filter((row) => {
    const isGenerated = row.params?.provenance != null;
    if (opts.source === "generated") return isGenerated;
    if (opts.source === "uploaded") return !isGenerated;
    return true;
  });
  const all: WorkspaceAssetSummary[] = filtered.map((row) => {
    const source = row.source as { type?: string } | null;
    const prompt = assetGenerationPrompt(row);
    return {
      id: row.id,
      assetId: row.id,
      projectId: row.project_id,
      projectName: row.projects?.name ?? "Untitled project",
      kind: assetMediaToKind(row.media, row.kind),
      status: row.status,
      source: typeof source?.type === "string" ? source.type : "imported",
      filename: row.filename,
      description: row.description ?? undefined,
      prompt,
      promptPreview: prompt,
      durationSec: row.duration_sec ?? undefined,
      visibility: row.visibility ?? "public",
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  });
  const paged = paginate(all, limit, cursor);
  // Resolve display URLs for the returned page only — private-asset URLs are
  // presigned per call, so hydrating the full workspace list would be wasted
  // signing work.
  const rowById = new Map(filtered.map((row) => [row.id, row]));
  const items = await Promise.all(
    paged.items.map(async (item) => {
      const row = rowById.get(item.id);
      if (!row) return item;
      const media = await assetMediaUrlsForRow(row);
      return {
        ...item,
        url: media.url ?? undefined,
        thumbnailUrl: media.thumbnailUrl ?? undefined,
        expiresAt: media.expiresAt,
      };
    })
  );
  return { items, nextCursor: paged.nextCursor };
}

// ---------------------------------------------------------------------------
// Workspace-scoped cross-project lists (dashboard nav: Projects/Runs, Outputs)
// ---------------------------------------------------------------------------
// These aggregate per-project records across every active project in a
// workspace, mirroring listWorkspaceAssets' tenancy model: the workspace's
// projects are the RLS-scoped set, and each list joins the owning project's
// name onto every row so the dashboard can render "<project> — <run/output>"
// without a second lookup. The project enumeration is injectable so the
// aggregation can be unit-tested without Supabase (the route always uses the
// real, RLS-scoped listProjects).

async function listWorkspaceProjectRefs(
  workspaceId: string
): Promise<WorkspaceProjectRef[]> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listWorkspaceProjectRefs",
    db
      .from("projects")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
  );
  return ((data as { id: string; name: string }[]) ?? []).map((row) => ({
    id: row.id,
    name: row.name ?? "Untitled project",
  }));
}

export async function listWorkspaceGenerationRuns(
  workspaceId: string,
  opts: { status?: GenerationRunStatus; projectId?: string },
  limit: number,
  cursor: string | null,
  deps: ListWorkspaceGenerationRunsDeps = {
    listProjects: listWorkspaceProjectRefs,
    listRunsForProject: listOrchestratorRunsForProject,
    listRunGates,
  }
): Promise<PageResult<WorkspaceGenerationRunSummary>> {
  return listWorkspaceGenerationRunsWithDeps(
    workspaceId,
    opts,
    limit,
    cursor,
    deps
  );
}

export async function listWorkspaceOutputs(
  workspaceId: string,
  opts: { projectId?: string },
  limit: number,
  cursor: string | null,
  deps: ListWorkspaceOutputsDeps = {
    listProjects: listWorkspaceProjectRefs,
    artifactStore: agentApiStore,
  }
): Promise<PageResult<WorkspaceOutputSummary>> {
  return listWorkspaceOutputsWithDeps(workspaceId, opts, limit, cursor, deps);
}

export interface ProjectWatchMedia {
  assetId: string;
  projectId: string;
  projectName: string;
  filename: string;
  kind: "video";
  url: string;
  posterUrl?: string;
  durationSec?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

async function projectedAssetUrl(
  row: Pick<AssetRow, "remote_url" | "storage_key" | "storage_bucket" | "visibility">
): Promise<{
  url: string | null;
  expiresAt?: string;
}> {
  if (row.storage_key) {
    const expiresInSec = 3600;
    try {
      return {
        url:
          (await resolveAssetUrl(row, {
            privateTtlSec: expiresInSec,
          })) ?? remoteAssetUrlForDelivery(row.remote_url) ?? null,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      };
    } catch {
      return { url: remoteAssetUrlForDelivery(row.remote_url) ?? null };
    }
  }

  return { url: remoteAssetUrlForDelivery(row.remote_url) ?? null };
}

async function selectedMediaAsset(
  db: SupabaseClient,
  projectId: string,
  slotRole: string,
  media: AssetMedia
): Promise<AssetRow | null> {
  let selectionQuery = db
    .from("current_selections")
    .select("active_asset_id, seq")
    .eq("project_id", projectId)
    .eq("slot_role", slotRole);

  if (slotRole === "cut" || slotRole === "poster") {
    selectionQuery = selectionQuery.is("slot_owner_lineage_id", null);
  }

  const selected = await runQuery(
    `store.selectedMediaAsset ${slotRole}`,
    selectionQuery.order("seq", { ascending: false }).limit(1).maybeSingle()
  );

  const activeAssetId = (selected as CurrentSelectionRow | null)?.active_asset_id;
  if (!activeAssetId) return null;

  const data = await runQuery(
    `store.selectedMediaAsset asset ${slotRole}`,
    db
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("id", activeAssetId)
      .eq("media", media)
      .eq("status", "ready")
      .maybeSingle()
  );
  return (data as AssetRow | null) ?? null;
}

async function latestReadyMediaAsset(
  db: SupabaseClient,
  projectId: string,
  kind: GraphAssetKind,
  media: AssetMedia
): Promise<AssetRow | null> {
  const data = await runQuery(
    `store.latestReadyMediaAsset ${kind}`,
    db
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", kind)
      .eq("media", media)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  return (data as AssetRow | null) ?? null;
}

async function renderForCutAsset(
  db: SupabaseClient,
  projectId: string,
  cutAssetId: string
): Promise<AssetRow | null> {
  const edgeData = await runQuery(
    "store.renderForCutAsset edges",
    db
      .from("asset_edges")
      .select("from_id")
      .eq("project_id", projectId)
      .eq("to_id", cutAssetId)
  );

  const renderIds = [...new Set(((edgeData ?? []) as Array<{ from_id: string }>).map((row) => row.from_id))];
  if (renderIds.length === 0) return null;

  const data = await runQuery(
    "store.renderForCutAsset render",
    db
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", "render")
      .eq("media", "video")
      .eq("status", "ready")
      .in("id", renderIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  return (data as AssetRow | null) ?? null;
}

export async function getProjectWatchMedia(
  workspaceId: string,
  projectId: string
): Promise<ProjectWatchMedia | null> {
  const project = await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  const directRender = await selectedMediaAsset(db, projectId, "cut", "video");
  const cut = directRender ? null : await selectedDataAsset(db, projectId, "cut", "composite");
  const render = directRender ?? (cut ? await renderForCutAsset(db, projectId, cut.id) : null);
  if (!render || render.kind !== "render") return null;

  const media = await projectedAssetUrl(render);
  if (!media.url) return null;

  const posterAsset =
    (await selectedMediaAsset(db, projectId, "poster", "image")) ??
    (await latestReadyMediaAsset(db, projectId, "keyframe", "image"));
  const poster = posterAsset ? await projectedAssetUrl(posterAsset) : { url: null };

  return {
    assetId: render.id,
    projectId,
    projectName: project.name,
    filename: render.filename,
    kind: "video",
    url: media.url,
    ...(poster.url ? { posterUrl: poster.url } : {}),
    ...(render.duration_sec != null ? { durationSec: render.duration_sec } : {}),
    ...(media.expiresAt ? { expiresAt: media.expiresAt } : {}),
    createdAt: iso(render.created_at),
    updatedAt: iso(render.updated_at),
  };
}

export async function getWorkspaceDashboardSummary(
  workspaceId: string,
  deps: GetWorkspaceDashboardSummaryDeps = {
    listProjects: listWorkspaceProjectRefs,
    listRunsForProject: listOrchestratorRunsForProject,
    listRunGates,
    artifactStore: agentApiStore,
  }
): ReturnType<typeof getWorkspaceDashboardSummaryWithDeps> {
  return getWorkspaceDashboardSummaryWithDeps(workspaceId, deps);
}
export async function listPublicAssets(
  limit: number,
  cursor: string | null,
  kind?: AssetKind
): Promise<PageResult<V1Asset>> {
  const db = getServiceSupabase();
  let query = db
    .from("assets")
    .select("*, projects!inner(id, visibility, status, workspaces!inner(purpose))")
    .eq("visibility", "public")
    .eq("projects.visibility", "public")
    .eq("projects.workspaces.purpose", "user")
    .neq("projects.status", "deleted")
    .neq("media", "data");

  if (kind) {
    query = query.eq("media", kind);
  }

  const data = await runQuery("store.listPublicAssets", query);
  const assets = await mapAssets(data as AssetWithProjectRow[]);
  return paginate(assets, limit, cursor);
}

export type DiscoverSearchItem =
  | { type: "project"; item: V1Project; id: string; createdAt: string }
  | {
      type: "asset";
      item: V1Asset;
      id: string;
      createdAt: string;
      score?: number;
      source?: "embedding";
    };

export async function searchPublicContent(
  searchQuery: string,
  limit: number,
  cursor: string | null,
  kind?: AssetKind
): Promise<PageResult<DiscoverSearchItem>> {
  const db = getServiceSupabase();
  const normalized = searchQuery.trim();
  if (!normalized) return { items: [], nextCursor: null };

  const [projectsData, assetsData] = await Promise.all([
    runQuery(
      "store.searchPublicContent projects",
      db.rpc("search_public_projects", { search_query: normalized })
    ),
    runQuery(
      "store.searchPublicContent assets",
      db.rpc("search_public_assets", {
        search_query: normalized,
        media_filter: kind ?? null,
      })
    ),
  ]);

  const projectItems: DiscoverSearchItem[] = (projectsData as ProjectRow[])
    .map((project) => {
      const item = mapProject(project);
      return { type: "project", item, id: `project:${item.id}`, createdAt: item.createdAt };
    });
  const publicAssets = await mapAssets(assetsData as AssetRow[]);
  const assetItems: DiscoverSearchItem[] = publicAssets.map((item) => ({
    type: "asset",
    item,
    id: `asset:${item.id}`,
    createdAt: item.createdAt,
  }));

  return paginate([...projectItems, ...assetItems], limit, cursor);
}

export async function searchPublicAssetsSemantic(
  input: AssetSemanticSearchInput
): Promise<AssetSemanticSearchResponse> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.searchPublicAssetsSemantic",
    db.rpc("search_public_asset_embeddings", {
      p_query: input.q,
      p_query_embedding: embeddingVectorLiteral(input.queryEmbedding),
      p_embedding_model: input.embeddingModel,
      p_media_filter: (input.media as AssetEmbeddingMedia | undefined) ?? null,
      p_kind_filter: (input.kind as AssetSearchGraphKind | undefined) ?? null,
      p_role_filter: input.role ?? null,
      p_match_count: input.limit,
    })
  );
  const rows = data as AssetSemanticSearchRpcRow[];
  const items = await Promise.all(
    rows.map(async (row) => ({
      asset: await mapAsset(row),
      score: {
        hybrid: row.hybrid_score,
        vector: row.vector_score,
        text: row.text_score,
      },
      chunk: {
        id: row.embedding_id,
        key: row.chunk_key,
        kind: row.chunk_kind,
        embeddingModel: row.embedding_model,
        sourceHash: row.source_hash,
        sourceText: row.source_text,
      },
    }))
  );
  return { items };
}

function isCharacterAnchorAsset(asset: V1Asset): boolean {
  return Boolean(
    asset.userContext?.characterNames?.length ||
      asset.userContext?.intendedUse?.includes("character_reference") ||
      asset.context?.recommendedRoles?.some((role) => /character/i.test(role))
  );
}

export async function listCharacterAnchorAssets(
  workspaceId: string,
  projectId: string,
  limit: number,
  cursor: string | null
): Promise<PageResult<V1Asset>> {
  await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listCharacterAnchorAssets",
    db
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("media", "data")
  );
  const mapped = await mapAssets(data as AssetRow[]);
  const anchors = mapped.filter(isCharacterAnchorAsset);
  return paginate(anchors, limit, cursor);
}

// ---------------------------------------------------------------------------
