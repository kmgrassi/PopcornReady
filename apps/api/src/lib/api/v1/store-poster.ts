// Project poster selection, reuse, and generation context for the V1 store.

import type { SupabaseClient } from "@supabase/supabase-js";
import { runQuery } from "../../supabase/db-errors";
import type { GeneratedAssetProvenance } from "./provenance";
import { ApiError, notFound } from "./errors";
import { inputIds, unmarkedContent } from "./store-content";
import { unmarkedJson } from "./store-internal";
import { isAssetIdShape } from "./store-storyboard";
import type { GraphAssetInput } from "./asset-graph";
import {
  createAction,
  getAssetRow,
  getServiceSupabase,
  mapProjectWithProjection,
  selectedDataAsset,
  updateAction,
} from "./store";
import type {
  AssetRow,
  CurrentSelectionRow,
  ProjectRow,
  V1Project,
} from "./store";
import type { AssetMedia, DataAssetRow, GraphAssetKind } from "./store-content";
import type { VideoBrief } from "./schemas";

// --- poster ----------------------------------------------------------------
// The project's marketing one-sheet, shown as the thumbnail in dashboard
// grids. The current poster is the project-scoped 'poster' selection slot
// (slot_owner_lineage_id null). Until one is selected or generated, fall back
// to the newest ready poster-kind asset, then the newest ready image of any
// kind, so project grids stay visual from the first keyframe onward.
//
// Public projections (unauthenticated discover) must pass publicOnly so a
// private selected poster or private fallback image never leaks a signed URL;
// a private selection falls through to public-only candidates instead.
export const POSTER_SLOT_ROLE = "poster";

interface PosterAssetRow {
  id: string;
  media: AssetMedia;
  status: "ready" | "pending";
  role: string | null;
  description: string | null;
  content_hash: string | null;
  inputs: GraphAssetInput[];
  inputs_fingerprint: string | null;
  params: Record<string, unknown> | null;
  remote_url: string | null;
  storage_key: string | null;
  storage_bucket: string | null;
  visibility: "public" | "private" | null;
}

const POSTER_ASSET_COLUMNS =
  "id, media, status, role, description, content_hash, inputs, inputs_fingerprint, params, remote_url, storage_key, storage_bucket, visibility";

export interface PosterVisibilityOpts {
  publicOnly?: boolean;
}

export async function readyImageAssetById(
  db: SupabaseClient,
  projectId: string,
  assetId: string,
  opts: PosterVisibilityOpts = {}
): Promise<PosterAssetRow | null> {
  if (!isAssetIdShape(assetId)) return null;
  let query = db
    .from("assets")
    .select(POSTER_ASSET_COLUMNS)
    .eq("project_id", projectId)
    .eq("id", assetId)
    .eq("media", "image")
    .eq("status", "ready");
  if (opts.publicOnly) query = query.eq("visibility", "public");
  const data = await runQuery("store.readyImageAssetById", query.maybeSingle());
  return (data as PosterAssetRow | null) ?? null;
}

async function latestReadyImageAsset(
  db: SupabaseClient,
  projectId: string,
  kind?: GraphAssetKind,
  opts: PosterVisibilityOpts = {}
): Promise<PosterAssetRow | null> {
  let query = db
    .from("assets")
    .select(POSTER_ASSET_COLUMNS)
    .eq("project_id", projectId)
    .eq("media", "image")
    .eq("status", "ready");
  if (kind) query = query.eq("kind", kind);
  if (opts.publicOnly) query = query.eq("visibility", "public");
  const data = await runQuery(
    `store.latestReadyImageAsset ${kind ?? "image"}`,
    query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  return (data as PosterAssetRow | null) ?? null;
}

export async function projectPosterAsset(
  db: SupabaseClient,
  projectId: string,
  opts: PosterVisibilityOpts = {}
): Promise<PosterAssetRow | null> {
  const selected = await runQuery(
    "store.projectPosterAsset selection",
    db
      .from("current_selections")
      .select("active_asset_id")
      .eq("project_id", projectId)
      .is("slot_owner_lineage_id", null)
      .eq("slot_role", POSTER_SLOT_ROLE)
      .maybeSingle()
  );
  const activeAssetId = (selected as CurrentSelectionRow | null)?.active_asset_id;
  if (activeAssetId) {
    const asset = await readyImageAssetById(db, projectId, activeAssetId, opts);
    if (asset) return asset;
  }
  return (
    (await latestReadyImageAsset(db, projectId, "poster", opts)) ??
    (await latestReadyImageAsset(db, projectId, undefined, opts))
  );
}

export interface PosterGenerationAssetRef {
  id: string;
  contentHash: string | null;
  inputsFingerprint?: string | null;
  role?: string | null;
  description?: string | null;
  content?: unknown;
}

export interface PosterGenerationContext {
  project: V1Project;
  briefAsset: PosterGenerationAssetRef | null;
  planAsset: PosterGenerationAssetRef | null;
  heroAnchorAsset: PosterGenerationAssetRef | null;
  currentPosterManuallyPinned: boolean;
}

function dataAssetRef<T = unknown>(row: DataAssetRow | null): PosterGenerationAssetRef | null {
  if (!row) return null;
  return {
    id: row.id,
    contentHash: row.content_hash,
    inputsFingerprint: row.inputs_fingerprint,
    role: row.role,
    content: unmarkedContent<T>(row.content),
  };
}

function imageAssetRef(row: PosterAssetRow | null): PosterGenerationAssetRef | null {
  if (!row) return null;
  return {
    id: row.id,
    contentHash: row.content_hash,
    inputsFingerprint: row.inputs_fingerprint,
    role: row.role,
    description: row.description,
  };
}

async function latestHeroAnchorAsset(
  db: SupabaseClient,
  projectId: string
): Promise<PosterAssetRow | null> {
  const data = await runQuery(
    "store.latestHeroAnchorAsset",
    db
      .from("assets")
      .select(POSTER_ASSET_COLUMNS)
      .eq("project_id", projectId)
      .eq("kind", "anchor")
      .eq("media", "image")
      .eq("status", "ready")
      .in("role", ["character_anchor", "scene_anchor"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  return (data as PosterAssetRow | null) ?? null;
}

async function currentPosterSelection(
  db: SupabaseClient,
  projectId: string
): Promise<CurrentSelectionRow | null> {
  const selected = await runQuery(
    "store.currentPosterSelection",
    db
      .from("current_selections")
      .select("active_asset_id,set_by_action_id")
      .eq("project_id", projectId)
      .is("slot_owner_lineage_id", null)
      .eq("slot_role", POSTER_SLOT_ROLE)
      .maybeSingle()
  );
  return (selected as CurrentSelectionRow | null) ?? null;
}

function isFirstFrameImageAsset(row: AssetRow): boolean {
  return (
    row.media === "image" &&
    row.status === "ready" &&
    row.inputs.some(
      (input) => input.relation === "input" && input.role === "first_frame_of"
    )
  );
}

async function posterSelectionIsManual(
  db: SupabaseClient,
  selection: CurrentSelectionRow | null
): Promise<boolean> {
  if (!selection?.set_by_action_id) return false;
  const action = await runQuery(
    "store.posterSelectionIsManual action",
    db
      .from("actions")
      .select("tool")
      .eq("id", selection.set_by_action_id)
      .maybeSingle()
  );
  return (action as { tool?: string } | null)?.tool === "set_poster";
}

export async function getPosterGenerationContext(
  workspaceId: string,
  projectId: string
): Promise<PosterGenerationContext> {
  const db = getServiceSupabase();
  const projectData = await runQuery(
    "store.getPosterGenerationContext project",
    db
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!projectData) throw notFound(`Project not found: ${projectId}`);
  const projectRow = projectData as ProjectRow;
  const [briefAsset, planAsset, heroAnchorAsset, selection] = await Promise.all([
    selectedDataAsset(db, projectId, "brief", "brief", "current_brief"),
    selectedDataAsset(db, projectId, "plan", "plan", "current_plan"),
    latestHeroAnchorAsset(db, projectId),
    currentPosterSelection(db, projectId),
  ]);

  return {
    project: await mapProjectWithProjection(db, projectRow),
    briefAsset: dataAssetRef<VideoBrief>(briefAsset),
    planAsset: dataAssetRef(planAsset),
    heroAnchorAsset: imageAssetRef(heroAnchorAsset),
    currentPosterManuallyPinned: await posterSelectionIsManual(db, selection),
  };
}

function posterMatchesGeneration(
  row: PosterAssetRow,
  input: {
    prompt: string;
    provider: string;
    inputAssetIds: string[];
  }
): boolean {
  const params = unmarkedJson(row.params) as
    | { provenance?: GeneratedAssetProvenance }
    | null
    | undefined;
  const provenance = params?.provenance;
  if (!provenance) return false;
  if (provenance.prompt !== input.prompt) return false;
  if (provenance.provider !== input.provider) return false;
  return JSON.stringify(inputIds(row.inputs ?? [])) === JSON.stringify(input.inputAssetIds);
}

export async function findReusableGeneratedPoster(input: {
  projectId: string;
  prompt: string;
  provider: string;
  inputAssetIds: string[];
}): Promise<PosterGenerationAssetRef | null> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.findReusableGeneratedPoster",
    db
      .from("assets")
      .select(POSTER_ASSET_COLUMNS)
      .eq("project_id", input.projectId)
      .eq("kind", "poster")
      .eq("media", "image")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(10)
  );
  const rows = (data as PosterAssetRow[]) ?? [];
  const matched = rows.find((row) => posterMatchesGeneration(row, input)) ?? null;
  return imageAssetRef(matched);
}

export async function selectGeneratedProjectPoster(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
}): Promise<V1Project> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.selectGeneratedProjectPoster project",
    db
      .from("projects")
      .select("*")
      .eq("id", input.projectId)
      .eq("workspace_id", input.workspaceId)
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!data) throw notFound(`Project not found: ${input.projectId}`);
  const projectRow = data as ProjectRow;

  const asset = await readyImageAssetById(db, input.projectId, input.assetId);
  if (!asset) {
    throw new ApiError(
      "validation_failed",
      `Asset ${input.assetId} is not a ready image asset in project ${input.projectId}.`
    );
  }
  const selection = await currentPosterSelection(db, input.projectId);
  if (await posterSelectionIsManual(db, selection)) {
    return mapProjectWithProjection(db, projectRow);
  }

  const action = await createAction({
    projectId: input.projectId,
    tool: "select_generated_poster",
    status: "applied",
    params: { assetId: input.assetId },
    inputAssetIds: [input.assetId],
    outputAssetIds: [input.assetId],
    rationale: "Auto-select the generated project poster.",
  });
  await runQuery(
    "store.selectGeneratedProjectPoster selection",
    db.from("selections").insert({
      project_id: input.projectId,
      slot_owner_lineage_id: null,
      slot_role: POSTER_SLOT_ROLE,
      active_asset_id: input.assetId,
      set_by_action_id: action.id,
    })
  );
  return mapProjectWithProjection(db, projectRow);
}

export async function fillProjectPosterFromFirstFrame(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
}): Promise<{ selected: boolean; project: V1Project }> {
  const db = getServiceSupabase();
  const projectData = await runQuery(
    "store.fillProjectPosterFromFirstFrame project",
    db
      .from("projects")
      .select("*")
      .eq("id", input.projectId)
      .eq("workspace_id", input.workspaceId)
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!projectData) throw notFound(`Project not found: ${input.projectId}`);
  const projectRow = projectData as ProjectRow;

  const row = await getAssetRow(
    db,
    input.workspaceId,
    input.projectId,
    input.assetId,
    "fillProjectPosterFromFirstFrame asset"
  );
  if (!isFirstFrameImageAsset(row)) {
    throw new ApiError(
      "validation_failed",
      `Asset ${input.assetId} is not a ready first-frame image in project ${input.projectId}.`
    );
  }

  if (await currentPosterSelection(db, input.projectId)) {
    return { selected: false, project: await mapProjectWithProjection(db, projectRow) };
  }

  const action = await createAction({
    projectId: input.projectId,
    tool: "select_first_frame_poster",
    status: "running",
    params: { assetId: input.assetId },
    inputAssetIds: [input.assetId],
    rationale: "Auto-select the first uploaded video frame as the project poster.",
  });
  let selected: unknown;
  try {
    selected = await runQuery(
      "store.fillProjectPosterFromFirstFrame select",
      db.rpc("select_empty_project_poster_from_first_frame", {
        p_project_id: input.projectId,
        p_asset_id: input.assetId,
        p_set_by_action_id: action.id,
      })
    );
  } catch (err) {
    await updateAction(action.id, {
      status: "failed",
      outputAssetIds: [],
      error: {
        message: err instanceof Error ? err.message : "First-frame poster selection failed.",
      },
    });
    throw err;
  }
  if (selected) {
    await updateAction(action.id, {
      status: "applied",
      outputAssetIds: [input.assetId],
    });
  } else {
    await updateAction(action.id, {
      status: "failed",
      outputAssetIds: [],
      error: { reason: "poster_slot_already_filled" },
    });
  }

  return {
    selected: Boolean(selected),
    project: await mapProjectWithProjection(db, projectRow),
  };
}
