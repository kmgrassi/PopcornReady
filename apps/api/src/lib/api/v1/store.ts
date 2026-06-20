// Persistence for the versioned agent API.
//
// This is a separate store from the single-project browser store (src/lib/store.ts).
// The agent API is multi-project and multi-workspace. This module is the ONLY
// place that talks to the database: routes/handlers call the exported functions
// below and never see SQL or supabase-js, so the storage backend can change here
// without touching anything upstream.
//
// Backend: Supabase Postgres (schema in supabase/migrations/20260603000000_init_v1_model.sql
// plus the public.users / workspace_members migrations). Reads/writes go through a
// service-role client (server-trusted); RLS still guards the tables against direct
// PostgREST access, and we keep explicit workspaceId/projectId tenancy filters on
// every query so a service-role bug can't silently cross tenants.
//
// Column ↔ object mapping notes:
//   * Tables use snake_case columns; objects use camelCase + a `schemaVersion` tag.
//   * Timestamps are normalized to canonical ISO (`new Date(x).toISOString()`) so
//     newest-first cursor pagination orders identically to the old JSON store.
//   * `assets` has dedicated columns for only a subset of V1Asset's fields; the
//     remaining context-family fields are packed into the `context` jsonb column
//     as a structured envelope (see assetContextEnvelope / unpackAssetContext).
//     `assets` stores METADATA only — the bytes live in storage (separate PR).

import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { databaseError, runQuery } from "../../supabase/db-errors";
import { deploymentMetadata, iso, markedJson, unmarkedJson } from "./store-internal";
import {
  localDir,
  mediaAnalysisDir,
  mediaGeneratedDir,
  mediaUploadDir,
  withLocalDir,
} from "./media-paths";
import {
  paginate,
  paginateByUpdatedAt,
  type PageResult,
} from "./pagination";
import {
  canonicalContentHash,
  graphInputsFromProvenance,
  inputsFingerprint,
  type GraphAssetInput,
} from "./asset-graph";
import {
  DASHBOARD_SCHEMA_VERSION,
  type DashboardSummary,
} from "@popcorn/shared/v1/dashboard";
import { ApiError, notFound } from "./errors";
import { GeneratedAssetProvenance } from "./provenance";
import { AssetSemanticAnalysis } from "../../edit-graph/types";
import {
  type CompositionPlan as ContractCompositionPlan,
  type GenerationRun,
  type GenerationRunStatus,
  type Job,
  type JobStatus,
  type JobType,
  type ProjectStoryboard,
  type StoryboardBeat,
  type StoryboardItemStatus,
  type StoryboardPanel,
  type StoryboardScene,
  type StoryboardStatus,
  SCHEMA as CONTRACT_SCHEMA,
} from "@popcorn/shared/v1/types";
import {
  STUDIO_DRAFT_SCHEMA_VERSION,
  type StudioDraft,
  type StudioDraftPayload,
  type StudioDraftStep,
  type StudioDraftSummary,
} from "@popcorn/shared/v1/studio-drafts";
import type { EditPlan, ScriptDraft, Timeline } from "@popcorn/shared/types";
import type { Asset } from "@popcorn/shared/assets/types";
import {
  getOrchestratorRun,
  listOrchestratorRunsForProject,
  type OrchestratorRun,
} from "./orchestrator-store";
import { getRequestSupabase } from "../../supabase/clients";
import { agentApiStore, type AgentApiStore } from "../../agent-api/jobs";
import type { Artifact } from "../../agent-api/types";
import { remoteAssetUrlForDelivery, resolveAssetUrl } from "../../storage/asset-urls";
import {
  AgentAssetSource,
  AgentAssetContext,
  AgentClipContext,
  AssetEmbeddingMedia,
  AssetSearchGraphKind,
  AssetContext,
  AssetKnowledge,
  AssetKind,
  AssetSemanticSearchInput,
  SCHEMA_VERSIONS,
  UserAssetContext,
  VideoBrief,
} from "./schemas";
import {
  reconcileAssetStorage,
  type VisibilityObjectStore,
} from "../../storage/visibility-move";
import { projectDisplayName } from "./naming";

export interface V1Workspace {
  id: string;
  schemaVersion: typeof SCHEMA_VERSIONS.workspace;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface V1Project {
  id: string;
  schemaVersion: typeof SCHEMA_VERSIONS.project;
  workspaceId: string;
  name: string;
  status: "active" | "deleted";
  visibility?: "public" | "private";
  brief: VideoBrief | null;
  currentBriefVersionId: string | null;
  hasStoryboard?: boolean;
  posterAssetId: string | null;
  posterUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface V1BriefVersion {
  id: string;
  schemaVersion: typeof SCHEMA_VERSIONS.briefVersion;
  projectId: string;
  brief: VideoBrief;
  createdAt: string;
}

export interface V1Asset {
  id: string;
  schemaVersion: typeof SCHEMA_VERSIONS.asset;
  workspaceId: string;
  projectId: string;
  kind: AssetKind;
  role?: string;
  filename: string;
  status: "ready" | "pending";
  source: AgentAssetSource;
  visibility?: "public" | "private";
  remoteUrl?: string;
  storageKey?: string;
  storageBucket?: string;
  durationSec?: number;
  context?: AssetContext;
  userContext?: UserAssetContext;
  agentContext?: AgentAssetContext | AgentClipContext;
  assetKnowledge?: AssetKnowledge;
  clipUnderstanding?: {
    assetId: string;
    source: "upload" | "generated";
    combinedSummary: string;
    timelineHints: {
      mustUse: boolean;
      avoid: boolean;
      preferredBeats: string[];
      bestStartSec?: number;
      bestEndSec?: number;
    };
    provenance: {
      userContextUpdatedAt?: string;
      analyzedAt?: string;
      analysisVersion: string;
      sampledFrameAssetIds: string[];
    };
  };
  semanticAnalysis?: AssetSemanticAnalysis;
  analysis?: V1AssetAnalysis;
  // Present for assets produced by the generated-assets endpoint (PR2).
  provenance?: GeneratedAssetProvenance;
  graphInputs?: GraphAssetInput[];
  contentHash?: string;
  inputsFingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface V1AssetAnalysis {
  schemaVersion: "assetAnalysis.v1";
  status: "succeeded" | "failed";
  analyzedAt: string;
  analysisVersion: string;
  sampledFrames: string[];
  observations?: {
    summary: string;
    subjects: string[];
    actions: string[];
    setting?: string;
    mood?: string;
    likelyUses: string[];
    cautions: string[];
    confidence: "low" | "medium" | "high";
    model: {
      provider: string;
      model?: string;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface IdempotencyRecord {
  scope: string;
  key: string;
  bodyHash: string;
  status: number;
  responseBody: unknown;
  createdAt: string;
}

export interface AssetGraphSelectionRef {
  slotOwnerLineageId: string | null;
  slotRole: string;
  seq: number;
}

export interface StaleCandidateAsset {
  assetId: string;
  depth: number;
  ref: string | null;
  kind: string;
  status: string;
  role: string | null;
  lineageId: string;
  version: number;
  contentHash: string | null;
  inputsFingerprint: string | null;
  selections: AssetGraphSelectionRef[];
}

export interface StaleCandidatesResult {
  changedAsset: {
    assetId: string;
    ref: string | null;
    kind: string;
    contentHash: string | null;
  };
  candidates: StaleCandidateAsset[];
}

export type ActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "running"
  | "applied"
  | "failed";

export interface V1Action {
  id: string;
  schemaVersion: "action.v1";
  projectId: string;
  orchestratorRunId?: string;
  tool: string;
  status: ActionStatus;
  params: Record<string, unknown>;
  inputAssetIds: string[];
  rationale?: string;
  proposal?: Record<string, unknown>;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  jobIds: string[];
  outputAssetIds: string[];
  error?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateActionInput {
  projectId: string;
  orchestratorRunId?: string;
  tool: string;
  status?: ActionStatus;
  params?: Record<string, unknown>;
  inputAssetIds?: string[];
  rationale?: string;
  proposal?: Record<string, unknown>;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  jobIds?: string[];
  outputAssetIds?: string[];
  error?: Record<string, unknown>;
}

export type VisualAnchorPlanItemKind = "character" | "location" | "style";

export interface VisualAnchorPlanItem {
  id: string;
  kind: VisualAnchorPlanItemKind;
  label: string;
  description: string;
  sourceSceneIds: string[];
  sourceBeatIds: string[];
}

export interface VisualAnchorPlan {
  schemaVersion: "visual_anchor_plan.v1";
  anchors: VisualAnchorPlanItem[];
}

export interface StoryBlueprintCharacter {
  id: string;
  name: string;
  role: string;
  description: string;
}

export interface StoryBlueprintAct {
  id: string;
  title: string;
  purpose: string;
  summary: string;
  targetDurationSec: number;
}

export interface StoryBlueprintScene {
  id: string;
  title: string;
  summary: string;
  actId: string;
  targetDurationSec: number;
}

export interface StoryBlueprint {
  schemaVersion: "storyBlueprint.v1";
  premise: string;
  logline: string;
  tone: string;
  audience?: string;
  targetLengthSec: number;
  aspectRatio: VideoBrief["aspectRatio"];
  characters: StoryBlueprintCharacter[];
  acts: StoryBlueprintAct[];
  scenes: StoryBlueprintScene[];
  ending: string;
}

export interface StoryBlueprintRecord {
  id: string;
  schemaVersion: "storyBlueprint.v1";
  workspaceId: string;
  projectId: string;
  briefAssetId: string | null;
  assetId: string | null;
  status: "draft" | "approved" | "superseded";
  content: StoryBlueprint;
  createdAt: string;
  updatedAt: string;
}

export type UpdateActionPatch = Partial<
  Pick<
    V1Action,
    "status" | "estimatedCostUsd" | "actualCostUsd" | "jobIds" | "outputAssetIds" | "error"
  >
>;

export {
  localDir,
  mediaAnalysisDir,
  mediaGeneratedDir,
  mediaUploadDir,
  withLocalDir,
};
export type { PageResult };

// ---------------------------------------------------------------------------
// Service-role Supabase client
// ---------------------------------------------------------------------------
// TODO: replace with the shared clients.ts from the auth-middleware PR. That PR
// owns apps/api/src/lib/supabase/clients.ts; until it lands, this module keeps a
// minimal local service-role helper so it has no cross-PR import dependency. The
// service-role key bypasses RLS, which is why every query below still filters on
// workspaceId/projectId explicitly (tenancy is enforced in app code, not relied
// on from RLS).
let serviceClient: SupabaseClient | null = null;

export class StoreConfigError extends Error {
  constructor(missing: string[]) {
    super(
      `Supabase store is not configured: ${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } required.`
    );
    this.name = "StoreConfigError";
  }
}

function getServiceSupabase(): SupabaseClient {
  if (serviceClient) return serviceClient;

  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) throw new StoreConfigError(missing);

  serviceClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return serviceClient;
}

export function getServiceSupabaseForStore(): SupabaseClient {
  return getServiceSupabase();
}

function getRequestSupabaseOrService(): SupabaseClient {
  try {
    return getRequestSupabase();
  } catch {
    return getServiceSupabase();
  }
}

// ---------------------------------------------------------------------------
// Helpers: timestamps, errors, mapping
// ---------------------------------------------------------------------------

// Normalize a DB timestamptz (or any date-ish value) to canonical ISO so cursor
// pagination ordering is stable across the JSON-string and Postgres backends.
// supabase-js returns `PGRST116` when a `.single()` lookup matches no rows.
// Callers translate that into notFound/null; other DB failures use the typed
// database_error envelope instead of leaking as generic internal errors.
// iso/throwOnError/markedJson/unmarkedJson now live in ./store-internal.

export async function defaultVisibilityForWorkspace(
  db: SupabaseClient,
  workspaceId: string
): Promise<"public" | "private"> {
  const workspace = await runQuery(
    "store.defaultVisibilityForWorkspace workspace",
    db.from("workspaces").select("purpose").eq("id", workspaceId).maybeSingle()
  );
  if ((workspace as { purpose?: string } | null)?.purpose !== "user") {
    return "private";
  }

  const data = await runQuery(
    "store.defaultVisibilityForWorkspace",
    db.rpc("owner_tier", { ws_id: workspaceId })
  );
  return data === "paid" ? "private" : "public";
}

export async function effectiveAssetStorageVisibility(input: {
  workspaceId: string;
  projectId: string;
  assetVisibility: "public" | "private";
}): Promise<"public" | "private"> {
  if (input.assetVisibility === "private") return "private";
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.effectiveAssetStorageVisibility project",
    db
      .from("projects")
      .select("visibility")
      .eq("id", input.projectId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle()
  );
  const row = data as { visibility?: "public" | "private" } | null;
  if (!row) throw notFound(`Project not found: ${input.projectId}`);
  return row.visibility === "private" ? "private" : "public";
}

// --- workspaces ------------------------------------------------------------
interface WorkspaceRow {
  id: string;
  schema_version: string;
  owner_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
}

function mapWorkspace(row: WorkspaceRow): V1Workspace {
  return {
    id: row.id,
    schemaVersion: SCHEMA_VERSIONS.workspace,
    name: row.name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

// --- projects --------------------------------------------------------------
interface ProjectRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  name: string;
  status: "active" | "deleted";
  visibility?: "public" | "private";
  created_at: string;
  updated_at: string;
}

function mapProject(
  row: ProjectRow,
  projection: {
    brief?: VideoBrief | null;
    currentBriefVersionId?: string | null;
    hasStoryboard?: boolean;
    posterAssetId?: string | null;
    posterUrl?: string | null;
  } = {}
): V1Project {
  return {
    id: row.id,
    schemaVersion: SCHEMA_VERSIONS.project,
    workspaceId: row.workspace_id,
    name: row.name,
    status: row.status,
    visibility: row.visibility,
    brief: projection.brief ?? null,
    currentBriefVersionId: projection.currentBriefVersionId ?? null,
    hasStoryboard: projection.hasStoryboard ?? false,
    posterAssetId: projection.posterAssetId ?? null,
    posterUrl: projection.posterUrl ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

// --- brief versions --------------------------------------------------------
interface DataAssetRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  project_id: string;
  lineage_id: string;
  version: number;
  kind: GraphAssetKind;
  media: AssetMedia;
  status: "ready" | "pending";
  role: string | null;
  content: unknown;
  content_hash: string | null;
  inputs_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

// Typed-JSONB guardrail (assets_content_schema_check / assets_params_schema_check):
// jsonb document payloads must carry a schema marker. Stamp it on write, strip
// it when projecting the payload back out as a domain object.
const CONTENT_SCHEMA_KEY = "schema_version";

function markedContent(
  kind:
    | "brief"
    | "beat"
    | "plan"
    | "visual_anchor_plan"
    | "story_blueprint"
    | "script_draft"
    | "timeline"
    | "narration_script"
    | "critique",
  content: unknown
): Record<string, unknown> {
  const schema =
    kind === "story_blueprint"
      ? "storyBlueprint.v1"
      : kind === "script_draft"
        ? "scriptDraft.v1"
        : `${kind}.v1`;
  return { [CONTENT_SCHEMA_KEY]: schema, ...(content as Record<string, unknown>) };
}

function unmarkedContent<T>(content: unknown): T {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const { [CONTENT_SCHEMA_KEY]: _schema, ...rest } = content as Record<string, unknown>;
    return rest as T;
  }
  return content as T;
}

function mapBriefVersion(row: DataAssetRow): V1BriefVersion {
  return {
    id: row.id,
    schemaVersion: SCHEMA_VERSIONS.briefVersion,
    projectId: row.project_id,
    brief: unmarkedContent<VideoBrief>(row.content),
    createdAt: iso(row.created_at),
  };
}

interface StoryBlueprintRow {
  id: string;
  schema_version: "storyBlueprint.v1";
  workspace_id: string;
  project_id: string;
  brief_asset_id: string | null;
  asset_id: string | null;
  status: "draft" | "approved" | "superseded";
  snapshot: unknown;
  created_at: string;
  updated_at: string;
}

function mapStoryBlueprintRecord(row: StoryBlueprintRow): StoryBlueprintRecord {
  return {
    id: row.id,
    schemaVersion: "storyBlueprint.v1",
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    briefAssetId: row.brief_asset_id,
    assetId: row.asset_id,
    status: row.status,
    content: unmarkedContent<StoryBlueprint>(row.snapshot),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

interface CurrentSelectionRow {
  active_asset_id: string;
  set_by_action_id?: string | null;
}

interface GraphAssetSummaryRow {
  id: string;
  ref: string | null;
  kind: string;
  status: string;
  role: string | null;
  lineage_id: string;
  version: number;
  content_hash: string | null;
  inputs_fingerprint: string | null;
}

interface DownstreamAssetRow {
  asset_id: string;
  depth: number;
}

interface CurrentSelectionSummaryRow {
  slot_owner_lineage_id: string | null;
  slot_role: string;
  seq: number;
  active_asset_id: string;
}

interface ActionRow {
  id: string;
  schema_version: "action.v1";
  project_id: string;
  orchestrator_run_id: string | null;
  tool: string;
  status: ActionStatus;
  params: Record<string, unknown>;
  input_asset_ids: string[];
  rationale: string | null;
  proposal: Record<string, unknown> | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  job_ids: string[];
  output_asset_ids: string[];
  error: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface AssetFingerprintRow {
  id: string;
  content_hash: string | null;
  inputs_fingerprint: string | null;
}

function mapAction(row: ActionRow): V1Action {
  const action: V1Action = {
    id: row.id,
    schemaVersion: "action.v1",
    projectId: row.project_id,
    tool: row.tool,
    status: row.status,
    params: unmarkedJson(row.params) ?? {},
    inputAssetIds: row.input_asset_ids ?? [],
    jobIds: row.job_ids ?? [],
    outputAssetIds: row.output_asset_ids ?? [],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.orchestrator_run_id != null) action.orchestratorRunId = row.orchestrator_run_id;
  if (row.rationale != null) action.rationale = row.rationale;
  const proposal = unmarkedJson(row.proposal);
  if (proposal) action.proposal = proposal;
  if (row.estimated_cost_usd != null) action.estimatedCostUsd = row.estimated_cost_usd;
  if (row.actual_cost_usd != null) action.actualCostUsd = row.actual_cost_usd;
  const error = unmarkedJson(row.error);
  if (error) action.error = error;
  return action;
}

async function dataAssetById(
  db: SupabaseClient,
  assetId: string
): Promise<DataAssetRow | null> {
  if (!isAssetIdShape(assetId)) return null;
  const data = await runQuery(
    "store.dataAssetById",
    db
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("media", "data")
      .maybeSingle()
  );
  return (data as DataAssetRow | null) ?? null;
}

async function latestDataAsset(
  db: SupabaseClient,
  projectId: string,
  kind: GraphAssetKind,
  role?: string
): Promise<DataAssetRow | null> {
  let query = db
    .from("assets")
    .select("*")
    .eq("project_id", projectId)
    .eq("kind", kind)
    .eq("media", "data");
  if (role) query = query.eq("role", role);
  const data = await runQuery(
    `store.latestDataAsset ${kind}`,
    query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  return (data as DataAssetRow | null) ?? null;
}

async function selectedDataAsset(
  db: SupabaseClient,
  projectId: string,
  slotRole: string,
  kind: GraphAssetKind,
  assetRole?: string
): Promise<DataAssetRow | null> {
  const selected = await runQuery(
    `store.selectedDataAsset ${slotRole}`,
    db
      .from("current_selections")
      .select("active_asset_id")
      .eq("project_id", projectId)
      .eq("slot_role", slotRole)
      .maybeSingle()
  );

  const activeAssetId = (selected as CurrentSelectionRow | null)?.active_asset_id;
  if (!activeAssetId) return latestDataAsset(db, projectId, kind, assetRole);
  const asset = await dataAssetById(db, activeAssetId);
  if (asset && asset.kind === kind && (!assetRole || asset.role === assetRole)) return asset;
  return latestDataAsset(db, projectId, kind, assetRole);
}

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
const POSTER_SLOT_ROLE = "poster";

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

interface PosterVisibilityOpts {
  publicOnly?: boolean;
}

async function readyImageAssetById(
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

async function projectPosterAsset(
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
  return (action as Pick<ActionRow, "tool"> | null)?.tool === "set_poster";
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

function inputIds(inputs: GraphAssetInput[]): string[] {
  return [...new Set(inputs.map((input) => input.assetId).filter(Boolean))].sort();
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
  await setActiveAssetSelection(
    db,
    input.projectId,
    POSTER_SLOT_ROLE,
    input.assetId,
    action.id
  );
  return mapProjectWithProjection(db, projectRow);
}

// Browser-usable URL for a poster asset. Uses the same storage resolver as the
// asset payload mapper so public/private delivery stays consistent.
async function posterUrlFor(asset: PosterAssetRow | null): Promise<string | null> {
  if (!asset) return null;
  return (await resolveAssetUrl(asset)) ?? null;
}

async function projectProjection(
  db: SupabaseClient,
  projectId: string,
  opts: PosterVisibilityOpts = {}
): Promise<{
  brief: VideoBrief | null;
  currentBriefVersionId: string | null;
  hasStoryboard: boolean;
  posterAssetId: string | null;
  posterUrl: string | null;
}> {
  const [briefAsset, storyboard, posterAsset] = await Promise.all([
    selectedDataAsset(db, projectId, "brief", "brief"),
    runQuery(
      "store.projectProjection storyboard",
      db
        .from("storyboards")
        .select("id")
        .eq("project_id", projectId)
        .limit(1)
        .maybeSingle()
    ),
    projectPosterAsset(db, projectId, opts),
  ]);
  const poster = {
    posterAssetId: posterAsset?.id ?? null,
    posterUrl: await posterUrlFor(posterAsset),
  };
  return {
    brief: briefAsset ? unmarkedContent<VideoBrief>(briefAsset.content) : null,
    currentBriefVersionId: briefAsset?.id ?? null,
    hasStoryboard: Boolean(storyboard),
    ...poster,
  };
}

async function mapProjectWithProjection(
  db: SupabaseClient,
  row: ProjectRow,
  opts: PosterVisibilityOpts = {}
): Promise<V1Project> {
  return mapProject(row, await projectProjection(db, row.id, opts));
}

async function setActiveAssetSelection(
  db: SupabaseClient,
  projectId: string,
  slotRole: "brief" | "plan" | "visual_anchors" | "cut" | typeof POSTER_SLOT_ROLE,
  activeAssetId: string,
  setByActionId?: string
): Promise<void> {
  await runQuery(
    `store.setActiveAssetSelection ${slotRole}`,
    db.from("selections").insert({
      project_id: projectId,
      slot_owner_lineage_id: null,
      slot_role: slotRole,
      active_asset_id: activeAssetId,
      set_by_action_id: setByActionId ?? null,
    })
  );
}

async function setActiveProjectScopedAssetSelection(
  db: SupabaseClient,
  projectId: string,
  slotRole: string,
  activeAssetId: string,
  setByActionId?: string
): Promise<void> {
  await runQuery(
    `store.setActiveProjectScopedAssetSelection ${slotRole}`,
    db.from("selections").insert({
      project_id: projectId,
      slot_owner_lineage_id: null,
      slot_role: slotRole,
      active_asset_id: activeAssetId,
      set_by_action_id: setByActionId ?? null,
    })
  );
}

export async function createAction(input: CreateActionInput): Promise<V1Action> {
  const db = getServiceSupabase();
  const data = await runQuery(
    `store.createAction ${input.tool}`,
    db
      .from("actions")
      .insert({
        schema_version: "action.v1",
        project_id: input.projectId,
        orchestrator_run_id: input.orchestratorRunId ?? null,
        tool: input.tool,
        status: input.status ?? "proposed",
        params: markedJson("action_params.v1", input.params ?? {}) ?? {},
        input_asset_ids: input.inputAssetIds ?? [],
        rationale: input.rationale ?? null,
        proposal: markedJson("action_proposal.v1", input.proposal) ?? null,
        estimated_cost_usd: input.estimatedCostUsd ?? null,
        actual_cost_usd: input.actualCostUsd ?? null,
        job_ids: input.jobIds ?? [],
        output_asset_ids: input.outputAssetIds ?? [],
        error: markedJson("action_error.v1", input.error) ?? null,
      })
      .select("*")
      .single()
  );
  return mapAction(data as ActionRow);
}

export async function updateAction(
  actionId: string,
  patch: UpdateActionPatch
): Promise<V1Action> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.estimatedCostUsd !== undefined) {
    row.estimated_cost_usd = patch.estimatedCostUsd;
  }
  if (patch.actualCostUsd !== undefined) row.actual_cost_usd = patch.actualCostUsd;
  if (patch.jobIds !== undefined) row.job_ids = patch.jobIds;
  if (patch.outputAssetIds !== undefined) row.output_asset_ids = patch.outputAssetIds;
  if (patch.error !== undefined) row.error = markedJson("action_error.v1", patch.error) ?? null;

  const db = getServiceSupabase();
  const data = await runQuery(
    `store.updateAction ${actionId}`,
    db.from("actions").update(row).eq("id", actionId).select("*").single()
  );
  return mapAction(data as ActionRow);
}

export async function assertRunBudgetAllows(input: {
  runId?: string;
  projectId: string;
  additionalCostUsd: number;
}): Promise<void> {
  if (!input.runId) return;
  const run = await getOrchestratorRun(input.runId);
  if (run.projectId !== input.projectId) {
    throw new Error(`Run project mismatch: ${input.runId}`);
  }
  const budgetUsd = run.budgetUsd;
  if (budgetUsd == null || budgetUsd <= 0) return;

  const db = getServiceSupabase();
  const actions = await runQuery(
    "store.assertRunBudgetAllows actions",
    db
      .from("actions")
      .select("estimated_cost_usd,actual_cost_usd,status")
      .eq("orchestrator_run_id", input.runId)
      .in("status", ["proposed", "approved", "running", "applied"])
  );

  const committedUsd = ((actions as Pick<
    ActionRow,
    "estimated_cost_usd" | "actual_cost_usd" | "status"
  >[]) ?? []).reduce((sum, action) => {
    return sum + (action.actual_cost_usd ?? action.estimated_cost_usd ?? 0);
  }, 0);
  if (committedUsd + input.additionalCostUsd > budgetUsd) {
    throw new Error(
      `Run budget exceeded: ${committedUsd + input.additionalCostUsd} exceeds ${budgetUsd}.`
    );
  }
}

export async function getAssetFingerprintPins(
  projectId: string,
  assetIds: string[]
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(assetIds)].filter(Boolean);
  if (uniqueIds.length === 0) return {};
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.getAssetFingerprintPins",
    db
      .from("assets")
      .select("id,content_hash,inputs_fingerprint")
      .eq("project_id", projectId)
      .in("id", uniqueIds)
  );
  const pins: Record<string, string> = {};
  for (const row of ((data as AssetFingerprintRow[]) ?? [])) {
    const fingerprint = row.inputs_fingerprint ?? row.content_hash;
    if (fingerprint) pins[row.id] = fingerprint;
  }
  return pins;
}

async function insertDataAsset(input: {
  db: SupabaseClient;
  workspaceId: string;
  projectId: string;
  kind:
    | "brief"
    | "beat"
    | "plan"
    | "story_blueprint"
    | "narration_script"
    | "composite"
    | "critique";
  contentSchemaKind?:
    | "brief"
    | "beat"
    | "plan"
    | "visual_anchor_plan"
    | "story_blueprint"
    | "script_draft"
    | "timeline"
    | "narration_script"
    | "critique";
  role: string;
  content: unknown;
  // Upstream asset snapshot. The DB trigger mirrors this into asset_edges, so the
  // dependency/stale graph sees this asset as a consumer of its inputs.
  inputs?: GraphAssetInput[];
  lineageId?: string;
  version?: number;
  createdByActionId?: string;
}): Promise<DataAssetRow> {
  const now = new Date().toISOString();
  const visibility = await defaultVisibilityForWorkspace(input.db, input.workspaceId);
  const contentSchemaKind =
    input.contentSchemaKind ?? (input.kind === "composite" ? "timeline" : input.kind);
  const content = markedContent(contentSchemaKind, input.content);
  const inputs = input.inputs ?? [];
  const row: Record<string, unknown> = {
    schema_version: "asset.v2",
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    kind: input.kind,
    media: "data",
    status: "ready",
    role: input.role,
    content,
    content_hash: canonicalContentHash(content),
    inputs,
    inputs_fingerprint: inputsFingerprint(inputs, null),
    visibility,
    created_at: now,
    updated_at: now,
  };
  if (input.createdByActionId) row.created_by_action_id = input.createdByActionId;
  if (input.lineageId) row.lineage_id = input.lineageId;
  if (input.version) row.version = input.version;

  const data = await runQuery(
    `store.insertDataAsset ${input.kind}`,
    input.db.from("assets").insert(row).select("*").single()
  );
  return data as DataAssetRow;
}

export interface ActiveAssetSelection {
  slotRole: string;
  asset: V1Asset;
}

// --- studio drafts ---------------------------------------------------------
interface StudioDraftRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  owner_user_id: string | null;
  local_actor_id: string | null;
  payload: StudioDraftPayload;
  display_excerpt: string;
  step: StudioDraftStep;
  project_id: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapStudioDraftSummary(row: StudioDraftRow): StudioDraftSummary {
  return {
    id: row.id,
    schemaVersion: STUDIO_DRAFT_SCHEMA_VERSION,
    workspaceId: row.workspace_id,
    displayExcerpt: row.display_excerpt,
    step: row.step,
    projectId: row.project_id ?? undefined,
    runId: row.run_id ?? undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapStudioDraft(row: StudioDraftRow): StudioDraft {
  return {
    ...mapStudioDraftSummary(row),
    payload: row.payload,
  };
}

export function displayExcerptForStudioDraft(payload: StudioDraftPayload): string {
  const goal = payload.draft.goal;
  if (typeof goal !== "string") return "Untitled draft";
  const compact = goal.trim().replace(/\s+/g, " ");
  if (!compact) return "Untitled draft";
  return compact.length > 96 ? `${compact.slice(0, 93).trimEnd()}...` : compact;
}

async function assertStudioDraftRefs(
  workspaceId: string,
  payload: StudioDraftPayload
): Promise<void> {
  if (payload.projectId) {
    await getProject(workspaceId, payload.projectId);
  }
  if (payload.runId) {
    const run = await getOrchestratorRun(payload.runId);
    await getProject(workspaceId, run.projectId);
    if (payload.projectId && payload.projectId !== run.projectId) {
      throw notFound(`Generation run not found: ${payload.runId}`);
    }
  }
}

// --- assets ----------------------------------------------------------------
// The assets table has dedicated columns for a subset of V1Asset. The
// context-family fields (context/userContext/agentContext/assetKnowledge/
// clipUnderstanding) share the single `context` jsonb column via this envelope
// so nothing is lost on round-trip.
interface AssetContextEnvelope {
  context?: AssetContext;
  userContext?: UserAssetContext;
  agentContext?: AgentAssetContext | AgentClipContext;
  assetKnowledge?: AssetKnowledge;
  clipUnderstanding?: V1Asset["clipUnderstanding"];
  analysis?: V1AssetAnalysis;
}

type GraphAssetKind =
  | "source_footage"
  | "brief"
  | "beat"
  | "anchor"
  | "keyframe"
  | "clip"
  | "audio_track"
  | "narration_script"
  | "critique"
  | "plan"
  | "story_blueprint"
  | "composite"
  | "render"
  | "poster";

type AssetMedia = "data" | "image" | "video" | "audio";

interface AssetRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  project_id: string;
  kind: GraphAssetKind;
  media: AssetMedia;
  status: "ready" | "pending";
  role: string | null;
  filename: string;
  content: unknown | null;
  params: { schema_version?: string; provenance?: GeneratedAssetProvenance } | null;
  inputs: GraphAssetInput[];
  content_hash: string | null;
  inputs_fingerprint: string | null;
  remote_url: string | null;
  storage_key: string | null;
  storage_bucket: string | null;
  source: AgentAssetSource;
  duration_sec: number | null;
  description: string | null;
  context: AssetContextEnvelope | null;
  semantic_analysis: AssetSemanticAnalysis | null;
  created_by_action_id?: string | null;
  visibility?: "public" | "private";
  created_at: string;
  updated_at: string;
}

function assetKindToGraphKind(asset: V1Asset): GraphAssetKind {
  if (asset.kind === "audio") return "audio_track";
  if (asset.kind === "image") {
    if (asset.role === "poster") return "poster";
    if (asset.role === "character_anchor" || asset.role === "scene_anchor") return "anchor";
    return asset.provenance ? "keyframe" : "anchor";
  }
  if (asset.role === "export_video") return "render";
  return asset.provenance ? "clip" : "source_footage";
}

function assetMediaToKind(media: AssetMedia, kind: GraphAssetKind): AssetKind {
  if (media === "image" || media === "video" || media === "audio") return media;
  if (kind === "audio_track") return "audio";
  if (kind === "anchor" || kind === "keyframe") return "image";
  return "video";
}

function assetContextEnvelope(asset: V1Asset): AssetContextEnvelope | null {
  const envelope: AssetContextEnvelope = {};
  if (asset.context !== undefined) envelope.context = asset.context;
  if (asset.userContext !== undefined) envelope.userContext = asset.userContext;
  if (asset.agentContext !== undefined) envelope.agentContext = asset.agentContext;
  if (asset.assetKnowledge !== undefined) envelope.assetKnowledge = asset.assetKnowledge;
  if (asset.clipUnderstanding !== undefined) {
    envelope.clipUnderstanding = asset.clipUnderstanding;
  }
  if (asset.analysis !== undefined) envelope.analysis = asset.analysis;
  return Object.keys(envelope).length > 0 ? envelope : null;
}

function assetToRow(asset: V1Asset): AssetRow {
  const params = asset.provenance
    ? { schema_version: "asset_params.v1", provenance: asset.provenance }
    : null;
  return {
    id: asset.id,
    schema_version: asset.schemaVersion,
    workspace_id: asset.workspaceId,
    project_id: asset.projectId,
    kind: assetKindToGraphKind(asset),
    media: asset.kind,
    status: asset.status,
    role: asset.role ?? null,
    filename: asset.filename,
    content: null,
    params,
    inputs: asset.graphInputs ?? [],
    content_hash: asset.contentHash ?? null,
    inputs_fingerprint:
      asset.inputsFingerprint ??
      (asset.graphInputs !== undefined || params
        ? inputsFingerprint(asset.graphInputs ?? [], params)
        : null),
    remote_url: asset.remoteUrl ?? null,
    storage_key: asset.storageKey ?? null,
    storage_bucket: asset.storageBucket ?? null,
    source: asset.source,
    duration_sec: asset.durationSec ?? null,
    description: asset.userContext?.description ?? asset.context?.summary ?? null,
    context: assetContextEnvelope(asset),
    semantic_analysis: asset.semanticAnalysis ?? null,
    created_at: asset.createdAt,
    updated_at: asset.updatedAt,
  };
}

async function contentHashesForAssets(
  db: SupabaseClient,
  projectId: string,
  assetIds: string[]
): Promise<Map<string, string | null>> {
  const uniqueIds = [...new Set(assetIds)].filter(Boolean);
  if (uniqueIds.length === 0) return new Map();

  const data = await runQuery(
    "store.contentHashesForAssets",
    db
      .from("assets")
      .select("id, content_hash")
      .eq("project_id", projectId)
      .in("id", uniqueIds)
  );

  const rows = (data ?? []) as Array<{ id: string; content_hash: string | null }>;
  return new Map(rows.map((row) => [row.id, row.content_hash]));
}

async function withGraphMetadataForInsert(
  db: SupabaseClient,
  asset: V1Asset
): Promise<V1Asset> {
  if (!asset.provenance && asset.graphInputs === undefined) return asset;

  const provenanceAssetIds = [
    ...(asset.provenance?.referenceAssetIds ?? []),
    ...(asset.provenance?.anchorIds ?? []),
  ];
  const existingInputIds = asset.graphInputs?.map((input) => input.assetId) ?? [];
  const contentHashByAssetId = await contentHashesForAssets(db, asset.projectId, [
    ...provenanceAssetIds,
    ...existingInputIds,
  ]);
  const graphInputs =
    asset.graphInputs ??
    graphInputsFromProvenance(asset.provenance, contentHashByAssetId);

  const params = asset.provenance
    ? { schema_version: "asset_params.v1", provenance: asset.provenance }
    : null;
  return {
    ...asset,
    graphInputs,
    inputsFingerprint: asset.inputsFingerprint ?? inputsFingerprint(graphInputs, params),
  };
}

function mapAssetRow(row: AssetRow): V1Asset {
  const envelope = row.context ?? {};
  const asset: V1Asset = {
    id: row.id,
    schemaVersion: SCHEMA_VERSIONS.asset,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    kind: assetMediaToKind(row.media, row.kind),
    filename: row.filename,
    status: row.status,
    source: row.source,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.remote_url != null) asset.remoteUrl = row.remote_url;
  if (row.storage_key != null) asset.storageKey = row.storage_key;
  if (row.storage_bucket != null) asset.storageBucket = row.storage_bucket;
  if (row.duration_sec != null) asset.durationSec = row.duration_sec;
  if (row.role != null) asset.role = row.role;
  if (envelope.context !== undefined) asset.context = envelope.context;
  if (envelope.userContext !== undefined) asset.userContext = envelope.userContext;
  if (envelope.agentContext !== undefined) asset.agentContext = envelope.agentContext;
  if (envelope.assetKnowledge !== undefined) asset.assetKnowledge = envelope.assetKnowledge;
  if (envelope.clipUnderstanding !== undefined) {
    asset.clipUnderstanding = envelope.clipUnderstanding;
  }
  if (envelope.analysis !== undefined) asset.analysis = envelope.analysis;
  if (row.semantic_analysis != null) asset.semanticAnalysis = row.semantic_analysis;
  if (row.params?.provenance != null) asset.provenance = row.params.provenance;
  if (Array.isArray(row.inputs) && row.inputs.length > 0) {
    asset.graphInputs = row.inputs;
  }
  if (row.content_hash != null) asset.contentHash = row.content_hash;
  if (row.inputs_fingerprint != null) {
    asset.inputsFingerprint = row.inputs_fingerprint;
  }
  if (row.visibility != null) asset.visibility = row.visibility;
  return asset;
}

async function mapAsset(row: AssetRow): Promise<V1Asset> {
  const asset = mapAssetRow(row);
  const resolvedUrl = await resolveAssetUrl(row);
  if (resolvedUrl) asset.remoteUrl = resolvedUrl;
  else delete asset.remoteUrl;
  return asset;
}

async function mapAssets(rows: AssetRow[]): Promise<V1Asset[]> {
  return Promise.all(rows.map(mapAsset));
}

async function getAssetRow(
  db: SupabaseClient,
  workspaceId: string,
  projectId: string,
  assetId: string,
  context: string
): Promise<AssetRow> {
  // A non-UUID id (e.g. a character slug like "character_homeowner" handed to
  // the character-anchor endpoint) can never match the uuid `assets.id` column;
  // treat it as the same `not_found` we return for an absent id rather than
  // letting Postgres' `22P02` surface as a database_error. See isAssetIdShape.
  if (!isAssetIdShape(assetId)) {
    throw notFound(`Asset not found: ${assetId}`);
  }
  const data = await runQuery(
    `store.${context}`,
    db
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Asset not found: ${assetId}`);
  return data as AssetRow;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------
// Find-or-create a workspace by a stable NATURAL KEY (not an app-minted id).
// Workspace ids are DB-generated (gen_random_uuid); identity singletons are
// resolved by querying the natural key and inserting (omitting `id`) only when
// absent. Two natural keys are supported, backed by partial unique indexes:
//   * the local dev workspace: owner_id IS NULL, matched by name.
//   * a per-user workspace: matched by owner_id (one workspace per domain user).
async function ensureWorkspaceByNaturalKey(
  match: { ownerId: string } | { localName: string },
  name: string
): Promise<V1Workspace> {
  const db = getServiceSupabase();
  const query = db.from("workspaces").select("*");
  const scoped =
    "ownerId" in match
      ? query.eq("owner_id", match.ownerId)
      : query.is("owner_id", null).eq("name", match.localName);
  const existing = await runQuery("store.ensureWorkspace select", scoped.maybeSingle());
  if (existing) return mapWorkspace(existing as WorkspaceRow);

  const now = new Date().toISOString();
  const inserted = await db
    .from("workspaces")
    .insert({
      schema_version: SCHEMA_VERSIONS.workspace,
      owner_id: "ownerId" in match ? match.ownerId : null,
      name,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  // Tolerate the race where a concurrent caller inserted first: the natural-key
  // unique index rejects the duplicate, so re-read and return the winner.
  if (inserted.error) {
    const rereadQuery = db.from("workspaces").select("*");
    const rescoped =
      "ownerId" in match
        ? rereadQuery.eq("owner_id", match.ownerId)
        : rereadQuery.is("owner_id", null).eq("name", match.localName);
    const reread = await rescoped.maybeSingle();
    if (reread.error) throw databaseError("store.ensureWorkspace reread", reread.error);
    if (reread.data) return mapWorkspace(reread.data as WorkspaceRow);
    throw databaseError("store.ensureWorkspace insert", inserted.error);
  }
  return mapWorkspace(inserted.data as WorkspaceRow);
}

// The single unowned local dev workspace, matched by name.
export function ensureLocalWorkspace(name: string): Promise<V1Workspace> {
  return ensureWorkspaceByNaturalKey({ localName: name }, name);
}

// The workspace owned by a given domain user (public.users.id), one per user.
export function ensureUserWorkspace(
  ownerId: string,
  name: string
): Promise<V1Workspace> {
  return ensureWorkspaceByNaturalKey({ ownerId }, name);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export async function createProject(input: {
  workspaceId: string;
  name?: string;
  brief?: VideoBrief;
}): Promise<{ project: V1Project; briefVersion: V1BriefVersion | null }> {
  const db = getServiceSupabase();
  const now = new Date().toISOString();
  const visibility = await defaultVisibilityForWorkspace(db, input.workspaceId);
  const name = await projectDisplayName({
    explicitName: input.name,
    brief: input.brief,
  });

  const insertedProject = await runQuery(
    "store.createProject insert project",
    db
      .from("projects")
      .insert({
        schema_version: SCHEMA_VERSIONS.project,
        workspace_id: input.workspaceId,
        name,
        status: "active",
        visibility,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single()
  );
  const projectRow = insertedProject as ProjectRow;
  const projectId = projectRow.id;

  let briefVersion: V1BriefVersion | null = null;
  if (input.brief) {
    const action = await createAction({
      projectId,
      tool: "create_brief",
      status: "running",
      params: { source: "createProject" },
      rationale: "Create the initial project brief asset.",
    });
    const briefAsset = await insertDataAsset({
      db,
      workspaceId: input.workspaceId,
      projectId,
      kind: "brief",
      role: "current_brief",
      content: input.brief,
      createdByActionId: action.id,
    });
    await setActiveAssetSelection(db, projectId, "brief", briefAsset.id, action.id);
    await updateAction(action.id, {
      status: "applied",
      outputAssetIds: [briefAsset.id],
    });
    briefVersion = mapBriefVersion(briefAsset);
  }

  return { project: await mapProjectWithProjection(db, projectRow), briefVersion };
}

// Attach a brief to an EXISTING project: persists a brief data-asset and points
// the project's active 'brief' selection at it, wrapped in a create_brief action
// for provenance. This is the same persistence the createProject brief-block
// runs; it is factored out so the orchestrator create_or_load_brief tool can
// write a brief into a project it did not create.
export async function addProjectBrief(input: {
  workspaceId: string;
  projectId: string;
  brief: VideoBrief;
}): Promise<V1BriefVersion> {
  const db = getServiceSupabase();
  const action = await createAction({
    projectId: input.projectId,
    tool: "create_brief",
    status: "running",
    params: { source: "create_or_load_brief" },
    rationale: "Create the project brief asset via the orchestrator tool.",
  });
  const briefAsset = await insertDataAsset({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "brief",
    role: "current_brief",
    content: input.brief,
    createdByActionId: action.id,
  });
  await setActiveAssetSelection(db, input.projectId, "brief", briefAsset.id, action.id);
  await updateAction(action.id, {
    status: "applied",
    outputAssetIds: [briefAsset.id],
  });
  return mapBriefVersion(briefAsset);
}

// Read the project's active brief (the 'brief' selection slot, falling back to
// the latest brief asset). Returns the unwrapped VideoBrief or null. Used by the
// plan_shots tool's precondition check.
export interface ActiveProjectBrief {
  brief: VideoBrief;
  /** The brief asset's id — recorded as the input of anything derived from it. */
  assetId: string;
  /** The brief asset's content hash — the stale-detection fingerprint. */
  contentHash: string;
}

export async function getActiveProjectBrief(
  projectId: string
): Promise<ActiveProjectBrief | null> {
  const db = getServiceSupabase();
  const briefAsset = await selectedDataAsset(db, projectId, "brief", "brief");
  if (!briefAsset) return null;
  return {
    brief: unmarkedContent<VideoBrief>(briefAsset.content),
    assetId: briefAsset.id,
    contentHash: briefAsset.content_hash ?? "",
  };
}

// Persist a plan (scenes + beats) as the project's active 'plan' data asset,
// wrapped in a plan_shots action for provenance. The plan records the active brief
// as its input (asset `inputs` + the action's `inputAssetIds`) so that replacing
// the brief marks this plan — and everything downstream of it — stale.
export async function addProjectPlan(input: {
  workspaceId: string;
  projectId: string;
  plan: EditPlan;
  briefAssetId?: string;
  briefContentHash?: string;
}): Promise<{ planAssetId: string }> {
  const db = getServiceSupabase();
  const planInputs: GraphAssetInput[] = input.briefAssetId
    ? [
        {
          assetId: input.briefAssetId,
          relation: "input",
          role: "brief",
          position: 0,
          ...(input.briefContentHash ? { contentHash: input.briefContentHash } : {}),
        },
      ]
    : [];
  const action = await createAction({
    projectId: input.projectId,
    tool: "plan_shots",
    status: "running",
    params: { source: "plan_shots" },
    inputAssetIds: input.briefAssetId ? [input.briefAssetId] : [],
    rationale: "Persist the shot plan as the project's active plan asset.",
  });
  const planAsset = await insertDataAsset({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "plan",
    role: "current_plan",
    content: input.plan,
    inputs: planInputs,
    createdByActionId: action.id,
  });
  await setActiveAssetSelection(db, input.projectId, "plan", planAsset.id, action.id);
  await updateAction(action.id, {
    status: "applied",
    outputAssetIds: [planAsset.id],
  });
  return { planAssetId: planAsset.id };
}

// Persist the reusable visual-anchor plan as a typed data asset. It is still a
// plan-kind graph node because it describes what later anchor-generation tools
// should create; the role + active selection distinguish it from the shot plan.
export async function addProjectVisualAnchorPlan(input: {
  workspaceId: string;
  projectId: string;
  visualAnchorPlan: VisualAnchorPlan;
  planAssetId: string;
  planContentHash: string;
}): Promise<{ visualAnchorPlanAssetId: string }> {
  const db = getServiceSupabase();
  const graphInputs: GraphAssetInput[] = [
    {
      assetId: input.planAssetId,
      relation: "input",
      role: "plan",
      position: 0,
      ...(input.planContentHash ? { contentHash: input.planContentHash } : {}),
    },
  ];
  const action = await createAction({
    projectId: input.projectId,
    tool: "plan_visual_anchors",
    status: "running",
    params: { source: "plan_visual_anchors" },
    inputAssetIds: [input.planAssetId],
    rationale: "Persist the visual-anchor plan for later anchor generation.",
  });
  const asset = await insertDataAsset({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "plan",
    contentSchemaKind: "visual_anchor_plan",
    role: "visual_anchor_plan",
    content: input.visualAnchorPlan,
    inputs: graphInputs,
    createdByActionId: action.id,
  });
  await setActiveAssetSelection(db, input.projectId, "visual_anchors", asset.id, action.id);
  await updateAction(action.id, {
    status: "applied",
    outputAssetIds: [asset.id],
  });
  return { visualAnchorPlanAssetId: asset.id };
}

export async function addProjectStoryBlueprint(input: {
  workspaceId: string;
  projectId: string;
  blueprint: StoryBlueprint;
  briefAssetId: string;
  briefContentHash: string;
}): Promise<{ storyBlueprintId: string; storyBlueprintAssetId: string }> {
  const db = getServiceSupabase();
  const graphInputs: GraphAssetInput[] = [
    {
      assetId: input.briefAssetId,
      relation: "input",
      role: "brief",
      position: 0,
      ...(input.briefContentHash ? { contentHash: input.briefContentHash } : {}),
    },
  ];
  const action = await createAction({
    projectId: input.projectId,
    tool: "develop_story_blueprint",
    status: "running",
    params: { source: "develop_story_blueprint" },
    inputAssetIds: [input.briefAssetId],
    rationale: "Persist the story blueprint as a canonical story resource.",
  });
  const asset = await insertDataAsset({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "story_blueprint",
    role: "current_story_blueprint",
    content: input.blueprint,
    inputs: graphInputs,
    createdByActionId: action.id,
  });
  const storyBlueprint = await runQuery(
    "store.addProjectStoryBlueprint insert",
    db
      .from("story_blueprints")
      .insert({
        schema_version: "storyBlueprint.v1",
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        brief_asset_id: input.briefAssetId,
        asset_id: asset.id,
        status: "draft",
        snapshot: markedContent("story_blueprint", input.blueprint),
        provenance: markedJson("story_blueprint_provenance.v1", {
          inputAssetIds: [input.briefAssetId],
          outputAssetId: asset.id,
        }),
        created_by: markedJson("story_blueprint_creator.v1", {
          actionId: action.id,
          tool: "develop_story_blueprint",
        }),
      })
      .select("*")
      .single()
  );
  const storyBlueprintId = (storyBlueprint as StoryBlueprintRow).id;
  if (input.blueprint.characters.length > 0) {
    await runQuery(
      "store.addProjectStoryBlueprint characters",
      db.from("story_blueprint_characters").insert(
        input.blueprint.characters.map((character, index) => ({
          story_blueprint_id: storyBlueprintId,
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          stable_id: character.id,
          position: index,
          name: character.name,
          role: character.role,
          description: character.description,
        }))
      )
    );
  }
  const actRows = await runQuery(
    "store.addProjectStoryBlueprint acts",
    db
      .from("story_blueprint_acts")
      .insert(
        input.blueprint.acts.map((act, index) => ({
          story_blueprint_id: storyBlueprintId,
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          stable_id: act.id,
          position: index,
          title: act.title,
          purpose: act.purpose,
          summary: act.summary,
          target_duration_sec: act.targetDurationSec,
        }))
      )
      .select("id, stable_id")
  );
  const actIdByStableId = new Map(
    ((actRows as Array<{ id: string; stable_id: string }>) ?? []).map((act) => [
      act.stable_id,
      act.id,
    ])
  );
  if (input.blueprint.scenes.length > 0) {
    await runQuery(
      "store.addProjectStoryBlueprint scenes",
      db.from("story_blueprint_scenes").insert(
        input.blueprint.scenes.map((scene, index) => {
          const actId = actIdByStableId.get(scene.actId);
          if (!actId) {
            throw new Error(`Story blueprint scene ${scene.id} references unknown act ${scene.actId}.`);
          }
          return {
            story_blueprint_id: storyBlueprintId,
            story_blueprint_act_id: actId,
            workspace_id: input.workspaceId,
            project_id: input.projectId,
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
  await setActiveProjectScopedAssetSelection(
    db,
    input.projectId,
    "story_blueprint",
    asset.id,
    action.id
  );
  await runQuery(
    "store.addProjectStoryBlueprint current pointer",
    db
      .from("projects")
      .update({ current_story_blueprint_id: storyBlueprintId })
      .eq("id", input.projectId)
  );
  await updateAction(action.id, {
    status: "applied",
    outputAssetIds: [asset.id],
  });
  return {
    storyBlueprintId,
    storyBlueprintAssetId: asset.id,
  };
}

export interface ActiveProjectStoryBlueprint {
  storyBlueprint: StoryBlueprint;
  storyBlueprintId: string;
  assetId: string;
  contentHash: string;
}

export async function getActiveProjectStoryBlueprint(
  projectId: string
): Promise<ActiveProjectStoryBlueprint | null> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.getActiveProjectStoryBlueprint",
    db
      .from("story_blueprints")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  const row = data as StoryBlueprintRow | null;
  if (!row?.asset_id) return null;
  const asset = await dataAssetById(db, row.asset_id);
  return {
    storyBlueprint: mapStoryBlueprintRecord(row).content,
    storyBlueprintId: row.id,
    assetId: row.asset_id,
    contentHash: asset?.content_hash ?? "",
  };
}

type ScriptDraftStatus = "draft" | "approved" | "archived";

interface ScriptDraftRow {
  id: string;
  schema_version: "scriptDraft.v1";
  workspace_id: string;
  project_id: string;
  brief_asset_id: string | null;
  story_blueprint_id: string;
  asset_id: string | null;
  supersedes_id: string | null;
  status: ScriptDraftStatus;
  content: Omit<
    ScriptDraft,
    | "id"
    | "projectId"
    | "briefAssetId"
    | "storyBlueprintId"
    | "scenes"
    | "createdAt"
    | "updatedAt"
    | "status"
  >;
  created_at: string;
  updated_at: string;
}

interface ScriptSceneRow {
  id: string;
  scene_key: string;
  position: number;
  title: string;
  summary: string;
  narration: string | null;
  visual_intent: string | null;
  duration_sec: number | null;
}

interface ScriptDialogueLineRow {
  script_scene_id: string;
  line_key: string;
  position: number;
  character_id: string | null;
  character_name: string | null;
  text: string;
  delivery: string | null;
}

export interface ActiveProjectScriptDraft {
  scriptDraft: ScriptDraft;
  scriptDraftId: string;
  assetId: string;
  contentHash: string;
}

function scriptDraftContent(
  input: ScriptDraft
): ScriptDraftRow["content"] {
  return {
    schemaVersion: "scriptDraft.v1",
    targetLengthSec: input.targetLengthSec,
    durationClass: input.durationClass,
    durationPlan: input.durationPlan,
    ...(input.narration ? { narration: input.narration } : {}),
    ...(input.supersedesId ? { supersedesId: input.supersedesId } : {}),
  };
}

function composeScriptDraft(input: {
  row: ScriptDraftRow;
  scenes: ScriptSceneRow[];
  dialogueLines: ScriptDialogueLineRow[];
}): ScriptDraft {
  const dialogueByScene = new Map<string, ScriptDialogueLineRow[]>();
  for (const line of input.dialogueLines) {
    const current = dialogueByScene.get(line.script_scene_id) ?? [];
    current.push(line);
    dialogueByScene.set(line.script_scene_id, current);
  }
  const scenes = input.scenes.map((scene) => ({
    id: scene.scene_key,
    title: scene.title,
    summary: scene.summary,
    ...(scene.narration ? { narration: scene.narration } : {}),
    dialogue: (dialogueByScene.get(scene.id) ?? [])
      .sort((left, right) => left.position - right.position)
      .map((line) => ({
        ...(line.character_id ? { characterId: line.character_id } : {}),
        ...(line.character_name ? { characterName: line.character_name } : {}),
        text: line.text,
        ...(line.delivery ? { delivery: line.delivery } : {}),
      })),
    ...(scene.visual_intent ? { visualIntent: scene.visual_intent } : {}),
    ...(scene.duration_sec != null ? { durationSec: scene.duration_sec } : {}),
  }));
  return {
    ...input.row.content,
    id: input.row.id,
    projectId: input.row.project_id,
    briefAssetId: input.row.brief_asset_id ?? "",
    storyBlueprintId: input.row.story_blueprint_id,
    scenes,
    createdAt: iso(input.row.created_at),
    updatedAt: iso(input.row.updated_at),
    status: input.row.status,
  };
}

async function loadScriptStructure(
  db: SupabaseClient,
  projectId: string,
  scriptDraftId: string
): Promise<{ scenes: ScriptSceneRow[]; dialogueLines: ScriptDialogueLineRow[] }> {
  const scenes = (await runQuery(
    "store.loadScriptStructure scenes",
    db
      .from("script_scenes")
      .select("*")
      .eq("project_id", projectId)
      .eq("script_draft_id", scriptDraftId)
      .order("position", { ascending: true })
  )) as ScriptSceneRow[];
  if (scenes.length === 0) return { scenes, dialogueLines: [] };
  const dialogueLines = (await runQuery(
    "store.loadScriptStructure dialogue",
    db
      .from("script_dialogue_lines")
      .select("*")
      .eq("project_id", projectId)
      .eq("script_draft_id", scriptDraftId)
      .order("position", { ascending: true })
  )) as ScriptDialogueLineRow[];
  return { scenes, dialogueLines };
}

async function insertScriptStructure(input: {
  db: SupabaseClient;
  workspaceId: string;
  projectId: string;
  scriptDraftId: string;
  scenes: ScriptDraft["scenes"];
}): Promise<void> {
  if (input.scenes.length === 0) return;
  const sceneRows = (await runQuery(
    "store.insertScriptStructure scenes",
    input.db
      .from("script_scenes")
      .insert(
        input.scenes.map((scene, index) => ({
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          script_draft_id: input.scriptDraftId,
          scene_key: scene.id,
          position: index,
          title: scene.title,
          summary: scene.summary,
          narration: scene.narration ?? null,
          visual_intent: scene.visualIntent ?? null,
          duration_sec: scene.durationSec ?? null,
        }))
      )
      .select("id, scene_key")
  )) as Array<{ id: string; scene_key: string }>;
  const sceneIdByKey = new Map(sceneRows.map((scene) => [scene.scene_key, scene.id]));
  const dialogueRows = input.scenes.flatMap((scene) => {
    const scriptSceneId = sceneIdByKey.get(scene.id);
    if (!scriptSceneId) return [];
    return scene.dialogue.map((line, index) => ({
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      script_draft_id: input.scriptDraftId,
      script_scene_id: scriptSceneId,
      line_key: `${scene.id}_line_${index + 1}`,
      position: index,
      character_id: line.characterId ?? null,
      character_name: line.characterName ?? null,
      text: line.text,
      delivery: line.delivery ?? null,
    }));
  });
  if (dialogueRows.length > 0) {
    await runQuery(
      "store.insertScriptStructure dialogue",
      input.db.from("script_dialogue_lines").insert(dialogueRows)
    );
  }
}

export async function addProjectScriptDraft(input: {
  workspaceId: string;
  projectId: string;
  scriptDraft: Omit<
    ScriptDraft,
    "id" | "projectId" | "briefAssetId" | "storyBlueprintId" | "createdAt" | "updatedAt"
  >;
  briefAssetId: string;
  briefContentHash?: string;
  storyBlueprintId: string;
  storyBlueprintAssetId: string;
  storyBlueprintContentHash?: string;
  supersedesId?: string;
}): Promise<{ scriptDraftId: string; scriptDraftAssetId: string }> {
  const db = getServiceSupabase();
  const graphInputs: GraphAssetInput[] = [
    {
      assetId: input.briefAssetId,
      relation: "input",
      role: "brief",
      position: 0,
      ...(input.briefContentHash ? { contentHash: input.briefContentHash } : {}),
    },
    {
      assetId: input.storyBlueprintAssetId,
      relation: "input",
      role: "story_blueprint",
      position: 1,
      ...(input.storyBlueprintContentHash
        ? { contentHash: input.storyBlueprintContentHash }
        : {}),
    },
  ];
  const action = await createAction({
    projectId: input.projectId,
    tool: "draft_script",
    status: "running",
    params: { source: "draft_script" },
    inputAssetIds: [input.briefAssetId, input.storyBlueprintAssetId],
    rationale: "Persist the scene-level script draft for later voice and shot planning.",
  });
  const now = new Date().toISOString();
  const scriptDraftId = randomUUID();
  const assetSnapshot: ScriptDraft = {
    ...input.scriptDraft,
    id: scriptDraftId,
    projectId: input.projectId,
    briefAssetId: input.briefAssetId,
    storyBlueprintId: input.storyBlueprintId,
    createdAt: now,
    updatedAt: now,
    ...(input.supersedesId ? { supersedesId: input.supersedesId } : {}),
  };
  const asset = await insertDataAsset({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "narration_script",
    contentSchemaKind: "script_draft",
    role: "script_draft",
    content: assetSnapshot,
    inputs: graphInputs,
    createdByActionId: action.id,
  });
  const draft = (await runQuery(
    "store.addProjectScriptDraft insert",
    db
      .from("script_drafts")
      .insert({
        id: scriptDraftId,
        schema_version: "scriptDraft.v1",
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        brief_asset_id: input.briefAssetId,
        story_blueprint_id: input.storyBlueprintId,
        asset_id: asset.id,
        supersedes_id: input.supersedesId ?? null,
        status: input.scriptDraft.status,
        content: scriptDraftContent(assetSnapshot),
        created_by_action_id: action.id,
      })
      .select("*")
      .single()
  )) as ScriptDraftRow;
  await insertScriptStructure({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    scriptDraftId: draft.id,
    scenes: input.scriptDraft.scenes,
  });
  await setActiveProjectScopedAssetSelection(
    db,
    input.projectId,
    "script_draft",
    asset.id,
    action.id
  );
  await runQuery(
    "store.addProjectScriptDraft current pointer",
    db.from("projects").update({ current_script_draft_id: draft.id }).eq("id", input.projectId)
  );
  await updateAction(action.id, {
    status: "applied",
    outputAssetIds: [asset.id],
  });
  return {
    scriptDraftId: draft.id,
    scriptDraftAssetId: asset.id,
  };
}

export async function getActiveProjectScriptDraft(
  projectId: string
): Promise<ActiveProjectScriptDraft | null> {
  const db = getServiceSupabase();
  const project = (await runQuery(
    "store.getActiveProjectScriptDraft project",
    db.from("projects").select("current_script_draft_id").eq("id", projectId).maybeSingle()
  )) as { current_script_draft_id: string | null } | null;
  const query = db.from("script_drafts").select("*").eq("project_id", projectId);
  const data = project?.current_script_draft_id
    ? await runQuery(
        "store.getActiveProjectScriptDraft current",
        query.eq("id", project.current_script_draft_id).maybeSingle()
      )
    : await runQuery(
        "store.getActiveProjectScriptDraft latest",
        query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle()
      );
  const row = data as ScriptDraftRow | null;
  if (!row?.asset_id) return null;
  const [asset, structure] = await Promise.all([
    dataAssetById(db, row.asset_id),
    loadScriptStructure(db, projectId, row.id),
  ]);
  return {
    scriptDraft: composeScriptDraft({ row, ...structure }),
    scriptDraftId: row.id,
    assetId: row.asset_id,
    contentHash: asset?.content_hash ?? "",
  };
}

export interface ActiveProjectTimelineAsset {
  assetId: string;
  contentHash: string;
  timelineId: string;
  timeline: unknown;
}

export async function getActiveProjectTimelineAsset(input: {
  workspaceId: string;
  projectId: string;
}): Promise<ActiveProjectTimelineAsset | null> {
  const db = getServiceSupabase();
  await requireProjectRow(db, input.workspaceId, input.projectId);
  const asset = await selectedDataAsset(
    db,
    input.projectId,
    "cut",
    "composite",
    "timeline"
  );
  if (!asset) return null;
  const timeline = unmarkedContent<unknown>(asset.content);
  return {
    assetId: asset.id,
    contentHash: asset.content_hash ?? "",
    timelineId: asset.id,
    timeline,
  };
}

export async function addProjectTimelineCritique(input: {
  workspaceId: string;
  projectId: string;
  timelineAssetId: string;
  timelineContentHash: string;
  critique: unknown;
}): Promise<{ critiqueAssetId: string }> {
  const db = getServiceSupabase();
  const graphInputs: GraphAssetInput[] = [
    {
      assetId: input.timelineAssetId,
      relation: "input",
      role: "timeline",
      position: 0,
      ...(input.timelineContentHash ? { contentHash: input.timelineContentHash } : {}),
    },
  ];
  const action = await createAction({
    projectId: input.projectId,
    tool: "critique_timeline",
    status: "running",
    params: { source: "critique_timeline" },
    inputAssetIds: [input.timelineAssetId],
    rationale: "Persist the timeline critique as a graph asset linked to the active timeline.",
  });
  const asset = await insertDataAsset({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "critique",
    contentSchemaKind: "critique",
    role: "timeline_critique",
    content: input.critique,
    inputs: graphInputs,
    createdByActionId: action.id,
  });
  await setActiveProjectScopedAssetSelection(db, input.projectId, "critique", asset.id, action.id);
  await updateAction(action.id, {
    status: "applied",
    outputAssetIds: [asset.id],
  });
  return { critiqueAssetId: asset.id };
}

export interface ActiveProjectPlan {
  plan: EditPlan;
  /** The plan asset id — recorded as the input of anything derived from it. */
  assetId: string;
  /** The plan asset's content hash — the stale-detection fingerprint. */
  contentHash: string;
}

// The project's active shot plan (mirrors getActiveProjectBrief). The storyboard
// stage reads this; the model only decides *when* to generate.
export async function getActiveProjectPlan(
  projectId: string
): Promise<ActiveProjectPlan | null> {
  const db = getServiceSupabase();
  const planAsset = await selectedDataAsset(db, projectId, "plan", "plan", "current_plan");
  if (!planAsset) return null;
  return {
    plan: unmarkedContent<EditPlan>(planAsset.content),
    assetId: planAsset.id,
    contentHash: planAsset.content_hash ?? "",
  };
}

export interface ActiveProjectVisualAnchorPlan {
  visualAnchorPlan: VisualAnchorPlan;
  assetId: string;
  contentHash: string;
}

export async function getActiveProjectVisualAnchorPlan(
  projectId: string
): Promise<ActiveProjectVisualAnchorPlan | null> {
  const db = getServiceSupabase();
  const asset = await selectedDataAsset(
    db,
    projectId,
    "visual_anchors",
    "plan",
    "visual_anchor_plan"
  );
  if (!asset) return null;
  return {
    visualAnchorPlan: unmarkedContent<VisualAnchorPlan>(asset.content),
    assetId: asset.id,
    contentHash: asset.content_hash ?? "",
  };
}

export async function selectGeneratedAnchorAsset(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  role: "character_anchor" | "scene_anchor";
  anchorId: string;
}): Promise<V1Asset> {
  const db = getServiceSupabase();
  const row = await getAssetRow(
    db,
    input.workspaceId,
    input.projectId,
    input.assetId,
    "selectGeneratedAnchorAsset"
  );
  if (row.media !== "image" || row.kind !== "anchor" || row.role !== input.role) {
    throw new ApiError(
      "asset_invalid",
      `Generated anchor asset ${input.assetId} is not a ${input.role}.`,
      { assetIds: [input.assetId] }
    );
  }
  await setActiveProjectScopedAssetSelection(
    db,
    input.projectId,
    `${input.role}:${input.anchorId}`,
    input.assetId
  );
  return mapAsset(row);
}

export async function getActiveProjectScopedAsset(input: {
  workspaceId: string;
  projectId: string;
  slotRole: string;
  expectedRole?: string;
}): Promise<V1Asset | null> {
  const db = getServiceSupabase();
  await requireProjectRow(db, input.workspaceId, input.projectId);
  const selected = await runQuery(
    `store.getActiveProjectScopedAsset ${input.slotRole}`,
    db
      .from("current_selections")
      .select("active_asset_id")
      .eq("project_id", input.projectId)
      .eq("slot_role", input.slotRole)
      .maybeSingle()
  );
  const assetId = (selected as CurrentSelectionRow | null)?.active_asset_id;
  if (!assetId) return null;
  const row = await getAssetRow(
    db,
    input.workspaceId,
    input.projectId,
    assetId,
    "getActiveProjectScopedAsset"
  );
  if (input.expectedRole && row.role !== input.expectedRole) return null;
  return mapAsset(row);
}

export async function selectGeneratedBeatKeyframeAsset(input: {
  workspaceId: string;
  projectId: string;
  beatId: string;
  assetId: string;
}): Promise<V1Asset> {
  const db = getServiceSupabase();
  const row = await getAssetRow(
    db,
    input.workspaceId,
    input.projectId,
    input.assetId,
    "selectGeneratedBeatKeyframeAsset"
  );
  if (row.media !== "image" || row.kind !== "keyframe" || row.role !== "beat_keyframe") {
    throw new ApiError(
      "asset_invalid",
      `Generated keyframe asset ${input.assetId} is not a beat_keyframe image.`,
      { assetIds: [input.assetId] }
    );
  }
  await setActiveProjectScopedAssetSelection(
    db,
    input.projectId,
    `beat_keyframe:${input.beatId}`,
    input.assetId
  );
  return mapAsset(row);
}

export async function selectGeneratedBeatClipAsset(input: {
  workspaceId: string;
  projectId: string;
  beatId: string;
  assetId: string;
}): Promise<V1Asset> {
  const db = getServiceSupabase();
  const row = await getAssetRow(
    db,
    input.workspaceId,
    input.projectId,
    input.assetId,
    "selectGeneratedBeatClipAsset"
  );
  if (row.media !== "video" || row.kind !== "clip" || row.role !== "beat_clip") {
    throw new ApiError(
      "asset_invalid",
      `Generated clip asset ${input.assetId} is not a beat_clip video.`,
      { assetIds: [input.assetId] }
    );
  }
  const provenance = row.params?.provenance;
  if (provenance?.beatId && provenance.beatId !== input.beatId) {
    throw new ApiError(
      "asset_invalid",
      `Generated beat asset ${input.assetId} belongs to beat ${provenance.beatId}, not ${input.beatId}.`,
      { assetIds: [input.assetId], beatId: input.beatId }
    );
  }
  await setActiveProjectScopedAssetSelection(
    db,
    input.projectId,
    `beat_clip:${input.beatId}`,
    input.assetId
  );
  return mapAsset(row);
}

export async function selectGeneratedAudioAsset(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  role: "soundtrack" | "voiceover";
  slotKey: string;
}): Promise<V1Asset> {
  const db = getServiceSupabase();
  const row = await getAssetRow(
    db,
    input.workspaceId,
    input.projectId,
    input.assetId,
    "selectGeneratedAudioAsset"
  );
  if (row.media !== "audio" || row.kind !== "audio_track" || row.role !== input.role) {
    throw new ApiError(
      "asset_invalid",
      `Generated audio asset ${input.assetId} is not a ${input.role}.`,
      { assetIds: [input.assetId] }
    );
  }
  await setActiveProjectScopedAssetSelection(
    db,
    input.projectId,
    `${input.role}:${input.slotKey}`,
    input.assetId
  );
  return mapAsset(row);
}

export async function selectProjectAssetSlot(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  slotRole: string;
  setByActionId?: string;
}): Promise<V1Asset> {
  const db = getServiceSupabase();
  const row = await getAssetRow(
    db,
    input.workspaceId,
    input.projectId,
    input.assetId,
    "selectProjectAssetSlot"
  );
  await setActiveProjectScopedAssetSelection(
    db,
    input.projectId,
    input.slotRole,
    input.assetId,
    input.setByActionId
  );
  return mapAsset(row);
}

export async function listActiveProjectAssetSelections(input: {
  workspaceId: string;
  projectId: string;
  slotRoles: string[];
}): Promise<ActiveAssetSelection[]> {
  const db = getServiceSupabase();
  const slotRoles = [...new Set(input.slotRoles)].filter(Boolean);
  if (slotRoles.length === 0) return [];

  const selected = await runQuery(
    "store.listActiveProjectAssetSelections selections",
    db
      .from("current_selections")
      .select("slot_role, active_asset_id")
      .eq("project_id", input.projectId)
      .in("slot_role", slotRoles)
  );
  const selectionRows = (selected ?? []) as Array<{
    slot_role: string;
    active_asset_id: string;
  }>;
  const assetIds = [...new Set(selectionRows.map((row) => row.active_asset_id))];
  if (assetIds.length === 0) return [];

  const data = await runQuery(
    "store.listActiveProjectAssetSelections assets",
    db
      .from("assets")
      .select("*")
      .eq("project_id", input.projectId)
      .eq("workspace_id", input.workspaceId)
      .eq("status", "ready")
      .in("id", assetIds)
  );
  const assetsById = new Map(
    (await mapAssets(data as AssetRow[])).map((asset) => [asset.id, asset])
  );
  const order = new Map(slotRoles.map((slotRole, index) => [slotRole, index]));

  return selectionRows
    .flatMap((row) => {
      const asset = assetsById.get(row.active_asset_id);
      return asset ? [{ slotRole: row.slot_role, asset }] : [];
    })
    .sort((a, b) => (order.get(a.slotRole) ?? 0) - (order.get(b.slotRole) ?? 0));
}

export async function addProjectTimeline(input: {
  workspaceId: string;
  projectId: string;
  timeline: Timeline;
  graphInputs: GraphAssetInput[];
  createdByActionId?: string;
}): Promise<{ timelineAssetId: string }> {
  const db = getServiceSupabase();
  const asset = await insertDataAsset({
    db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: "composite",
    contentSchemaKind: "timeline",
    role: "timeline",
    content: input.timeline,
    inputs: input.graphInputs,
    createdByActionId: input.createdByActionId,
  });
  await setActiveAssetSelection(
    db,
    input.projectId,
    "cut",
    asset.id,
    input.createdByActionId
  );
  return { timelineAssetId: asset.id };
}

export async function addExportVideoAsset(input: {
  workspaceId: string;
  projectId: string;
  artifact: Artifact;
  jobId: string;
  timelineId: string;
  timelineContentHash: string;
  orchestratorRunId?: string;
}): Promise<V1Asset> {
  const action = await createAction({
    projectId: input.projectId,
    ...(input.orchestratorRunId ? { orchestratorRunId: input.orchestratorRunId } : {}),
    tool: "export_video",
    status: "running",
    params: {
      agentJobId: input.jobId,
      artifactId: input.artifact.id,
      timelineId: input.timelineId,
      timelineContentHash: input.timelineContentHash,
      status: input.artifact.status,
    },
    rationale: "Record the rendered timeline export as the project's active output asset.",
  });
  const now = new Date().toISOString();
  const db = getServiceSupabase();
  const asset = await addAsset(
    {
      id: "pending",
      schemaVersion: SCHEMA_VERSIONS.asset,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: "video",
      role: "export_video",
      filename: `${input.artifact.id}.mp4`,
      status: input.artifact.status === "ready" ? "ready" : "pending",
      source: { type: "generated", generatedAssetId: input.artifact.id },
      ...(input.artifact.url ? { remoteUrl: input.artifact.url } : {}),
      ...(input.artifact.durationSec ? { durationSec: input.artifact.durationSec } : {}),
      context: {
        summary: `Export artifact for timeline ${input.timelineId}.`,
      },
      createdAt: now,
      updatedAt: now,
    },
    { createdByActionId: action.id }
  );
  await setActiveProjectScopedAssetSelection(
    db,
    input.projectId,
    "export_video",
    asset.id,
    action.id
  );
  if (asset.status === "ready") {
    await setActiveAssetSelection(db, input.projectId, "cut", asset.id, action.id);
  }
  await updateAction(action.id, {
    status: "applied",
    outputAssetIds: [asset.id],
  });
  return asset;
}

export interface PersistedStoryboardTile {
  beatId: string;
  assetId: string;
}

// Persist generated storyboard tiles (one per beat) as image asset rows, each
// recording the plan as its input so a plan/brief change marks the tiles stale.
// The relational storyboard (storyboards/scenes/panels) links to these via
// panel.image_asset_id — see buildStoryboardForPlan.
export async function addStoryboardTiles(input: {
  workspaceId: string;
  projectId: string;
  planAssetId: string;
  planContentHash: string;
  tiles: Asset[];
  createdByActionId?: string;
}): Promise<PersistedStoryboardTile[]> {
  const now = new Date().toISOString();
  const persisted: PersistedStoryboardTile[] = [];
  for (let i = 0; i < input.tiles.length; i += 1) {
    const tile = input.tiles[i];
    const beatId = tile.depicts?.beatId ?? "";
    const asset: V1Asset = {
      id: "",
      schemaVersion: SCHEMA_VERSIONS.asset,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: "image",
      role: tile.role,
      filename: tile.media.filename,
      status: "ready",
      source: { type: "generated", generatedAssetId: "" },
      // The primitive already wrote the bytes to the local generated dir; persist
      // its storage-relative locator as storageKey (NOT remoteUrl) so
      // resolveAssetUrl converts it to the API-served /generated/... URL. (remoteUrl
      // is returned verbatim and would 404 the panel images in local/dev.)
      storageKey: tile.media.url,
      durationSec: tile.media.durationSec,
      context: tile.description ? { summary: tile.description } : undefined,
      provenance: {
        provider: tile.provenance?.provider ?? "mock",
        ...(tile.provenance?.model ? { model: tile.provenance.model } : {}),
        prompt: tile.provenance?.prompt ?? "",
        ...(beatId ? { beatId } : {}),
      },
      graphInputs: [
        {
          assetId: input.planAssetId,
          relation: "input",
          role: "plan",
          position: i,
          ...(input.planContentHash ? { contentHash: input.planContentHash } : {}),
        },
      ],
      contentHash: canonicalContentHash({ url: tile.media.url, beatId }),
      createdAt: now,
      updatedAt: now,
    };
    const created = await addAsset(
      asset,
      input.createdByActionId ? { createdByActionId: input.createdByActionId } : {}
    );
    persisted.push({ beatId, assetId: created.id });
  }
  return persisted;
}

export async function getProject(
  workspaceId: string,
  projectId: string
): Promise<V1Project> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.getProject",
    db
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!data) throw notFound(`Project not found: ${projectId}`);
  return mapProjectWithProjection(db, data as ProjectRow);
}

// Point the project-scoped 'poster' selection slot at an image asset. Any
// ready image in the project qualifies (a keyframe can be the poster until a
// dedicated poster-kind asset is generated); history stays in selections.
export async function setProjectPoster(
  workspaceId: string,
  projectId: string,
  assetId: string
): Promise<V1Project> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.setProjectPoster project",
    db
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!data) throw notFound(`Project not found: ${projectId}`);
  const projectRow = data as ProjectRow;

  const asset = await readyImageAssetById(db, projectId, assetId);
  if (!asset) {
    throw new ApiError(
      "validation_failed",
      `Asset ${assetId} is not a ready image asset in project ${projectId}.`
    );
  }

  const action = await createAction({
    projectId,
    tool: "set_poster",
    status: "applied",
    params: { assetId },
    inputAssetIds: [assetId],
    rationale: "Set the project poster (dashboard thumbnail).",
  });
  await setActiveAssetSelection(db, projectId, POSTER_SLOT_ROLE, assetId, action.id);
  return mapProjectWithProjection(db, projectRow);
}

interface StoryboardRow {
  id: string;
  project_id: string;
  plan_asset_id: string | null;
  status: StoryboardStatus;
  created_at: string;
  updated_at: string;
}

interface StoryboardSceneRow {
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
    status: row.status,
    beatAssetId: row.beat_asset_id,
    panels,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapStoryboardScene(
  row: StoryboardSceneRow,
  beats: StoryboardBeat[]
): StoryboardScene {
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
    beats,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapStoryboard(
  row: StoryboardRow,
  scenes: StoryboardScene[]
): ProjectStoryboard {
  return {
    id: row.id,
    projectId: row.project_id,
    planAssetId: row.plan_asset_id,
    status: row.status,
    scenes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function getStoryboardRow(
  db: SupabaseClient,
  projectId: string,
  storyboardId?: string | null
): Promise<StoryboardRow | null> {
  let query = db
    .from("storyboards")
    .select("*")
    .eq("project_id", projectId);
  if (storyboardId) query = query.eq("id", storyboardId);
  const data = await runQuery(
    "store.getStoryboardRow",
    query.order("created_at", { ascending: false }).limit(1).maybeSingle()
  );
  return (data as StoryboardRow | null) ?? null;
}

async function requireProjectRow(
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

export async function getProjectStoryboard(
  workspaceId: string,
  projectId: string
): Promise<ProjectStoryboard | null> {
  const db = getServiceSupabase();
  await requireProjectRow(db, workspaceId, projectId);
  const storyboard = await getStoryboardRow(db, projectId);
  if (!storyboard) return null;

  const scenesData = await runQuery(
    "store.getProjectStoryboard scenes",
    db
      .from("storyboard_scenes")
      .select("*")
      .eq("project_id", projectId)
      .eq("storyboard_id", storyboard.id)
      .order("scene_index", { ascending: true })
  );
  const sceneRows = (scenesData ?? []) as StoryboardSceneRow[];
  const sceneIds = sceneRows.map((scene) => scene.id);

  const beatsData = sceneIds.length
    ? await runQuery(
        "store.getProjectStoryboard beats",
        db
          .from("storyboard_beats")
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
        "store.getProjectStoryboard panels",
        db
          .from("storyboard_panels")
          .select("*")
          .eq("project_id", projectId)
          .in("beat_id", beatIds)
          .order("panel_index", { ascending: true })
      )
    : [];
  const panelRows = (panelsData ?? []) as StoryboardPanelRow[];

  const panelsByBeat = new Map<string, StoryboardPanel[]>();
  for (const panel of panelRows.map(mapStoryboardPanel)) {
    panelsByBeat.set(panel.beatId, [...(panelsByBeat.get(panel.beatId) ?? []), panel]);
  }

  const beatsByScene = new Map<string, StoryboardBeat[]>();
  for (const beatRow of beatRows) {
    const beat = mapStoryboardBeat(beatRow, panelsByBeat.get(beatRow.id) ?? []);
    beatsByScene.set(beat.sceneId, [...(beatsByScene.get(beat.sceneId) ?? []), beat]);
  }

  return mapStoryboard(
    storyboard,
    sceneRows.map((scene) => mapStoryboardScene(scene, beatsByScene.get(scene.id) ?? []))
  );
}

function semanticBeatChanged(
  before: StoryboardBeatRow,
  after: SaveStoryboardBeatInput
): boolean {
  return (
    before.intent !== after.intent ||
    before.visual_description !== (after.visualDescription ?? null) ||
    before.dialogue_summary !== (after.dialogueSummary ?? null) ||
    before.narration !== (after.narration ?? null) ||
    before.duration_sec !== (after.durationSec ?? null)
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
function isAssetIdShape(assetId: string): boolean {
  return UUID_RE.test(assetId);
}

async function assertStoryboardIdAvailable(
  db: SupabaseClient,
  projectId: string,
  storyboardId: string | null | undefined
): Promise<void> {
  assertUuid(storyboardId, "id");
  if (!storyboardId) return;
  const data = await runQuery(
    "store.assertStoryboardIdAvailable",
    db.from("storyboards").select("id, project_id").eq("id", storyboardId).maybeSingle()
  );
  if (data && (data as StoryboardRow).project_id !== projectId) {
    throw new ApiError("validation_failed", "Storyboard id belongs to another project.");
  }
}

async function assertStoryboardRowsAreWritable(input: {
  db: SupabaseClient;
  projectId: string;
  storyboardId: string;
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
        .from("storyboard_scenes")
        .select("id, project_id, storyboard_id")
        .in("id", sceneIds)
    );
    for (const row of (data ?? []) as StoryboardSceneRow[]) {
      if (row.project_id !== input.projectId || row.storyboard_id !== input.storyboardId) {
        throw new ApiError(
          "validation_failed",
          `Scene id belongs to another storyboard: ${row.id}.`
        );
      }
    }
  }

  if (beatIds.length === 0) return;
  const beatsData = await runQuery(
    "store.assertStoryboardRowsAreWritable beats",
    input.db
      .from("storyboard_beats")
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
          .from("storyboard_scenes")
          .select("id, project_id, storyboard_id")
          .in("id", existingBeatSceneIds)
      )
    : [];
  const sceneById = new Map(
    ((beatScenesData ?? []) as StoryboardSceneRow[]).map((scene) => [scene.id, scene])
  );
  for (const row of existingBeatRows) {
    const scene = sceneById.get(row.scene_id);
    if (
      row.project_id !== input.projectId ||
      !scene ||
      scene.project_id !== input.projectId ||
      scene.storyboard_id !== input.storyboardId
    ) {
      throw new ApiError(
        "validation_failed",
        `Beat id belongs to another storyboard: ${row.id}.`
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
        .from("storyboard_scenes")
        .update({ scene_index: scene.sceneIndex })
        .eq("project_id", projectId)
        .eq("id", scene.id)
    );
  }
  for (const beat of beats) {
    await runQuery(
      "store.restoreStoryboardOrder beat",
      db
        .from("storyboard_beats")
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
  await requireProjectRow(db, workspaceId, projectId);
  const now = new Date().toISOString();
  await assertStoryboardIdAvailable(db, projectId, input.id);
  let storyboard = await getStoryboardRow(db, projectId, input.id);
  const storyboardId = storyboard?.id ?? input.id ?? randomUUID();
  await assertStoryboardRowsAreWritable({
    db,
    projectId,
    storyboardId,
    storyboard: input,
  });
  if (!storyboard) {
    const data = await runQuery(
      "store.saveProjectStoryboard create storyboard",
      db
        .from("storyboards")
        .insert({
          id: storyboardId,
          project_id: projectId,
          status: input.status ?? "draft",
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single()
    );
    storyboard = data as StoryboardRow;
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
        status: beat.status,
        beat_asset_id: beat.beatAssetId,
        created_at: beat.createdAt,
        updated_at: beat.updatedAt,
      });
    }
  }

  const sceneRows = input.scenes.map((scene, index) => ({
    id: scene.id,
    project_id: projectId,
    storyboard_id: storyboardId,
    scene_index: index,
    title: scene.title,
    summary: scene.summary ?? null,
    setting: scene.setting ?? null,
    mood: scene.mood ?? null,
    duration_sec: scene.durationSec ?? null,
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
        beat_index: index,
        intent: beat.intent,
        visual_description: beat.visualDescription ?? null,
        dialogue_summary: beat.dialogueSummary ?? null,
        narration: beat.narration ?? null,
        duration_sec: beat.durationSec ?? null,
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
          .from("storyboard_scenes")
          .update({ scene_index: 10000 + index })
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
            .from("storyboard_scenes")
            .update(sceneRow)
            .eq("project_id", projectId)
            .eq("id", sceneRow.id)
        );
      } else {
        await runQuery(
          "store.saveProjectStoryboard insert scene",
          db.from("storyboard_scenes").insert(sceneRow)
        );
      }
    }

    const existingBeatIds = [...existingBeats.keys()];
    for (const [index, id] of existingBeatIds.entries()) {
      await runQuery(
        "store.saveProjectStoryboard offset beats",
        db
          .from("storyboard_beats")
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
              .from("storyboard_beats")
              .update(beatRow)
              .eq("project_id", projectId)
              .eq("id", id)
          );
        } else {
          await runQuery(
            "store.saveProjectStoryboard insert beat",
            db.from("storyboard_beats").insert(beatRow)
          );
        }
      }
    }

    if (removeBeatIds.length > 0) {
      await runQuery(
        "store.saveProjectStoryboard remove beats",
        db
          .from("storyboard_beats")
          .delete()
          .eq("project_id", projectId)
          .in("id", removeBeatIds)
      );
    }
    if (removeSceneIds.length > 0) {
      await runQuery(
        "store.saveProjectStoryboard remove scenes",
        db
          .from("storyboard_scenes")
          .delete()
          .eq("project_id", projectId)
          .in("id", removeSceneIds)
      );
    }

    await runQuery(
      "store.saveProjectStoryboard update storyboard",
      db
        .from("storyboards")
        .update({ status: input.status ?? storyboard.status, updated_at: now })
        .eq("project_id", projectId)
        .eq("id", storyboard.id)
    );
  } catch (err) {
    await restoreStoryboardOrder(db, projectId, sceneOrderBackup, beatOrderBackup);
    throw err;
  }

  const saved = await getProjectStoryboard(workspaceId, projectId);
  if (!saved) throw notFound(`Storyboard not found: ${storyboard.id}`);
  return saved;
}

export async function listProjects(
  workspaceId: string,
  limit: number,
  cursor: string | null
): Promise<PageResult<V1Project>> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listProjects",
    db
      .from("projects")
      .select("*")
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
  );
  const all = await Promise.all(
    (data as ProjectRow[]).map((row) => mapProjectWithProjection(db, row))
  );
  return paginate(all, limit, cursor);
}

export async function listPublicProjects(
  limit: number,
  cursor: string | null
): Promise<PageResult<V1Project>> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listPublicProjects",
    db
      .from("projects")
      .select("*, workspaces!inner(purpose)")
      .eq("visibility", "public")
      .eq("workspaces.purpose", "user")
      .neq("status", "deleted")
  );
  const all = await Promise.all(
    (data as ProjectRow[]).map((row) =>
      mapProjectWithProjection(db, row, { publicOnly: true })
    )
  );
  return paginate(all, limit, cursor);
}

export async function setBrief(
  workspaceId: string,
  projectId: string,
  brief: VideoBrief
): Promise<V1Project> {
  const db = getServiceSupabase();
  const { project } = await createBriefVersion(workspaceId, projectId, brief);
  return project;
}

export async function createBriefVersion(
  workspaceId: string,
  projectId: string,
  brief: VideoBrief
): Promise<{ project: V1Project; briefVersion: V1BriefVersion }> {
  // Confirm the project exists within the workspace before writing the version.
  const db = getServiceSupabase();
  await getProject(workspaceId, projectId);
  const previous = await selectedDataAsset(db, projectId, "brief", "brief");
  const action = await createAction({
    projectId,
    tool: previous ? "update_brief" : "create_brief",
    status: "running",
    params: { source: "createBriefVersion" },
    inputAssetIds: previous ? [previous.id] : [],
    rationale: previous
      ? "Create a new immutable brief asset version."
      : "Create the initial brief asset.",
  });
  const briefAsset = await insertDataAsset({
    db,
    workspaceId,
    projectId,
    kind: "brief",
    role: "current_brief",
    content: brief,
    lineageId: previous?.lineage_id,
    version: previous ? previous.version + 1 : undefined,
    createdByActionId: action.id,
  });
  await setActiveAssetSelection(db, projectId, "brief", briefAsset.id, action.id);
  await updateAction(action.id, {
    status: "applied",
    outputAssetIds: [briefAsset.id],
  });
  return {
    project: await getProject(workspaceId, projectId),
    briefVersion: mapBriefVersion(briefAsset),
  };
}

export async function listBriefVersions(
  workspaceId: string,
  projectId: string,
  limit: number,
  cursor: string | null
): Promise<PageResult<V1BriefVersion>> {
  await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listBriefVersions",
    db
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", "brief")
      .eq("media", "data")
  );
  const all = (data as DataAssetRow[]).map(mapBriefVersion);
  return paginate(all, limit, cursor);
}

// ---------------------------------------------------------------------------
// Studio drafts
// ---------------------------------------------------------------------------
export async function listStudioDrafts(
  workspaceId: string,
  actor: { id: string; isLocal: boolean },
  limit: number,
  cursor: string | null
): Promise<PageResult<StudioDraftSummary>> {
  const db = getServiceSupabase();
  let query = db
    .from("studio_drafts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });
  query = actor.isLocal
    ? query.eq("local_actor_id", actor.id).is("owner_user_id", null)
    : query.eq("owner_user_id", actor.id);

  const data = await runQuery("store.listStudioDrafts", query);
  const all = (data as StudioDraftRow[]).map(mapStudioDraftSummary);
  return paginateByUpdatedAt(all, limit, cursor);
}

export async function createStudioDraft(input: {
  workspaceId: string;
  actor: { id: string; isLocal: boolean };
  payload: StudioDraftPayload;
}): Promise<StudioDraft> {
  await assertStudioDraftRefs(input.workspaceId, input.payload);
  const db = getServiceSupabase();
  const now = new Date().toISOString();
  const row = {
    schema_version: STUDIO_DRAFT_SCHEMA_VERSION,
    workspace_id: input.workspaceId,
    owner_user_id: input.actor.isLocal ? null : input.actor.id,
    local_actor_id: input.actor.isLocal ? input.actor.id : null,
    payload: input.payload,
    display_excerpt: displayExcerptForStudioDraft(input.payload),
    step: input.payload.step,
    project_id: input.payload.projectId ?? null,
    run_id: input.payload.runId ?? null,
    created_at: now,
    updated_at: now,
  };

  const data = await runQuery(
    "store.createStudioDraft",
    db.from("studio_drafts").insert(row).select("*").single()
  );
  return mapStudioDraft(data as StudioDraftRow);
}

export async function getStudioDraft(
  workspaceId: string,
  actor: { id: string; isLocal: boolean },
  draftId: string
): Promise<StudioDraft> {
  const db = getServiceSupabase();
  let query = db
    .from("studio_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("workspace_id", workspaceId);
  query = actor.isLocal
    ? query.eq("local_actor_id", actor.id).is("owner_user_id", null)
    : query.eq("owner_user_id", actor.id);

  const data = await runQuery("store.getStudioDraft", query.maybeSingle());
  if (!data) throw notFound(`Studio draft not found: ${draftId}`);
  return mapStudioDraft(data as StudioDraftRow);
}

export async function updateStudioDraft(input: {
  workspaceId: string;
  actor: { id: string; isLocal: boolean };
  draftId: string;
  payload: StudioDraftPayload;
}): Promise<StudioDraft> {
  await assertStudioDraftRefs(input.workspaceId, input.payload);
  const db = getServiceSupabase();
  const patch = {
    payload: input.payload,
    display_excerpt: displayExcerptForStudioDraft(input.payload),
    step: input.payload.step,
    project_id: input.payload.projectId ?? null,
    run_id: input.payload.runId ?? null,
    updated_at: new Date().toISOString(),
  };

  let query = db
    .from("studio_drafts")
    .update(patch)
    .eq("id", input.draftId)
    .eq("workspace_id", input.workspaceId);
  query = input.actor.isLocal
    ? query.eq("local_actor_id", input.actor.id).is("owner_user_id", null)
    : query.eq("owner_user_id", input.actor.id);

  const data = await runQuery("store.updateStudioDraft", query.select("*").maybeSingle());
  if (!data) throw notFound(`Studio draft not found: ${input.draftId}`);
  return mapStudioDraft(data as StudioDraftRow);
}

export async function deleteStudioDraft(
  workspaceId: string,
  actor: { id: string; isLocal: boolean },
  draftId: string
): Promise<void> {
  const db = getServiceSupabase();
  let query = db
    .from("studio_drafts")
    .delete()
    .eq("id", draftId)
    .eq("workspace_id", workspaceId);
  query = actor.isLocal
    ? query.eq("local_actor_id", actor.id).is("owner_user_id", null)
    : query.eq("owner_user_id", actor.id);

  const data = await runQuery("store.deleteStudioDraft", query.select("id").maybeSingle());
  if (!data) throw notFound(`Studio draft not found: ${draftId}`);
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
export async function addAsset(
  asset: V1Asset,
  options: { createdByActionId?: string } = {}
): Promise<V1Asset> {
  const db = getServiceSupabase();
  const assetWithGraph = await withGraphMetadataForInsert(db, asset);
  // Omit `id` so Postgres assigns it (gen_random_uuid); any id on the incoming
  // object is a placeholder and is read back from the inserted row.
  const { id: _omit, ...row } = assetToRow(assetWithGraph);
  void _omit;
  row.visibility = await defaultVisibilityForWorkspace(db, assetWithGraph.workspaceId);
  if (options.createdByActionId) {
    row.created_by_action_id = options.createdByActionId;
  }
  const data = await runQuery(
    "store.addAsset",
    db.from("assets").insert(row).select("*").single()
  );
  return mapAsset(data as AssetRow);
}

export async function getAsset(
  workspaceId: string,
  projectId: string,
  assetId: string
): Promise<V1Asset> {
  const db = getServiceSupabase();
  return mapAsset(await getAssetRow(db, workspaceId, projectId, assetId, "getAsset"));
}

export async function updateAsset(
  workspaceId: string,
  projectId: string,
  assetId: string,
  updater: (asset: V1Asset) => void
): Promise<V1Asset> {
  // Read-modify-write: load the current row (with tenancy filter), apply the
  // mutation in memory, then persist the full row back.
  const db = getServiceSupabase();
  const current = mapAssetRow(
    await getAssetRow(db, workspaceId, projectId, assetId, "updateAsset read")
  );
  updater(current);
  current.updatedAt = new Date().toISOString();

  const row = assetToRow(current);
  const data = await runQuery(
    "store.updateAsset",
    db
      .from("assets")
      .update({
        status: row.status,
        filename: row.filename,
        remote_url: row.remote_url,
        storage_key: row.storage_key,
        storage_bucket: row.storage_bucket,
        duration_sec: row.duration_sec,
        description: row.description,
        context: row.context,
        semantic_analysis: row.semantic_analysis,
        updated_at: row.updated_at,
      })
      .eq("id", assetId)
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .maybeSingle()
  );
  if (!data) throw notFound(`Asset not found: ${assetId}`);
  return mapAsset(data as AssetRow);
}

export async function setAssetVisibility(
  workspaceId: string,
  projectId: string,
  assetId: string,
  visibility: "public" | "private",
  options: { actorId?: string; store?: VisibilityObjectStore } = {}
): Promise<V1Asset> {
  const db = getServiceSupabase();

  const projectData = await runQuery(
    "store.setAssetVisibility project",
    db
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!projectData) throw notFound(`Project not found: ${projectId}`);
  const project = projectData as ProjectRow;

  if (!isAssetIdShape(assetId)) throw notFound(`Asset not found: ${assetId}`);
  const currentData = await runQuery(
    "store.setAssetVisibility current",
    db
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!currentData) throw notFound(`Asset not found: ${assetId}`);
  const current = currentData as AssetRow;

  const action = await createAction({
    projectId,
    tool: "set_asset_visibility",
    status: "running",
    params: {
      actorId: options.actorId,
      assetId,
      previousVisibility: current.visibility ?? "public",
      visibility,
      projectVisibility: project.visibility ?? "public",
    },
    inputAssetIds: [assetId],
    rationale: `Set asset visibility to ${visibility}.`,
  });

  let updated: AssetRow | null = null;
  try {
    await reconcileAssetStorage({
      asset: {
        id: assetId,
        storageKey: current.storage_key,
        storageBucket: current.storage_bucket,
        visibility,
      },
      projectVisibility: project.visibility ?? "public",
      previousEffectiveVisibility:
        (current.visibility ?? "public") === "public" &&
        (project.visibility ?? "public") === "public"
          ? "public"
          : "private",
      store: options.store,
      persistStorageBucket: async (storageBucket) => {
        const data = await runQuery(
          "store.setAssetVisibility update",
          db
            .from("assets")
            .update({
              visibility,
              storage_bucket: storageBucket,
              updated_at: new Date().toISOString(),
            })
            .eq("id", assetId)
            .eq("project_id", projectId)
            .eq("workspace_id", workspaceId)
            .select("*")
            .maybeSingle()
        );
        if (!data) throw notFound(`Asset not found: ${assetId}`);
        updated = data as AssetRow;
      },
    });
    await updateAction(action.id, {
      status: "applied",
      outputAssetIds: [assetId],
    });
  } catch (error) {
    await updateAction(action.id, {
      status: "failed",
      error: {
        message: error instanceof Error ? error.message : "Visibility update failed.",
      },
    });
    throw error;
  }

  if (!updated) throw new ApiError("internal_error", "Asset visibility update failed.");
  return mapAsset(updated);
}

export async function setProjectVisibility(
  workspaceId: string,
  projectId: string,
  visibility: "public" | "private",
  options: { actorId?: string; store?: VisibilityObjectStore } = {}
): Promise<V1Project> {
  const db = getServiceSupabase();

  const projectData = await runQuery(
    "store.setProjectVisibility project",
    db
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!projectData) throw notFound(`Project not found: ${projectId}`);
  const project = projectData as ProjectRow;

  const assetData = await runQuery(
    "store.setProjectVisibility assets",
    db
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("media", "data")
  );
  const assets = (assetData ?? []) as AssetRow[];

  const action = await createAction({
    projectId,
    tool: "set_project_visibility",
    status: "running",
    params: {
      actorId: options.actorId,
      previousVisibility: project.visibility ?? "public",
      visibility,
      assetCount: assets.length,
    },
    inputAssetIds: assets.map((asset) => asset.id),
    rationale: `Set project visibility to ${visibility} and reconcile asset storage.`,
  });

  try {
    for (const asset of assets) {
      await reconcileAssetStorage({
        asset: {
          id: asset.id,
          storageKey: asset.storage_key,
          storageBucket: asset.storage_bucket,
          visibility: asset.visibility ?? "public",
        },
        projectVisibility: visibility,
        previousEffectiveVisibility:
          (asset.visibility ?? "public") === "public" &&
          (project.visibility ?? "public") === "public"
            ? "public"
            : "private",
        store: options.store,
        persistStorageBucket: async (storageBucket) => {
          await runQuery(
            "store.setProjectVisibility asset bucket",
            db
              .from("assets")
              .update({
                storage_bucket: storageBucket,
                updated_at: new Date().toISOString(),
              })
              .eq("id", asset.id)
              .eq("project_id", projectId)
              .eq("workspace_id", workspaceId)
          );
        },
      });
    }

    const data = await runQuery(
      "store.setProjectVisibility update project",
      db
        .from("projects")
        .update({ visibility, updated_at: new Date().toISOString() })
        .eq("id", projectId)
        .eq("workspace_id", workspaceId)
        .neq("status", "deleted")
        .select("*")
        .maybeSingle()
    );
    if (!data) throw notFound(`Project not found: ${projectId}`);

    await updateAction(action.id, {
      status: "applied",
      outputAssetIds: assets.map((asset) => asset.id),
    });
    return mapProjectWithProjection(db, data as ProjectRow);
  } catch (error) {
    await updateAction(action.id, {
      status: "failed",
      error: {
        message: error instanceof Error ? error.message : "Project visibility update failed.",
      },
    });
    throw error;
  }
}

export async function updateAssetAnalysis(
  workspaceId: string,
  projectId: string,
  assetId: string,
  patch: {
    context?: AssetContext;
    semanticAnalysis?: AssetSemanticAnalysis;
    analysis: V1AssetAnalysis;
  }
): Promise<V1Asset> {
  return updateAsset(workspaceId, projectId, assetId, (asset) => {
    asset.analysis = patch.analysis;
    if (patch.context) asset.context = patch.context;
    if (patch.semanticAnalysis) asset.semanticAnalysis = patch.semanticAnalysis;
  });
}

export async function listAssets(
  workspaceId: string,
  projectId: string,
  limit: number,
  cursor: string | null
): Promise<PageResult<V1Asset>> {
  await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listAssets",
    db
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("media", "data")
  );
  const all = await mapAssets(data as AssetRow[]);
  return paginate(all, limit, cursor);
}

interface AssetSemanticSearchRpcRow extends AssetRow {
  embedding_id: string;
  chunk_key: string;
  chunk_kind: string;
  embedding_model: string;
  source_hash: string;
  source_text: string;
  vector_score: number;
  text_score: number;
  hybrid_score: number;
}

export interface AssetSemanticSearchResult {
  asset: V1Asset;
  score: {
    hybrid: number;
    vector: number;
    text: number;
  };
  chunk: {
    id: string;
    key: string;
    kind: string;
    embeddingModel: string;
    sourceHash: string;
    sourceText: string;
  };
}

export interface AssetSemanticSearchResponse {
  items: AssetSemanticSearchResult[];
}

function embeddingVectorLiteral(values: number[]): string {
  return `[${values.map((value) => String(value)).join(",")}]`;
}

export async function searchProjectAssetsSemantic(
  workspaceId: string,
  projectId: string,
  input: AssetSemanticSearchInput
): Promise<AssetSemanticSearchResponse> {
  await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.searchProjectAssetsSemantic",
    db.rpc("search_project_asset_embeddings", {
      p_workspace_id: workspaceId,
      p_project_id: projectId,
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

interface AssetWithProjectRow extends AssetRow {
  projects?: {
    id: string;
    visibility: "public" | "private";
    status: "active" | "deleted";
    workspaces?: { purpose: string };
  };
}

// Workspace-scoped asset summary for the cross-project dashboard list.
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
  url?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  visibility: "public" | "private";
  createdAt: string;
  updatedAt: string;
}

export interface AssetMediaUrls {
  url: string | null;
  thumbnailUrl?: string | null;
  expiresAt: string;
}

export interface AssetMediaUrlRow {
  media: AssetMedia;
  kind: GraphAssetKind;
  status: "ready" | "pending";
  remote_url: string | null;
  storage_key: string | null;
  storage_bucket?: string | null;
  visibility?: "public" | "private" | null;
}

interface WorkspaceAssetJoinRow extends AssetRow {
  projects?: { name: string; status: "active" | "deleted" };
}

const MEDIA_URL_EXPIRES_IN_SEC = 60 * 60;

function mediaUrlExpiresAt(now: () => Date = () => new Date()): string {
  return new Date(now().getTime() + MEDIA_URL_EXPIRES_IN_SEC * 1000).toISOString();
}

export async function assetMediaUrlsForRow(
  row: AssetMediaUrlRow,
  opts: { now?: () => Date } = {}
): Promise<AssetMediaUrls> {
  let url: string | null = null;
  if (row.status === "ready" && row.media !== "data") {
    try {
      url = (await resolveAssetUrl(row, { privateTtlSec: MEDIA_URL_EXPIRES_IN_SEC })) ?? null;
    } catch {
      url = remoteAssetUrlForDelivery(row.remote_url) ?? null;
    }
  }

  return {
    url,
    thumbnailUrl: assetMediaToKind(row.media, row.kind) === "image" ? url : null,
    expiresAt: mediaUrlExpiresAt(opts.now),
  };
}

export async function getAssetMediaUrls(
  workspaceId: string,
  assetId: string
): Promise<AssetMediaUrls> {
  if (!isAssetIdShape(assetId)) throw notFound(`Asset not found: ${assetId}`);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.getAssetMediaUrls",
    db
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("workspace_id", workspaceId)
      .neq("media", "data")
      .maybeSingle()
  );
  if (!data) throw notFound(`Asset not found: ${assetId}`);

  const row = data as AssetRow;
  return assetMediaUrlsForRow(row);
}

// Workspace-scoped asset read for flows that only carry an asset id (e.g. the
// media viewer's regenerate action), mirroring getAssetMediaUrls' scoping.
export async function getAssetByWorkspace(
  workspaceId: string,
  assetId: string
): Promise<V1Asset> {
  if (!isAssetIdShape(assetId)) throw notFound(`Asset not found: ${assetId}`);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.getAssetByWorkspace",
    db
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Asset not found: ${assetId}`);
  return mapAsset(data as AssetRow);
}

export interface RegeneratedAssetMedia {
  storageKey: string;
  storageBucket: string;
  filename: string;
  /** sha256 of the regenerated bytes; refreshes the row's content identity. */
  contentHash?: string;
  durationSec?: number;
  provenance: GeneratedAssetProvenance;
}

// Point an existing asset at freshly generated + uploaded bytes IN PLACE: same
// id, so every reference to the asset keeps working and a previously dead URL
// becomes live again. Bumps `version`, refreshes the stored generation
// provenance/prompt, clears any stale remote_url, and returns the now-live
// media urls. Workspace-scoped to match the regenerate entry point.
export async function applyRegeneratedAssetMedia(
  workspaceId: string,
  assetId: string,
  update: RegeneratedAssetMedia
): Promise<AssetMediaUrls> {
  if (!isAssetIdShape(assetId)) throw notFound(`Asset not found: ${assetId}`);
  const db = getServiceSupabase();
  const current = await runQuery(
    "store.applyRegeneratedAssetMedia read",
    db
      .from("assets")
      .select("version")
      .eq("id", assetId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!current) throw notFound(`Asset not found: ${assetId}`);
  const nextVersion = (((current as { version: number | null }).version ?? 1) + 1);

  const data = await runQuery(
    "store.applyRegeneratedAssetMedia",
    db
      .from("assets")
      .update({
        status: "ready",
        filename: update.filename,
        remote_url: null,
        storage_key: update.storageKey,
        storage_bucket: update.storageBucket,
        params: { schema_version: "asset_params.v1", provenance: update.provenance },
        version: nextVersion,
        ...(update.contentHash != null ? { content_hash: update.contentHash } : {}),
        ...(update.durationSec != null ? { duration_sec: update.durationSec } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", assetId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .maybeSingle()
  );
  if (!data) throw notFound(`Asset not found: ${assetId}`);
  return assetMediaUrlsForRow(data as AssetRow);
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

interface WorkspaceProjectRef {
  id: string;
  name: string;
}

// Enumerate the workspace's active projects as {id, name} refs. Pulls the full
// set (the per-project run/output reads dominate the cost, and pagination is
// applied to the flattened result, not the project list).
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

// A generation run plus its owning project's name, for the cross-project
// Projects/Runs view. The wire shape is `GenerationRun & { projectName }`,
// matching the web client's WorkspaceGenerationRun.
export interface WorkspaceGenerationRunSummary extends GenerationRun {
  projectName: string;
}

export interface ListWorkspaceGenerationRunsDeps {
  listProjects: (workspaceId: string) => Promise<WorkspaceProjectRef[]>;
  listRunsForProject: (projectId: string) => Promise<OrchestratorRun[]>;
}

function mapOrchestratorSummary(run: OrchestratorRun): GenerationRun {
  const status = run.status === "waiting" ? "running" : run.status;
  return {
    runId: run.id,
    projectId: run.projectId,
    status,
    progressPercent: status === "succeeded" ? 100 : status === "queued" ? 0 : 50,
    message:
      run.status === "waiting"
        ? "Generation is waiting for a job or approval gate."
        : run.status === "running"
          ? "The orchestrator is running."
          : undefined,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error
      ? {
          code: typeof run.error.kind === "string" ? run.error.kind : "orchestrator_error",
          message:
            typeof run.error.message === "string"
              ? run.error.message
              : "The orchestrator run failed.",
          retryable: run.error.recoverable === true,
        }
      : undefined,
  };
}

export async function listWorkspaceGenerationRuns(
  workspaceId: string,
  opts: { status?: GenerationRunStatus; projectId?: string },
  limit: number,
  cursor: string | null,
  deps: ListWorkspaceGenerationRunsDeps = {
    listProjects: listWorkspaceProjectRefs,
    listRunsForProject: listOrchestratorRunsForProject,
  }
): Promise<PageResult<WorkspaceGenerationRunSummary>> {
  const projects = await deps.listProjects(workspaceId);
  const scoped = opts.projectId
    ? projects.filter((p) => p.id === opts.projectId)
    : projects;

  const perProject = await Promise.all(
    scoped.map(async (project) => {
      const runs = await deps.listRunsForProject(project.id);
      return runs.map((run) => ({
        ...mapOrchestratorSummary(run),
        projectName: project.name,
      }));
    })
  );

  let all = perProject.flat();
  if (opts.status) {
    all = all.filter((run) => run.status === opts.status);
  }
  // paginate() keys on { id, createdAt }; runs expose runId, so adapt the cursor
  // shape to the run's id without leaking an extra field into the wire output.
  const paged = paginate(
    all.map((run) => ({ ...run, id: run.runId })),
    limit,
    cursor
  );
  return {
    items: paged.items.map(({ id: _id, ...run }) => {
      void _id;
      return run;
    }),
    nextCursor: paged.nextCursor,
  };
}

// A rendered/export artifact plus its owning project's name, for the Outputs
// view (where Created Videos relocate). Maps the agent-api export Artifact onto
// the web client's WorkspaceOutput shape.
export interface WorkspaceOutputSummary {
  artifactId: string;
  projectId: string;
  projectName: string;
  timelineId?: string;
  url?: string;
  durationSec?: number;
  format?: string;
  createdAt: string;
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

export interface ListWorkspaceOutputsDeps {
  listProjects: (workspaceId: string) => Promise<WorkspaceProjectRef[]>;
  artifactStore: Pick<AgentApiStore, "listArtifactsForProject">;
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
  const projects = await deps.listProjects(workspaceId);
  const scoped = opts.projectId
    ? projects.filter((p) => p.id === opts.projectId)
    : projects;

  const perProject = await Promise.all(
    scoped.map(async (project) => {
      const artifacts = await deps.artifactStore.listArtifactsForProject(
        project.id
      );
      return artifacts
        .filter((artifact) => artifact.status === "ready")
        .map<WorkspaceOutputSummary>((artifact) => ({
          artifactId: artifact.id,
          projectId: project.id,
          projectName: project.name,
          timelineId: artifact.timelineId,
          url: artifact.url ?? undefined,
          durationSec: artifact.durationSec,
          format: artifact.renderPlan?.format,
          createdAt: artifact.createdAt,
        }));
    })
  );

  const all = perProject.flat();
  // paginate() keys on { id, createdAt }; outputs expose artifactId.
  const paged = paginate(
    all.map((output) => ({ ...output, id: output.artifactId })),
    limit,
    cursor
  );
  return {
    items: paged.items.map(({ id: _id, ...output }) => {
      void _id;
      return output;
    }),
    nextCursor: paged.nextCursor,
  };
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

export interface GetWorkspaceDashboardSummaryDeps {
  listProjects: (workspaceId: string) => Promise<WorkspaceProjectRef[]>;
  listRunsForProject: (projectId: string) => Promise<OrchestratorRun[]>;
  artifactStore: Pick<AgentApiStore, "listArtifactsForProject">;
}

const ACTIVE_RUN_STATUSES: GenerationRunStatus[] = ["queued", "running"];
const DASHBOARD_ACTIVE_RUN_LIMIT = 5;
const DASHBOARD_RECENT_OUTPUT_LIMIT = 6;

export async function getWorkspaceDashboardSummary(
  workspaceId: string,
  deps: GetWorkspaceDashboardSummaryDeps = {
    listProjects: listWorkspaceProjectRefs,
    listRunsForProject: listOrchestratorRunsForProject,
    artifactStore: agentApiStore,
  }
): Promise<DashboardSummary> {
  const projects = await deps.listProjects(workspaceId);
  const listProjectsOnce = async () => projects;

  const [runsPage, outputsPage] = await Promise.all([
    listWorkspaceGenerationRuns(
      workspaceId,
      {},
      Number.MAX_SAFE_INTEGER,
      null,
      { listProjects: listProjectsOnce, listRunsForProject: deps.listRunsForProject }
    ),
    listWorkspaceOutputs(
      workspaceId,
      {},
      Number.MAX_SAFE_INTEGER,
      null,
      { listProjects: listProjectsOnce, artifactStore: deps.artifactStore }
    ),
  ]);

  const activeRuns = runsPage.items.filter((run) =>
    ACTIVE_RUN_STATUSES.includes(run.status)
  );

  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    counts: {
      projects: projects.length,
      activeRuns: activeRuns.length,
      outputs: outputsPage.items.length,
    },
    activeRuns: activeRuns.slice(0, DASHBOARD_ACTIVE_RUN_LIMIT).map((run) => ({
      runId: run.runId,
      projectId: run.projectId,
      projectName: run.projectName,
      status: run.status,
      reviewGate: run.reviewGate ?? null,
      currentStageType: run.currentStageType,
      progressPercent: run.progressPercent,
      updatedAt: run.updatedAt,
    })),
    recentOutputs: outputsPage.items
      .slice(0, DASHBOARD_RECENT_OUTPUT_LIMIT)
      .map((output) => ({
        artifactId: output.artifactId,
        projectId: output.projectId,
        projectName: output.projectName,
        timelineId: output.timelineId,
        url: output.url,
        durationSec: output.durationSec,
        format: output.format,
        createdAt: output.createdAt,
      })),
  };
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
// Compositions and jobs
// ---------------------------------------------------------------------------
interface CompositionRow {
  id: string;
  schema_version: string;
  project_id: string;
  brief_version_id: string | null;
  mode: ContractCompositionPlan["mode"];
  status: ContractCompositionPlan["status"];
  planned_beats: ContractCompositionPlan["plannedBeats"];
  generated_asset_job_ids: string[];
  ready_asset_ids: string[];
  narration_strategy: ContractCompositionPlan["narrationStrategy"] | null;
  created_at: string;
  updated_at: string;
}

function compositionToRow(composition: ContractCompositionPlan): CompositionRow {
  return {
    id: composition.id,
    schema_version: composition.schemaVersion,
    project_id: composition.projectId,
    brief_version_id: composition.briefVersionId || null,
    mode: composition.mode,
    status: composition.status,
    planned_beats: composition.plannedBeats,
    generated_asset_job_ids: composition.generatedAssetJobIds,
    ready_asset_ids: composition.readyAssetIds,
    narration_strategy: composition.narrationStrategy ?? null,
    created_at: composition.createdAt,
    updated_at: composition.updatedAt,
  };
}

function mapComposition(row: CompositionRow): ContractCompositionPlan {
  return {
    id: row.id,
    schemaVersion: CONTRACT_SCHEMA.composition,
    projectId: row.project_id,
    briefVersionId: row.brief_version_id ?? "",
    mode: row.mode,
    status: row.status,
    plannedBeats: row.planned_beats ?? [],
    generatedAssetJobIds: row.generated_asset_job_ids ?? [],
    readyAssetIds: row.ready_asset_ids ?? [],
    narrationStrategy: row.narration_strategy ?? undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

interface JobRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  project_id: string;
  request_id: string | null;
  type: JobType;
  status: JobStatus;
  progress: Job["progress"];
  input: unknown;
  result: unknown;
  error: Job["error"];
  idempotency_key: string | null;
  deploy_id: string | null;
  git_sha: string | null;
  created_at: string;
  updated_at: string;
}

function jobToRow(job: Job): JobRow {
  return {
    id: job.id,
    schema_version: job.schemaVersion,
    workspace_id: job.workspaceId,
    project_id: job.projectId,
    request_id: job.requestId ?? null,
    type: job.type,
    status: job.status,
    progress: job.progress,
    input: job.input,
    result: job.result,
    error: job.error,
    idempotency_key: job.idempotencyKey ?? null,
    ...deploymentMetadata(),
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    schemaVersion: CONTRACT_SCHEMA.job,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    requestId: row.request_id ?? undefined,
    type: row.type,
    status: row.status,
    progress: row.progress ?? {},
    input: row.input ?? null,
    result: row.result ?? null,
    error: row.error ?? null,
    idempotencyKey: row.idempotency_key ?? undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function saveCompositionPlan(
  workspaceId: string,
  composition: ContractCompositionPlan
): Promise<ContractCompositionPlan> {
  await getProject(workspaceId, composition.projectId);
  const db = getServiceSupabase();
  // Omit `id` so Postgres assigns it; the caller's composition.id is a placeholder.
  const { id: _omit, ...row } = compositionToRow(composition);
  void _omit;
  const data = await runQuery(
    "store.saveCompositionPlan",
    db.from("compositions").insert(row).select("*").single()
  );
  return mapComposition(data as CompositionRow);
}

export async function getCompositionPlan(
  workspaceId: string,
  projectId: string,
  compositionId: string
): Promise<ContractCompositionPlan> {
  await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.getCompositionPlan",
    db
      .from("compositions")
      .select("*")
      .eq("id", compositionId)
      .eq("project_id", projectId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Composition not found: ${compositionId}`);
  return mapComposition(data as CompositionRow);
}

export async function listCompositionPlans(
  workspaceId: string,
  projectId: string,
  limit: number,
  cursor: string | null
): Promise<PageResult<ContractCompositionPlan>> {
  await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listCompositionPlans",
    db.from("compositions").select("*").eq("project_id", projectId)
  );
  const all = (data as CompositionRow[]).map(mapComposition);
  return paginate(all, limit, cursor);
}

export async function createJob(input: {
  workspaceId: string;
  projectId: string;
  type: JobType;
  status?: JobStatus;
  requestId?: string;
  payload?: unknown;
  result?: unknown;
}): Promise<Job> {
  await getProject(input.workspaceId, input.projectId);
  const now = new Date().toISOString();
  const job: Job = {
    // Placeholder id; the row is inserted without it and the DB-generated id is
    // read back below.
    id: "",
    schemaVersion: CONTRACT_SCHEMA.job,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    requestId: input.requestId,
    type: input.type,
    status: input.status ?? "queued",
    progress: {
      percent: input.status === "succeeded" ? 100 : 0,
      currentStep: input.status === "succeeded" ? "completed" : "queued",
    },
    input: input.payload ?? null,
    result: input.result ?? null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  const db = getServiceSupabase();
  const { id: _omit, ...row } = jobToRow(job);
  void _omit;
  const data = await runQuery(
    "store.createJob",
    db.from("jobs").insert(row).select("*").single()
  );
  return mapJob(data as JobRow);
}

export async function updateJob(
  workspaceId: string,
  projectId: string,
  jobId: string,
  patch: Partial<Pick<Job, "status" | "progress" | "result" | "error">>
): Promise<Job> {
  await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.updateJob",
    db
      .from("jobs")
      .update({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
        ...(patch.result !== undefined ? { result: patch.result } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .select("*")
      .maybeSingle()
  );
  if (!data) throw notFound(`Job not found: ${jobId}`);
  return mapJob(data as JobRow);
}

export async function getJob(
  workspaceId: string,
  projectId: string,
  jobId: string
): Promise<Job> {
  await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.getJob",
    db
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Job not found: ${jobId}`);
  return mapJob(data as JobRow);
}

export async function listJobs(
  workspaceId: string,
  projectId: string,
  type: JobType | null,
  limit: number,
  cursor: string | null
): Promise<PageResult<Job>> {
  await getProject(workspaceId, projectId);
  const db = getServiceSupabase();
  let query = db
    .from("jobs")
    .select("*")
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId);
  if (type !== null) {
    query = query.eq("type", type);
  }
  const data = await runQuery("store.listJobs", query);
  const all = (data as JobRow[]).map(mapJob);
  return paginate(all, limit, cursor);
}

export async function getProjectManifest(
  workspaceId: string,
  projectId: string
): Promise<unknown> {
  await getProject(workspaceId, projectId);
  const db = getRequestSupabaseOrService();
  const data = await runQuery(
    "store.getProjectManifest",
    db.rpc("project_manifest", { p_project_id: projectId })
  );
  return data ?? {};
}

export async function getStaleCandidates(
  workspaceId: string,
  projectId: string,
  changedAssetId: string
): Promise<StaleCandidatesResult> {
  await getProject(workspaceId, projectId);
  const db = getRequestSupabaseOrService();

  const changedData = await runQuery(
    "store.getStaleCandidates.changedAsset",
    db
      .from("assets")
      .select("id, ref, kind, status, role, lineage_id, version, content_hash, inputs_fingerprint")
      .eq("id", changedAssetId)
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
  );
  if (!changedData) {
    throw notFound(`Asset not found: ${changedAssetId}`);
  }
  const changedAsset = changedData as GraphAssetSummaryRow;

  const downstreamData = await runQuery(
    "store.getStaleCandidates.downstreamAssets",
    db.rpc("downstream_assets", { p_asset_id: changedAssetId })
  );
  const rows = ((downstreamData ?? []) as DownstreamAssetRow[]).sort(
    (a, b) => a.depth - b.depth || a.asset_id.localeCompare(b.asset_id)
  );
  const candidateIds = rows.map((row) => row.asset_id);
  if (candidateIds.length === 0) {
    return {
      changedAsset: {
        assetId: changedAsset.id,
        ref: changedAsset.ref,
        kind: changedAsset.kind,
        contentHash: changedAsset.content_hash,
      },
      candidates: [],
    };
  }

  const [assetsData, selectionsData] = await Promise.all([
    runQuery(
      "store.getStaleCandidates.assets",
      db
        .from("assets")
        .select("id, ref, kind, status, role, lineage_id, version, content_hash, inputs_fingerprint")
        .eq("project_id", projectId)
        .eq("workspace_id", workspaceId)
        .in("id", candidateIds)
    ),
    runQuery(
      "store.getStaleCandidates.selections",
      db
        .from("current_selections")
        .select("slot_owner_lineage_id, slot_role, seq, active_asset_id")
        .eq("project_id", projectId)
        .in("active_asset_id", candidateIds)
    ),
  ]);

  const assetsById = new Map(
    ((assetsData ?? []) as GraphAssetSummaryRow[]).map((asset) => [
      asset.id,
      asset,
    ])
  );
  const selectionsByAssetId = new Map<string, AssetGraphSelectionRef[]>();
  for (const selection of (selectionsData ?? []) as CurrentSelectionSummaryRow[]) {
    const refs = selectionsByAssetId.get(selection.active_asset_id) ?? [];
    refs.push({
      slotOwnerLineageId: selection.slot_owner_lineage_id,
      slotRole: selection.slot_role,
      seq: selection.seq,
    });
    selectionsByAssetId.set(selection.active_asset_id, refs);
  }

  return {
    changedAsset: {
      assetId: changedAsset.id,
      ref: changedAsset.ref,
      kind: changedAsset.kind,
      contentHash: changedAsset.content_hash,
    },
    candidates: rows.flatMap((row) => {
      const asset = assetsById.get(row.asset_id);
      if (!asset) return [];
      return [
        {
          assetId: asset.id,
          depth: row.depth,
          ref: asset.ref,
          kind: asset.kind,
          status: asset.status,
          role: asset.role,
          lineageId: asset.lineage_id,
          version: asset.version,
          contentHash: asset.content_hash,
          inputsFingerprint: asset.inputs_fingerprint,
          selections: selectionsByAssetId.get(asset.id) ?? [],
        },
      ];
    }),
  };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------
interface IdempotencyRow {
  scope: string;
  key: string;
  body_hash: string | null;
  status: number | null;
  response_body: unknown;
  created_at: string;
}

function mapIdempotency(row: IdempotencyRow): IdempotencyRecord {
  return {
    scope: row.scope,
    key: row.key,
    bodyHash: row.body_hash ?? "",
    status: row.status ?? 0,
    responseBody: row.response_body,
    createdAt: iso(row.created_at),
  };
}

export async function findIdempotencyRecord(
  scope: string,
  key: string
): Promise<IdempotencyRecord | undefined> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.findIdempotencyRecord",
    db
      .from("idempotency")
      .select("*")
      .eq("scope", scope)
      .eq("key", key)
      .maybeSingle()
  );
  if (!data) return undefined;
  return mapIdempotency(data as IdempotencyRow);
}

export async function saveIdempotencyRecord(
  record: IdempotencyRecord
): Promise<void> {
  const db = getServiceSupabase();
  // First write wins (matching the JSON store's "does not duplicate" semantics):
  // ignore the conflict on the (scope, key) primary key.
  await runQuery(
    "store.saveIdempotencyRecord",
    db.from("idempotency").upsert(
      {
        scope: record.scope,
        key: record.key,
        body_hash: record.bodyHash,
        status: record.status,
        response_body: record.responseBody,
        created_at: record.createdAt,
      },
      { onConflict: "scope,key", ignoreDuplicates: true }
    )
  );
}
