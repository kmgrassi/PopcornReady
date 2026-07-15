import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type CompositionPlan as ContractCompositionPlan,
  type Job,
  type JobStatus,
  type JobType,
  SCHEMA as CONTRACT_SCHEMA,
} from "@popcorn/shared/v1/types";
import { databaseError, runQuery } from "../../supabase/db-errors";
import { notFound } from "./errors";
import type { GraphAssetInput } from "./asset-graph";
import { paginate, type PageResult } from "./pagination";
import { deploymentMetadata, iso } from "./store-internal";
import { unmarkedContent, type ContentSchemaKind, type DataAssetRow } from "./store-content";
import type {
  CreateActionInput,
  IdempotencyRecord,
  UpdateActionPatch,
  V1Action,
  V1Project,
} from "./store-types";

const COMPOSITION_PLAN_ROLE = "composition_plan";

export interface InsertDataAssetInput {
  db: SupabaseClient;
  workspaceId: string;
  projectId: string;
  kind:
    | "brief"
    | "beat"
    | "plan"
    | "story_blueprint"
    | "narration_script"
    | "transcript"
    | "composite"
    | "audio_mix"
    | "critique";
  contentSchemaKind?: ContentSchemaKind;
  role: string;
  content: unknown;
  inputs?: GraphAssetInput[];
  lineageId?: string;
  version?: number;
  createdByActionId?: string;
}

export interface CompositionJobsStoreDeps {
  getDb(): SupabaseClient;
  getProject(workspaceId: string, projectId: string): Promise<V1Project>;
  dataAssetById(db: SupabaseClient, assetId: string): Promise<DataAssetRow | null>;
  insertDataAsset(input: InsertDataAssetInput): Promise<DataAssetRow>;
  createAction(input: CreateActionInput): Promise<V1Action>;
  updateAction(actionId: string, patch: UpdateActionPatch): Promise<V1Action>;
}

function mapCompositionAsset(row: DataAssetRow): ContractCompositionPlan {
  const content = unmarkedContent<Partial<ContractCompositionPlan>>(row.content);
  return {
    id: row.id,
    schemaVersion: CONTRACT_SCHEMA.composition,
    projectId: row.project_id,
    briefVersionId: content.briefVersionId ?? "",
    mode: content.mode ?? "hybrid",
    status: content.status ?? "planning",
    plannedBeats: content.plannedBeats ?? [],
    generatedAssetJobIds: content.generatedAssetJobIds ?? [],
    readyAssetIds: content.readyAssetIds ?? [],
    ...(content.narrationStrategy ? { narrationStrategy: content.narrationStrategy } : {}),
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

export async function saveCompositionPlanWithDeps(
  deps: CompositionJobsStoreDeps,
  workspaceId: string,
  composition: ContractCompositionPlan
): Promise<ContractCompositionPlan> {
  await deps.getProject(workspaceId, composition.projectId);
  const db = deps.getDb();
  const briefAsset = composition.briefVersionId
    ? await deps.dataAssetById(db, composition.briefVersionId)
    : null;
  const inputs: GraphAssetInput[] =
    briefAsset && briefAsset.project_id === composition.projectId
      ? [
          {
            assetId: briefAsset.id,
            relation: "input",
            role: "brief",
            position: 0,
            ...(briefAsset.content_hash ? { contentHash: briefAsset.content_hash } : {}),
          },
        ]
      : [];
  const action = await deps.createAction({
    projectId: composition.projectId,
    tool: "save_composition_plan",
    status: "running",
    params: { source: "composition_compat" },
    inputAssetIds: inputs.map((input) => input.assetId),
    rationale: "Persist a legacy composition-plan projection as an immutable plan asset.",
  });
  const { id: _placeholder, ...content } = composition;
  void _placeholder;
  const data = await deps.insertDataAsset({
    db,
    workspaceId,
    projectId: composition.projectId,
    kind: "plan",
    role: COMPOSITION_PLAN_ROLE,
    content,
    inputs,
    createdByActionId: action.id,
  });
  await deps.updateAction(action.id, {
    status: "applied",
    outputAssetIds: [data.id],
  });
  return mapCompositionAsset(data);
}

export async function getCompositionPlanWithDeps(
  deps: CompositionJobsStoreDeps,
  workspaceId: string,
  projectId: string,
  compositionId: string
): Promise<ContractCompositionPlan> {
  await deps.getProject(workspaceId, projectId);
  const db = deps.getDb();
  const data = await runQuery(
    "store.getCompositionPlan",
    db
      .from("assets")
      .select("*")
      .eq("id", compositionId)
      .eq("project_id", projectId)
      .eq("kind", "plan")
      .eq("media", "data")
      .eq("role", COMPOSITION_PLAN_ROLE)
      .maybeSingle()
  );
  if (!data) throw notFound(`Composition not found: ${compositionId}`);
  return mapCompositionAsset(data as DataAssetRow);
}

export async function listCompositionPlansWithDeps(
  deps: CompositionJobsStoreDeps,
  workspaceId: string,
  projectId: string,
  limit: number,
  cursor: string | null
): Promise<PageResult<ContractCompositionPlan>> {
  await deps.getProject(workspaceId, projectId);
  const db = deps.getDb();
  const data = await runQuery(
    "store.listCompositionPlans",
    db
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", "plan")
      .eq("media", "data")
      .eq("role", COMPOSITION_PLAN_ROLE)
  );
  const all = (data as DataAssetRow[]).map(mapCompositionAsset);
  return paginate(all, limit, cursor);
}

export async function createJobWithDeps(
  deps: CompositionJobsStoreDeps,
  input: {
    workspaceId: string;
    projectId: string;
    type: JobType;
    status?: JobStatus;
    requestId?: string;
    payload?: unknown;
    result?: unknown;
    idempotencyKey?: string;
    progress?: Job["progress"];
  }
): Promise<Job> {
  await deps.getProject(input.workspaceId, input.projectId);
  const now = new Date().toISOString();
  const job: Job = {
    id: "",
    schemaVersion: CONTRACT_SCHEMA.job,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    requestId: input.requestId,
    type: input.type,
    status: input.status ?? "queued",
    progress: input.progress ?? {
      percent: input.status === "succeeded" ? 100 : 0,
      currentStep: input.status === "succeeded" ? "completed" : "queued",
    },
    input: input.payload ?? null,
    result: input.result ?? null,
    error: null,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
  const db = deps.getDb();
  const { id: _omit, ...row } = jobToRow(job);
  void _omit;
  const data = await runQuery("store.createJob", db.from("jobs").insert(row).select("*").single());
  return mapJob(data as JobRow);
}

export async function createOrGetJobWithDeps(
  deps: CompositionJobsStoreDeps,
  input: Parameters<typeof createJobWithDeps>[1]
): Promise<{ job: Job; created: boolean }> {
  if (!input.idempotencyKey) {
    return { job: await createJobWithDeps(deps, input), created: true };
  }
  await deps.getProject(input.workspaceId, input.projectId);
  const now = new Date().toISOString();
  const candidate: Job = {
    id: "",
    schemaVersion: CONTRACT_SCHEMA.job,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    requestId: input.requestId,
    type: input.type,
    status: input.status ?? "queued",
    progress: input.progress ?? { percent: 0, currentStep: "queued" },
    input: input.payload ?? null,
    result: input.result ?? null,
    error: null,
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
  const { id: _omit, ...row } = jobToRow(candidate);
  void _omit;
  const db = deps.getDb();
  const { data, error } = await db
    .from("jobs")
    .upsert(row, {
      onConflict: "workspace_id,project_id,type,idempotency_key",
      ignoreDuplicates: true,
    })
    .select("*")
    .maybeSingle();
  if (error) throw databaseError("store.createOrGetJob upsert", error);
  if (data) return { job: mapJob(data as JobRow), created: true };
  const existing = await runQuery(
    "store.createOrGetJob existing",
    db
      .from("jobs")
      .select("*")
      .eq("workspace_id", input.workspaceId)
      .eq("project_id", input.projectId)
      .eq("type", input.type)
      .eq("idempotency_key", input.idempotencyKey)
      .single()
  );
  return { job: mapJob(existing as JobRow), created: false };
}

export async function updateJobWithDeps(
  deps: CompositionJobsStoreDeps,
  workspaceId: string,
  projectId: string,
  jobId: string,
  patch: Partial<Pick<Job, "status" | "progress" | "result" | "error">>
): Promise<Job> {
  await deps.getProject(workspaceId, projectId);
  const db = deps.getDb();
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

export async function updateActiveJobWithDeps(
  deps: CompositionJobsStoreDeps,
  workspaceId: string,
  projectId: string,
  jobId: string,
  patch: Partial<Pick<Job, "status" | "progress" | "result" | "error">>,
  recoveryLeaseOwnerId?: string
): Promise<Job | null> {
  await deps.getProject(workspaceId, projectId);
  const db = deps.getDb();
  const data = await runQuery(
    "store.updateActiveJob",
    db.rpc("update_active_job", {
      p_workspace_id: workspaceId,
      p_project_id: projectId,
      p_job_id: jobId,
      p_progress_patch: patch.progress ?? {},
      p_status: patch.status ?? null,
      p_result: patch.result ?? null,
      p_error: patch.error ?? null,
      p_recovery_lease_owner_id: recoveryLeaseOwnerId ?? null,
    })
  );
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapJob(row as JobRow) : null;
}

export async function claimJobRecoveryWithDeps(
  deps: CompositionJobsStoreDeps,
  input: {
    workspaceId: string;
    projectId: string;
    job: Job;
    ownerId: string;
    claimedAt: string;
    expiresAt: string;
  }
): Promise<Job | null> {
  await deps.getProject(input.workspaceId, input.projectId);
  const progress = input.job.progress as Job["progress"] & Record<string, unknown>;
  const db = deps.getDb();
  const data = await runQuery(
    "store.claimJobRecovery",
    db
      .from("jobs")
      .update({
        status: "running",
        progress: {
          ...progress,
          heartbeatAt: input.claimedAt,
          attempt: (progress.attempt as number | undefined ?? 0) + 1,
          recoveryLease: {
            ownerId: input.ownerId,
            claimedAt: input.claimedAt,
            expiresAt: input.expiresAt,
          },
        },
        updated_at: input.claimedAt,
      })
      .eq("id", input.job.id)
      .eq("project_id", input.projectId)
      .eq("workspace_id", input.workspaceId)
      .eq("updated_at", input.job.updatedAt)
      .in("status", ["queued", "running"])
      .select("*")
      .maybeSingle()
  );
  return data ? mapJob(data as JobRow) : null;
}

export async function getJobWithDeps(
  deps: CompositionJobsStoreDeps,
  workspaceId: string,
  projectId: string,
  jobId: string
): Promise<Job> {
  await deps.getProject(workspaceId, projectId);
  const db = deps.getDb();
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

export async function listJobsWithDeps(
  deps: CompositionJobsStoreDeps,
  workspaceId: string,
  projectId: string,
  type: JobType | null,
  limit: number,
  cursor: string | null
): Promise<PageResult<Job>> {
  await deps.getProject(workspaceId, projectId);
  const db = deps.getDb();
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

export async function findIdempotencyRecordWithDeps(
  deps: Pick<CompositionJobsStoreDeps, "getDb">,
  scope: string,
  key: string
): Promise<IdempotencyRecord | undefined> {
  const db = deps.getDb();
  const data = await runQuery(
    "store.findIdempotencyRecord",
    db.from("idempotency").select("*").eq("scope", scope).eq("key", key).maybeSingle()
  );
  if (!data) return undefined;
  return mapIdempotency(data as IdempotencyRow);
}

export async function saveIdempotencyRecordWithDeps(
  deps: Pick<CompositionJobsStoreDeps, "getDb">,
  record: IdempotencyRecord
): Promise<void> {
  const db = deps.getDb();
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
