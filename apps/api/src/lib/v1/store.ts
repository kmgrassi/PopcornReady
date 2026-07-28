import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BriefVersion,
  CompositionPlan,
  Job,
  V1Asset,
  V1Project,
  VersionedTimeline,
} from "@popcorn/shared/v1/types";
import { getServiceSupabase } from "./supabase-client";
import { runQuery } from "../supabase/db-errors";

// Persistence repository for /api/v1's job + timeline stack.
//
// The store reads/writes the v1 compatibility model in Supabase Postgres. Briefs,
// composition plans, and timelines are projections over graph assets; jobs and
// idempotency stay in their own tables. Snake_case columns are mapped to/from
// the camelCase domain objects below; loosely-shaped or churning structures
// round-trip through jsonb columns.
//
// Two implementations share the V1Store interface:
//   * createSupabaseStore() — the production store, used by getStore(). Runs with
//     the service_role key (see ./supabase-client) and enforces tenancy in app
//     code; it never compares the auth id (golden rule: key on the domain id).
//   * createStore(rootDir)  — a file-based store kept for offline unit tests that
//     spin up a temp dir; semantics match the Supabase store byte-for-byte from
//     the caller's perspective.

export interface IdempotencyRecord {
  requestHash: string;
  jobId: string;
  createdAt: string;
}

export interface V1Store {
  // Reads consumed by PR4.
  getProject(id: string): Promise<V1Project | null>;
  getBriefVersion(id: string): Promise<BriefVersion | null>;
  getAsset(id: string): Promise<V1Asset | null>;
  listAssets(projectId: string): Promise<V1Asset[]>;
  getComposition(id: string): Promise<CompositionPlan | null>;

  // Writes owned by PR4.
  getJob(id: string): Promise<Job | null>;
  saveJob(job: Job): Promise<Job>;
  getTimeline(id: string): Promise<VersionedTimeline | null>;
  listTimelinesForProject(projectId: string): Promise<VersionedTimeline[]>;
  saveTimeline(timeline: VersionedTimeline): Promise<VersionedTimeline>;
  getIdempotency(scope: string): Promise<IdempotencyRecord | null>;
  saveIdempotency(scope: string, record: IdempotencyRecord): Promise<void>;

  // Seed writers — represent records the PR1-PR3 foundation creates.
  saveProject(project: V1Project): Promise<V1Project>;
  saveBriefVersion(brief: BriefVersion): Promise<BriefVersion>;
  saveAsset(asset: V1Asset): Promise<V1Asset>;
  saveComposition(composition: CompositionPlan): Promise<CompositionPlan>;
}

// ---------------------------------------------------------------------------
// Supabase (Postgres) implementation
// ---------------------------------------------------------------------------

// The lib/v1 store keys idempotency by scope alone and stores key = '' (the
// column default), matching the file-based behaviour where the scope was the
// filename. The composite (scope, key) primary key in the schema is a superset
// shared with the api/v1 foundation store.
const IDEMPOTENCY_KEY = "";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// --- row <-> object mappers ------------------------------------------------

interface ProjectRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  name: string;
  status: V1Project["status"];
  created_at: string;
  updated_at: string;
}

function rowToProject(r: ProjectRow): V1Project {
  return {
    id: r.id,
    schemaVersion: r.schema_version as V1Project["schemaVersion"],
    workspaceId: r.workspace_id,
    name: r.name,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface BriefVersionRow {
  id: string;
  schema_version: string;
  project_id: string;
  content: BriefVersion["brief"] & { schema_version?: string };
  created_at: string;
}

function rowToBriefVersion(r: BriefVersionRow): BriefVersion {
  const { schema_version: _contentSchemaVersion, ...brief } = r.content;
  return {
    id: r.id,
    schemaVersion: "brief.v1",
    projectId: r.project_id,
    brief,
    createdAt: r.created_at,
  };
}

type GraphAssetKind =
  | "source_footage"
  | "image"
  | "brief"
  | "beat"
  | "anchor"
  | "keyframe"
  | "clip"
  | "audio_track"
  | "narration_script"
  | "critique"
  | "plan"
  | "composite"
  | "render";

type AssetMedia = "data" | "image" | "video" | "audio";

interface AssetRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  project_id: string;
  kind: GraphAssetKind;
  media: AssetMedia;
  status: V1Asset["status"];
  filename: string;
  url: string | null;
  remote_url: string | null;
  storage_key: string | null;
  params: { schema_version?: string; generatedAssetJobId?: string } | null;
  duration_sec: number | null;
  description: string | null;
  context: { userContext?: V1Asset["userContext"]; agentContext?: V1Asset["agentContext"] } | null;
  semantic_analysis: {
    assetKnowledge?: V1Asset["assetKnowledge"];
    clipUnderstanding?: V1Asset["clipUnderstanding"];
  } | null;
  source: unknown;
  created_at: string;
  updated_at: string;
}

interface DataAssetRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  project_id: string;
  kind: "plan" | "composite";
  media: "data";
  status: "ready" | "pending";
  role: string | null;
  content: Record<string, unknown>;
  inputs: unknown[];
  created_at: string;
  updated_at: string;
}

const JSONB_SCHEMA_KEY = "schema_version";

function markJsonbPayload<T extends object>(
  schemaVersion: string,
  payload: T
): T & { schema_version: string } {
  return {
    [JSONB_SCHEMA_KEY]: schemaVersion,
    ...(payload as Record<string, unknown>),
  } as T & { schema_version: string };
}

function unmarkJsonbPayload<T>(payload: unknown): T {
  if (!isRecord(payload)) return payload as T;
  const { [JSONB_SCHEMA_KEY]: _schemaVersion, ...rest } = payload;
  void _schemaVersion;
  return rest as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function rowSourceToV1Source(source: unknown): V1Asset["source"] {
  if (
    source === "upload" ||
    source === "remote_url" ||
    source === "local_path" ||
    source === "generated"
  ) {
    return source;
  }
  if (!isRecord(source)) return "upload";
  switch (source.type) {
    case "remote_url":
      return "remote_url";
    case "local_path":
      return "local_path";
    case "generated":
      return "generated";
    case "multipart_upload":
      return "upload";
    default:
      return "upload";
  }
}

export function renderableAssetUrlFromRow(
  row: Pick<AssetRow, "url" | "remote_url" | "storage_key" | "source">
): string {
  if (row.url) return row.url;
  if (
    isRecord(row.source) &&
    row.source.type === "remote_url" &&
    typeof row.source.url === "string"
  ) {
    return row.source.url;
  }
  if (row.remote_url) return row.remote_url;
  return row.storage_key ?? "";
}

function mediaToV1Kind(media: AssetMedia, kind: GraphAssetKind): V1Asset["kind"] {
  if (media === "image" || media === "video" || media === "audio") return media;
  if (kind === "audio_track") return "audio";
  if (kind === "image" || kind === "anchor" || kind === "keyframe") return "image";
  return "video";
}

function v1AssetKindToGraphKind(asset: V1Asset): GraphAssetKind {
  if (asset.kind === "audio") return "audio_track";
  if (asset.kind === "image") return "image";
  return asset.source === "generated" ? "clip" : "source_footage";
}

function rowToAsset(r: AssetRow): V1Asset {
  const asset: V1Asset = {
    id: r.id,
    schemaVersion: r.schema_version as V1Asset["schemaVersion"],
    projectId: r.project_id,
    workspaceId: r.workspace_id,
    kind: mediaToV1Kind(r.media, r.kind),
    status: r.status,
    filename: r.filename,
    url: renderableAssetUrlFromRow(r),
    durationSec: r.duration_sec ?? 0,
    source: rowSourceToV1Source(r.source),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.description != null) asset.description = r.description;
  if (r.context?.userContext) asset.userContext = r.context.userContext;
  if (r.context?.agentContext) asset.agentContext = r.context.agentContext;
  if (r.semantic_analysis?.assetKnowledge)
    asset.assetKnowledge = r.semantic_analysis.assetKnowledge;
  if (r.semantic_analysis?.clipUnderstanding)
    asset.clipUnderstanding = r.semantic_analysis.clipUnderstanding;
  if (r.params?.generatedAssetJobId != null)
    asset.generatedAssetJobId = r.params.generatedAssetJobId;
  return asset;
}

function assetToRow(a: V1Asset): AssetRow {
  const context: AssetRow["context"] = {};
  if (a.userContext) context.userContext = a.userContext;
  if (a.agentContext) context.agentContext = a.agentContext;
  const semantic: AssetRow["semantic_analysis"] = {};
  if (a.assetKnowledge) semantic.assetKnowledge = a.assetKnowledge;
  if (a.clipUnderstanding) semantic.clipUnderstanding = a.clipUnderstanding;
  return {
    id: a.id,
    schema_version: a.schemaVersion,
    workspace_id: a.workspaceId,
    project_id: a.projectId,
    kind: v1AssetKindToGraphKind(a),
    media: a.kind,
    status: a.status,
    filename: a.filename,
    url: a.url ?? null,
    remote_url: a.source === "remote_url" ? a.url : null,
    storage_key: null,
    params: a.generatedAssetJobId
      ? markJsonbPayload("asset_params.v1", { generatedAssetJobId: a.generatedAssetJobId })
      : null,
    duration_sec: a.durationSec ?? null,
    description: a.description ?? null,
    context: Object.keys(context).length ? context : null,
    semantic_analysis: Object.keys(semantic).length ? semantic : null,
    source: a.source,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

function rowToComposition(r: DataAssetRow): CompositionPlan {
  const content = unmarkJsonbPayload<Partial<CompositionPlan>>(r.content);
  const plan: CompositionPlan = {
    id: r.id,
    schemaVersion: "composition.v1",
    projectId: r.project_id,
    briefVersionId: content.briefVersionId ?? "",
    mode: content.mode ?? "hybrid",
    status: content.status ?? "planning",
    plannedBeats: content.plannedBeats ?? [],
    generatedAssetJobIds: content.generatedAssetJobIds ?? [],
    readyAssetIds: content.readyAssetIds ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (content.narrationStrategy) plan.narrationStrategy = content.narrationStrategy;
  return plan;
}

function compositionToAssetRow(
  c: CompositionPlan,
  project: Pick<ProjectRow, "workspace_id">
): DataAssetRow {
  const { id: _id, ...content } = c;
  void _id;
  return {
    id: c.id,
    schema_version: "asset.v2",
    workspace_id: project.workspace_id,
    project_id: c.projectId,
    kind: "plan",
    media: "data",
    status: "ready",
    role: "composition_plan",
    content: markJsonbPayload("composition.v1", content),
    inputs: isUuid(c.briefVersionId)
      ? [{ assetId: c.briefVersionId, relation: "input", role: "brief", position: 0 }]
      : [],
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

interface JobRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  project_id: string;
  request_id: string | null;
  type: Job["type"];
  status: Job["status"];
  progress: Job["progress"];
  input: Job["input"];
  result: Job["result"];
  error: Job["error"];
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(r: JobRow): Job {
  const job: Job = {
    id: r.id,
    schemaVersion: r.schema_version as Job["schemaVersion"],
    workspaceId: r.workspace_id,
    projectId: r.project_id,
    type: r.type,
    status: r.status,
    progress: r.progress ?? {},
    input: r.input ?? null,
    result: r.result ?? null,
    error: r.error ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.request_id != null) job.requestId = r.request_id;
  if (r.idempotency_key != null) job.idempotencyKey = r.idempotency_key;
  return job;
}

function jobToRow(j: Job): JobRow {
  return {
    id: j.id,
    schema_version: j.schemaVersion,
    workspace_id: j.workspaceId,
    project_id: j.projectId,
    request_id: j.requestId ?? null,
    type: j.type,
    status: j.status,
    progress: j.progress ?? {},
    input: j.input ?? null,
    result: j.result ?? null,
    error: j.error ?? null,
    idempotency_key: j.idempotencyKey ?? null,
    created_at: j.createdAt,
    updated_at: j.updatedAt,
  };
}

function rowToTimeline(r: DataAssetRow): VersionedTimeline {
  const content = unmarkJsonbPayload<Partial<VersionedTimeline>>(r.content);
  const timeline: VersionedTimeline = {
    id: r.id,
    schemaVersion: "timeline.v1",
    projectId: r.project_id,
    briefVersionId: content.briefVersionId ?? "",
    aspectRatio: content.aspectRatio ?? "16:9",
    fps: content.fps ?? 30,
    segments: content.segments ?? [],
    provenance:
      content.provenance ?? {
        briefVersionId: content.briefVersionId ?? "",
        sourceAssetIds: [],
        generatedAssetJobIds: [],
        criticReport: null,
        appliedPatchCount: 0,
      },
    createdBy: content.createdBy ?? { jobId: "" },
    createdAt: r.created_at,
  };
  if (content.compositionId) timeline.compositionId = content.compositionId;
  if (content.showCaptions !== undefined) timeline.showCaptions = content.showCaptions;
  return timeline;
}

function timelineToAssetRow(
  t: VersionedTimeline,
  project: Pick<ProjectRow, "workspace_id">
): DataAssetRow {
  const { id: _id, ...content } = t;
  void _id;
  return {
    id: t.id,
    schema_version: "asset.v2",
    workspace_id: project.workspace_id,
    project_id: t.projectId,
    kind: "composite",
    media: "data",
    status: "ready",
    role: "timeline",
    content: markJsonbPayload("timeline.v1", content),
    inputs: [
      ...t.provenance.sourceAssetIds
        .filter(isUuid)
        .map((assetId, position) => ({
          assetId,
          relation: "child",
          role: "segment",
          position,
        })),
      ...(isUuid(t.compositionId)
        ? [{ assetId: t.compositionId, relation: "input", role: "plan", position: 0 }]
        : []),
      ...(isUuid(t.briefVersionId) && t.briefVersionId !== t.compositionId
        ? [{ assetId: t.briefVersionId, relation: "input", role: "brief", position: 0 }]
        : []),
    ],
    created_at: t.createdAt,
    updated_at: t.createdAt,
  };
}

export function createSupabaseStore(
  db: SupabaseClient = getServiceSupabase()
): V1Store {
  async function getOne<Row>(
    table: string,
    column: string,
    value: string
  ): Promise<Row | null> {
    const data = await runQuery(
      `v1 store.get ${table}`,
      db.from(table).select("*").eq(column, value).single(),
      { allowMissing: true }
    );
    return (data as Row) ?? null;
  }

  // Create-or-update keyed on the DB-generated id. A caller-supplied id only
  // updates an existing row; first saves always omit `id` so Postgres assigns it.
  async function saveWithGeneratedId<Row extends { id: string }>(
    table: string,
    row: Row
  ): Promise<string> {
    if (row.id) {
      const existing = await getOne<{ id: string }>(table, "id", row.id);
      if (existing) {
        const { id, ...updates } = row;
        await runQuery(
          `v1 store.save ${table}`,
          db
            .from(table)
            .update(updates as Record<string, unknown>)
            .eq("id", id)
            .select("id")
            .single()
        );
        return id;
      }
    }
    const { id: _omit, ...insertable } = row;
    void _omit;
    const data = await runQuery(
      `v1 store.save ${table}`,
      db
        .from(table)
        .insert(insertable as Record<string, unknown>)
        .select("id")
        .single()
    );
    return (data as { id: string }).id;
  }

  return {
    async getProject(id) {
      const row = await getOne<ProjectRow>("projects", "id", id);
      return row ? rowToProject(row) : null;
    },
    async getBriefVersion(id) {
      const row = await getOne<BriefVersionRow>("assets", "id", id);
      return row ? rowToBriefVersion(row) : null;
    },
    async getAsset(id) {
      const row = await getOne<AssetRow>("assets", "id", id);
      return row ? rowToAsset(row) : null;
    },
    async listAssets(projectId) {
      const data = await runQuery(
        "v1 store.list assets",
        db.from("assets").select("*").eq("project_id", projectId).neq("media", "data")
      );
      return ((data as AssetRow[]) ?? []).map(rowToAsset);
    },
    async getComposition(id) {
      const row = await getOne<DataAssetRow>("assets", "id", id);
      return row && row.kind === "plan" && row.media === "data" && row.role === "composition_plan"
        ? rowToComposition(row)
        : null;
    },

    async getJob(id) {
      const row = await getOne<JobRow>("jobs", "id", id);
      return row ? rowToJob(row) : null;
    },
    async saveJob(job) {
      const id = await saveWithGeneratedId("jobs", jobToRow(job));
      return { ...job, id };
    },
    async getTimeline(id) {
      const row = await getOne<DataAssetRow>("assets", "id", id);
      return row && row.kind === "composite" && row.media === "data" && row.role === "timeline"
        ? rowToTimeline(row)
        : null;
    },
    async listTimelinesForProject(projectId) {
      const data = await runQuery(
        "v1 store.listTimelinesForProject",
        db
          .from("assets")
          .select("*")
          .eq("project_id", projectId)
          .eq("kind", "composite")
          .eq("media", "data")
          .eq("role", "timeline")
          .order("created_at", { ascending: false })
      );
      return (data ?? []).map((row) => rowToTimeline(row as DataAssetRow));
    },
    async saveTimeline(timeline) {
      const project = await getOne<ProjectRow>("projects", "id", timeline.projectId);
      if (!project) throw new Error(`project not found for timeline: ${timeline.projectId}`);
      const id = await saveWithGeneratedId("assets", timelineToAssetRow(timeline, project));
      return { ...timeline, id };
    },
    async getIdempotency(scope) {
      const data = await runQuery(
        "v1 store.get idempotency",
        db
          .from("idempotency")
          .select("*")
          .eq("scope", scope)
          .eq("key", IDEMPOTENCY_KEY)
          .single(),
        { allowMissing: true }
      );
      const row = data as {
        request_hash: string | null;
        job_id: string | null;
        created_at: string;
      } | null;
      if (!row) return null;
      return {
        requestHash: row.request_hash ?? "",
        jobId: row.job_id ?? "",
        createdAt: row.created_at,
      };
    },
    async saveIdempotency(scope, record) {
      await runQuery(
        "v1 store.save idempotency",
        db.from("idempotency").upsert(
          {
            scope,
            key: IDEMPOTENCY_KEY,
            request_hash: record.requestHash,
            job_id: record.jobId,
            created_at: record.createdAt,
          },
          { onConflict: "scope,key" }
        )
      );
    },

    async saveProject(project) {
      // The owning workspace already exists (find-or-create in auth resolution);
      // its uuid is project.workspaceId, so the FK holds without seeding one here.
      const id = await saveWithGeneratedId("projects", {
        id: project.id,
        schema_version: project.schemaVersion,
        workspace_id: project.workspaceId,
        name: project.name,
        status: project.status,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      });
      return { ...project, id };
    },
    async saveBriefVersion(brief) {
      const project = await getOne<ProjectRow>("projects", "id", brief.projectId);
      if (!project) {
        throw new Error(`project not found for brief version: ${brief.projectId}`);
      }
      const id = await saveWithGeneratedId("assets", {
        id: brief.id,
        schema_version: "asset.v2",
        workspace_id: project.workspace_id,
        project_id: brief.projectId,
        kind: "brief",
        media: "data",
        status: "ready",
        role: "current_brief",
        content: markJsonbPayload("brief.v1", brief.brief),
        created_at: brief.createdAt,
        updated_at: brief.createdAt,
      });
      return { ...brief, id };
    },
    async saveAsset(asset) {
      if (asset.id) {
        const existing = await getOne<AssetRow>("assets", "id", asset.id);
        if (existing) return rowToAsset(existing);
      }
      const id = await saveWithGeneratedId("assets", assetToRow(asset));
      return { ...asset, id };
    },
    async saveComposition(composition) {
      const project = await getOne<ProjectRow>("projects", "id", composition.projectId);
      if (!project) throw new Error(`project not found for composition: ${composition.projectId}`);
      const id = await saveWithGeneratedId(
        "assets",
        compositionToAssetRow(composition, project)
      );
      return { ...composition, id };
    },
  };
}

// ---------------------------------------------------------------------------
// File-based implementation (offline unit tests)
// ---------------------------------------------------------------------------

const COLLECTIONS = {
  projects: "projects",
  briefVersions: "brief-versions",
  assets: "assets",
  compositions: "compositions",
  jobs: "jobs",
  timelines: "timelines",
  idempotency: "idempotency",
} as const;

function safeKey(key: string): string {
  // Records are keyed by generated IDs / hashes, but guard against traversal.
  return key.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export function createStore(rootDir: string): V1Store {
  function dir(collection: string): string {
    return path.join(rootDir, collection);
  }

  function file(collection: string, key: string): string {
    return path.join(dir(collection), `${safeKey(key)}.json`);
  }

  async function readJson<T>(collection: string, key: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(file(collection, key), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function writeJson<T>(collection: string, key: string, value: T): Promise<T> {
    await fs.mkdir(dir(collection), { recursive: true });
    await fs.writeFile(file(collection, key), JSON.stringify(value, null, 2), "utf8");
    return value;
  }

  async function readAll<T>(collection: string): Promise<T[]> {
    let names: string[];
    try {
      names = await fs.readdir(dir(collection));
    } catch {
      return [];
    }
    const records: T[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir(collection), name), "utf8");
        records.push(JSON.parse(raw) as T);
      } catch {
        // Skip unreadable/partial records rather than failing the whole list.
      }
    }
    return records;
  }

  // Mirror the Postgres "DB assigns the id" contract in the file store: when an
  // entity is saved without an id (first save), assign a uuid (the DB stand-in)
  // and key the file by it; subsequent saves carry the assigned id.
  function saveWithId<T extends { id: string }>(
    collection: string,
    entity: T
  ): Promise<T> {
    const withId = entity.id ? entity : { ...entity, id: randomUUID() };
    return writeJson(collection, withId.id, withId);
  }

  return {
    getProject: (id) => readJson<V1Project>(COLLECTIONS.projects, id),
    getBriefVersion: (id) => readJson<BriefVersion>(COLLECTIONS.briefVersions, id),
    getAsset: (id) => readJson<V1Asset>(COLLECTIONS.assets, id),
    async listAssets(projectId) {
      const all = await readAll<V1Asset>(COLLECTIONS.assets);
      return all.filter((a) => a.projectId === projectId);
    },
    getComposition: (id) => readJson<CompositionPlan>(COLLECTIONS.compositions, id),

    getJob: (id) => readJson<Job>(COLLECTIONS.jobs, id),
    saveJob: (job) => saveWithId(COLLECTIONS.jobs, job),
    getTimeline: (id) => readJson<VersionedTimeline>(COLLECTIONS.timelines, id),
    async listTimelinesForProject(projectId) {
      const all = await readAll<VersionedTimeline>(COLLECTIONS.timelines);
      return all
        .filter((timeline) => timeline.projectId === projectId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    saveTimeline: (timeline) => saveWithId(COLLECTIONS.timelines, timeline),
    getIdempotency: (scope) => readJson<IdempotencyRecord>(COLLECTIONS.idempotency, scope),
    async saveIdempotency(scope, record) {
      await writeJson(COLLECTIONS.idempotency, scope, record);
    },

    saveProject: (project) => saveWithId(COLLECTIONS.projects, project),
    saveBriefVersion: (brief) => saveWithId(COLLECTIONS.briefVersions, brief),
    saveAsset: (asset) => saveWithId(COLLECTIONS.assets, asset),
    saveComposition: (composition) => saveWithId(COLLECTIONS.compositions, composition),
  };
}

export function defaultDbDir(): string {
  return (
    process.env.POPCORN_READY_DEV_DB_DIR || path.join(process.cwd(), ".local", "dev-db")
  );
}

let _store: V1Store | null = null;
export function getStore(): V1Store {
  // Production singleton: Postgres-backed via the service-role client.
  if (!_store) _store = createSupabaseStore();
  return _store;
}

// Test hook so a suite can inject a deterministic store (e.g. a file-based one
// from createStore(tmpDir), or a stubbed Supabase client via createSupabaseStore).
export function setStoreForTests(store: V1Store | null): void {
  _store = store;
}
