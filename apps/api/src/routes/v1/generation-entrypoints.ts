import { createHash } from "crypto";
import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { createGeneratedAsset, getGeneratedAssetJob } from "@/lib/api/v1/generated-assets";
import { AuthContext } from "@/lib/api/v1/auth";
import { runIdempotent } from "@/lib/api/v1/idempotency";
import {
  createBriefVersion,
  getProject as getApiProject,
  listAssets as listApiAssets,
  listBriefVersions,
  V1Asset as ApiAsset,
} from "@/lib/api/v1/store";
import { parseBrief } from "@/lib/api/v1/schemas";
import {
  createOrchestratorRun,
  getOrchestratorRun,
  type OrchestratorRun,
} from "@/lib/api/v1/orchestrator-store";
import { createGenerationJob, runGenerationJob } from "@/lib/v1/generation";
import {
  createGenerationRunExecution,
  createGenerationRunExecutionForRun,
} from "@/lib/v1/generation/run-execution";
import {
  createRunWithSeedStages,
  getGenerationRunStore,
  type GenerationRunsStore,
} from "@/lib/v1/generation-runs";
import { Actor } from "@/lib/v1/actor";
import { getStore, V1Store } from "@/lib/v1/store";
import { isOrchestratorToolLoopEnabled } from "@/lib/orchestrator/feature-flag";
import { runOrchestratorToCompletion } from "@/lib/orchestrator/engine";
import { orchestratorGateStages } from "./orchestrator-run-payload";
import {
  GATEABLE_GENERATION_STAGE_TYPES,
  SCHEMA,
  GenerationJob,
  GenerationRequest,
  GenerationRunStatus,
  GateableGenerationStageType,
  JobStatus,
  V1Asset,
} from "@popcorn/shared/v1/types";

export const generationEntrypointsRouter = Router();

const PAGE_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireProjectId(params: Record<string, string | undefined>): string {
  if (!params.projectId) {
    throw new ApiError("validation_failed", "projectId is required.");
  }
  return params.projectId;
}

function actorForAuth(auth: AuthContext): Actor {
  return {
    actorId: auth.actor.id,
    workspaceId: auth.workspaceId,
    isLocal: auth.isLocal,
  };
}

function assetUrl(asset: ApiAsset): string {
  if (asset.remoteUrl) return asset.remoteUrl;
  if (asset.storageKey) return `/${asset.storageKey.replace(/^media\//, "")}`;
  return `/assets/${asset.id}/${asset.filename}`;
}

function assetSource(asset: ApiAsset): V1Asset["source"] {
  switch (asset.source.type) {
    case "generated":
      return "generated";
    case "local_path":
      return "local_path";
    case "remote_url":
      return "remote_url";
    case "multipart_upload":
    default:
      return "upload";
  }
}

function generatedAssetJobId(asset: ApiAsset): string | undefined {
  const provenance = asset.provenance as { generatedAssetJobId?: string } | undefined;
  return provenance?.generatedAssetJobId;
}

function toGenerationAsset(
  asset: ApiAsset,
  generatedJobIdByAssetId: Map<string, string> = new Map()
): V1Asset {
  const jobId = generatedJobIdByAssetId.get(asset.id) ?? generatedAssetJobId(asset);
  return {
    id: asset.id,
    schemaVersion: SCHEMA.asset,
    projectId: asset.projectId,
    workspaceId: asset.workspaceId,
    kind: asset.kind,
    status: asset.status,
    filename: asset.filename,
    url: assetUrl(asset),
    durationSec: asset.durationSec ?? (asset.kind === "image" ? 4 : 8),
    description: asset.context?.summary,
    userContext: asset.userContext,
    agentContext: asset.agentContext,
    assetKnowledge: asset.assetKnowledge,
    clipUnderstanding: asset.clipUnderstanding,
    source: assetSource(asset),
    ...(jobId ? { generatedAssetJobId: jobId } : {}),
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

async function allApiAssets(workspaceId: string, projectId: string): Promise<ApiAsset[]> {
  const assets: ApiAsset[] = [];
  let cursor: string | null = null;
  do {
    const page = await listApiAssets(workspaceId, projectId, PAGE_SIZE, cursor);
    assets.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return assets;
}

async function mirrorProjectInputs(args: {
  auth: AuthContext;
  projectId: string;
  store: V1Store;
  generatedJobIdByAssetId?: Map<string, string>;
}): Promise<void> {
  const { auth, projectId, store } = args;
  const generatedJobIdByAssetId = args.generatedJobIdByAssetId ?? new Map();
  const project = await getApiProject(auth.workspaceId, projectId);
  await store.saveProject({
    id: project.id,
    schemaVersion: SCHEMA.project,
    workspaceId: project.workspaceId,
    name: project.name,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });

  let cursor: string | null = null;
  do {
    const page = await listBriefVersions(auth.workspaceId, projectId, PAGE_SIZE, cursor);
    for (const brief of page.items) {
      await store.saveBriefVersion({
        id: brief.id,
        schemaVersion: SCHEMA.briefVersion,
        projectId: brief.projectId,
        brief: brief.brief,
        createdAt: brief.createdAt,
      });
    }
    cursor = page.nextCursor;
  } while (cursor);

  for (const asset of await allApiAssets(auth.workspaceId, projectId)) {
    await store.saveAsset(toGenerationAsset(asset, generatedJobIdByAssetId));
  }
}

function promptBriefFromBody(body: unknown) {
  if (!isRecord(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const source = isRecord(body.brief)
    ? body.brief
    : {
        goal: body.goal,
        targetLengthSec: body.targetLengthSec ?? 30,
        aspectRatio: body.aspectRatio ?? "9:16",
        style: body.style ?? "fast-paced social ad",
        audience: body.audience,
        platform: body.platform,
        format: body.format,
        hookQuestion: body.hookQuestion,
        strongestVisual: body.strongestVisual,
        oneBigIdea: body.oneBigIdea,
        caveat: body.caveat,
        payoff: body.payoff,
        narration: body.narration,
        constraints: body.constraints,
      };
  return parseBrief(source, "brief");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

const GATEABLE_STAGE_SET = new Set<string>(GATEABLE_GENERATION_STAGE_TYPES);

function reviewGatesFromBody(body: unknown): GateableGenerationStageType[] {
  if (!isRecord(body) || body.reviewGates == null) return [];
  if (!Array.isArray(body.reviewGates)) {
    throw new ApiError("validation_failed", "reviewGates must be an array.", {
      fields: [{ path: "reviewGates", message: "Must be an array of stage types." }],
    });
  }

  const gates: GateableGenerationStageType[] = [];
  const seen = new Set<string>();
  body.reviewGates.forEach((raw, index) => {
    if (typeof raw !== "string" || !GATEABLE_STAGE_SET.has(raw)) {
      throw new ApiError("validation_failed", "reviewGates contains an invalid stage type.", {
        fields: [
          {
            path: `reviewGates.${index}`,
            message: "Must be a gateable generation stage type.",
          },
        ],
      });
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      gates.push(raw as GateableGenerationStageType);
    }
  });
  return gates;
}

function generationBody(
  body: unknown,
  briefVersionId: string,
  fallbackAssetIds: string[]
): GenerationRequest {
  const source = isRecord(body) ? body : {};
  return {
    briefVersionId,
    assetIds: stringArray(source.assetIds).length
      ? stringArray(source.assetIds)
      : fallbackAssetIds,
    compositionId: source.compositionId ? String(source.compositionId) : undefined,
    mode:
      source.mode === "asset_driven" || source.mode === "prompt_only" || source.mode === "hybrid"
        ? source.mode
        : undefined,
    allowGeneratedGapFill:
      typeof source.allowGeneratedGapFill === "boolean"
        ? source.allowGeneratedGapFill
        : undefined,
    variantCount: source.variantCount === undefined ? 1 : Number(source.variantCount),
    showCaptions:
      typeof source.showCaptions === "boolean" ? source.showCaptions : undefined,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value ?? null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function orchestratorRunIdempotencyScope(args: {
  auth: AuthContext;
  projectId: string;
  entrypoint: string;
}): string {
  return [
    args.auth.workspaceId,
    args.auth.actor.id,
    "POST",
    `/api/v1/projects/${args.projectId}/generation-entrypoints/${args.entrypoint}`,
    "orchestrator_run",
  ].join(":");
}

function orchestratorRunBodyHash(args: {
  briefVersionId: string;
  requestBody: GenerationRequest;
  gates: string[];
  body: unknown;
}): string {
  return sha256(
    JSON.stringify(
      canonicalize({
        briefVersionId: args.briefVersionId,
        request: args.requestBody,
        gates: args.gates,
        userInput: isRecord(args.body) ? args.body : {},
      })
    )
  );
}

async function createEntrypointOrchestratorRun(args: {
  auth: AuthContext;
  projectId: string;
  entrypoint: string;
  idempotencyKey: string | null;
  briefVersionId: string;
  body: unknown;
  requestBody: GenerationRequest;
}): Promise<{ run: OrchestratorRun; replayed: boolean }> {
  const gates = orchestratorGateStages(reviewGatesFromBody(args.body));
  const inputSummary = JSON.stringify({
    briefVersionId: args.briefVersionId,
    request: args.requestBody,
    userInput: isRecord(args.body) ? args.body : {},
  });

  if (!args.idempotencyKey) {
    return {
      run: await createOrchestratorRun({
        projectId: args.projectId,
        inputSummary,
        gates,
      }),
      replayed: false,
    };
  }

  let produced = false;
  const result = await runIdempotent(
    orchestratorRunIdempotencyScope(args),
    args.idempotencyKey,
    orchestratorRunBodyHash({
      briefVersionId: args.briefVersionId,
      requestBody: args.requestBody,
      gates,
      body: args.body,
    }),
    async () => {
      produced = true;
      const run = await createOrchestratorRun({
        projectId: args.projectId,
        inputSummary,
        gates,
      });
      return { status: 202, body: { runId: run.id } };
    }
  );
  const body = isRecord(result.body) ? result.body : {};
  const runId = typeof body.runId === "string" ? body.runId : "";
  if (!runId) {
    throw new ApiError("internal_error", "Idempotent orchestrator run response was missing runId.");
  }
  return {
    run: await getOrchestratorRun(runId),
    replayed: !produced,
  };
}

function orchestratorJobStatus(status: OrchestratorRun["status"]): JobStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "running":
    case "waiting":
    default:
      return "running";
  }
}

function orchestratorJob(args: {
  run: OrchestratorRun;
  auth: AuthContext;
  requestId: string;
  idempotencyKey?: string;
  body: GenerationRequest;
}) {
  return {
    id: args.run.id,
    schemaVersion: SCHEMA.job,
    workspaceId: args.auth.workspaceId,
    projectId: args.run.projectId,
    requestId: args.requestId,
    type: "generation",
    status: orchestratorJobStatus(args.run.status),
    progress: {
      currentStep: args.run.status === "waiting" ? "waiting_for_orchestrator" : "orchestrator",
      percent: args.run.status === "succeeded" ? 100 : 0,
      message:
        args.run.status === "succeeded"
          ? "The orchestrator run completed."
          : "The orchestrator is generating your video.",
    },
    input: args.body,
    result: null,
    error: args.run.error
      ? {
          code: String(args.run.error.kind ?? "orchestrator_failed"),
          message: String(args.run.error.message ?? "The orchestrator run failed."),
        }
      : null,
    ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {}),
    createdAt: args.run.createdAt,
    updatedAt: args.run.updatedAt,
  };
}

function resultAssetIds(result: unknown): string[] {
  if (!isRecord(result)) return [];
  const job = isRecord(result.job) ? result.job : undefined;
  const jobResult = job && isRecord(job.result) ? job.result : undefined;
  return stringArray(jobResult?.assetIds);
}

function defaultSeedAssetRequest(body: unknown, prompt: string): Record<string, unknown> {
  const source = isRecord(body) ? body : {};
  const seed = isRecord(source.seedAsset) ? source.seedAsset : {};
  return {
    kind: seed.kind ?? "image",
    provider: seed.provider ?? source.provider ?? "openai",
    prompt: seed.prompt ?? prompt,
    description: seed.description ?? source.description ?? prompt,
    durationSec: seed.durationSec ?? 4,
    size: seed.size ?? source.size,
    quality: seed.quality ?? source.quality,
    preflightReviewIterations: seed.preflightReviewIterations ?? source.preflightReviewIterations,
  };
}

interface SeededGenerationAssets {
  assetIds: string[];
  generatedJobIdByAssetId: Map<string, string>;
}

async function seedGeneratedAssets(args: {
  auth: AuthContext;
  projectId: string;
  body: unknown;
  briefGoal: string;
}): Promise<SeededGenerationAssets> {
  const empty = { assetIds: [], generatedJobIdByAssetId: new Map<string, string>() };
  if (!isRecord(args.body)) return empty;
  if (args.body.compositionId) return empty;
  if (stringArray(args.body.assetIds).length > 0) return empty;

  const source = Array.isArray(args.body.seedAssets)
    ? args.body.seedAssets
    : [defaultSeedAssetRequest(args.body, args.briefGoal)];

  const assetIds: string[] = [];
  const generatedJobIdByAssetId = new Map<string, string>();
  for (const seed of source) {
    const result = await createGeneratedAsset({
      auth: args.auth,
      projectId: args.projectId,
      body: seed,
    });
    const seededAssetIds = resultAssetIds(result.body);
    assetIds.push(...seededAssetIds);
    const job = isRecord(result.body.job) ? result.body.job : undefined;
    const jobId = job?.id ? String(job.id) : undefined;
    if (jobId) {
      for (const assetId of seededAssetIds) {
        generatedJobIdByAssetId.set(assetId, jobId);
      }
    }
  }
  return { assetIds, generatedJobIdByAssetId };
}

async function createAndMaybeRunGeneration(args: {
  auth: AuthContext;
  requestId: string;
  idempotencyKey: string | null;
  projectId: string;
  body: unknown;
  briefVersionId: string;
  entrypoint: "prompt" | "uploaded-footage";
  assetIds: string[];
  generatedJobIdByAssetId?: Map<string, string>;
}) {
  const requestBody = generationBody(args.body, args.briefVersionId, args.assetIds);
  if (isOrchestratorToolLoopEnabled()) {
    const { run, replayed } = await createEntrypointOrchestratorRun({
      auth: args.auth,
      projectId: args.projectId,
      entrypoint: args.entrypoint,
      idempotencyKey: args.idempotencyKey,
      briefVersionId: args.briefVersionId,
      body: args.body,
      requestBody,
    });
    const shouldRun = isRecord(args.body) && args.body.runNow === false ? false : true;
    const drivenRun = shouldRun && !replayed
      ? await runOrchestratorToCompletion(run.id, { workspaceId: args.auth.workspaceId })
      : run;
    return {
      status: 202,
      body: {
        job: orchestratorJob({
          run: drivenRun,
          auth: args.auth,
          requestId: args.requestId,
          idempotencyKey: args.idempotencyKey ?? undefined,
          body: requestBody,
        }),
        runId: drivenRun.id,
      },
    };
  }

  const store = getStore();
  await mirrorProjectInputs({
    auth: args.auth,
    projectId: args.projectId,
    store,
    generatedJobIdByAssetId: args.generatedJobIdByAssetId,
  });
  const generationJob = await createGenerationJob({
    store,
    actor: actorForAuth(args.auth),
    projectId: args.projectId,
    body: requestBody,
    idempotencyKey: args.idempotencyKey ?? undefined,
    requestId: args.requestId,
  });

  const shouldRun =
    isRecord(args.body) && args.body.runNow === false ? false : true;
  if (!shouldRun) {
    return { status: 202, body: { job: generationJob, runId: null } };
  }
  const runExecution = await createGenerationRunExecution({
    projectId: args.projectId,
    briefVersionId: args.briefVersionId,
    body: args.body,
  });
  const job = await runGenerationJob(
    store,
    generationJob.id,
    undefined,
    runExecution.progress,
    runExecution.execution
  );
  return { status: 202, body: { job, runId: runExecution.runId } };
}

function errorSummary(err: unknown) {
  const message = err instanceof Error ? err.message : "Generation failed.";
  return {
    code: err instanceof ApiError ? err.code : "internal_error",
    message,
    retryable: false,
  };
}

function jobErrorSummary(job: GenerationJob) {
  return {
    code: job.error?.code ?? "internal_error",
    message: job.error?.message ?? "Generation failed.",
    retryable: false,
  };
}

function isTerminalRunStatus(status: GenerationRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

async function isEntrypointRunTerminal(args: {
  store: GenerationRunsStore;
  runId: string;
}): Promise<boolean> {
  const run = await args.store.getRun(args.runId);
  return !run || isTerminalRunStatus(run.status);
}

async function failEntrypointRun(args: {
  store: GenerationRunsStore;
  runId: string;
  err: unknown;
}): Promise<void> {
  const now = new Date().toISOString();
  const error = errorSummary(args.err);
  const stages = await args.store.listStagesForRun(args.runId);
  const firstQueuedStage = stages
    .sort((a, b) => a.order - b.order)
    .find((stage) => stage.status === "queued");
  if (firstQueuedStage) {
    await args.store.updateStage(firstQueuedStage.stageId, {
      status: "failed",
      completedAt: now,
      error,
    });
  }
  await args.store.updateRun(args.runId, {
    status: "failed",
    completedAt: now,
    currentStageType: firstQueuedStage?.type ?? "brief_intake",
    error,
    message: error.message,
  });
}

async function finalizeEntrypointRunFromJob(args: {
  store: GenerationRunsStore;
  runId: string;
  job: GenerationJob;
}): Promise<void> {
  if (args.job.status !== "succeeded" && args.job.status !== "failed") {
    return;
  }

  const run = await args.store.getRun(args.runId);
  if (!run || isTerminalRunStatus(run.status)) return;

  const now = new Date().toISOString();
  const stages = await args.store.listStagesForRun(args.runId);
  if (args.job.status === "succeeded") {
    const readyStage = stages.find((stage) => stage.type === "ready");
    if (readyStage && readyStage.status !== "succeeded") {
      await args.store.updateStage(readyStage.stageId, {
        status: "succeeded",
        progressPercent: 100,
        completedAt: now,
        message: "Timeline ready.",
      });
    }
    await args.store.updateRun(args.runId, {
      status: "succeeded",
      currentStageType: "ready",
      progressPercent: 100,
      completedAt: now,
      message: "Timeline ready.",
    });
    return;
  }

  const error = jobErrorSummary(args.job);
  const failedStage =
    stages.find((stage) => stage.status === "failed") ??
    stages.find((stage) => stage.status === "running") ??
    stages.find((stage) => stage.status === "queued");
  if (failedStage && failedStage.status !== "failed") {
    await args.store.updateStage(failedStage.stageId, {
      status: "failed",
      completedAt: now,
      error,
    });
  }
  await args.store.updateRun(args.runId, {
    status: "failed",
    currentStageType: failedStage?.type ?? run.currentStageType ?? "brief_intake",
    completedAt: now,
    error,
    message: error.message,
  });
}

async function markEntrypointRunStarting(args: {
  store: GenerationRunsStore;
  runId: string;
}): Promise<void> {
  const stages = await args.store.listStagesForRun(args.runId);
  const firstStage = stages.sort((a, b) => a.order - b.order)[0];
  if (firstStage) {
    await args.store.updateStage(firstStage.stageId, {
      status: "running",
      progressPercent: 5,
      message: "Starting generation.",
    });
  }
  await args.store.updateRun(args.runId, {
    status: "running",
    currentStageType: firstStage?.type ?? "brief_intake",
    progressPercent: 5,
    message: "Starting generation.",
  });
}

async function startGenerationForExistingRun(args: {
  auth: AuthContext;
  requestId: string;
  idempotencyKey: string | null;
  projectId: string;
  runId: string;
  body: unknown;
  briefVersionId: string;
  assetIds: string[];
  generatedJobIdByAssetId?: Map<string, string>;
}): Promise<GenerationJob> {
  const store = getStore();
  await mirrorProjectInputs({
    auth: args.auth,
    projectId: args.projectId,
    store,
    generatedJobIdByAssetId: args.generatedJobIdByAssetId,
  });
  const generationJob = await createGenerationJob({
    store,
    actor: actorForAuth(args.auth),
    projectId: args.projectId,
    body: generationBody(args.body, args.briefVersionId, args.assetIds),
    idempotencyKey: args.idempotencyKey ?? undefined,
    requestId: args.requestId,
  });
  const runExecution = await createGenerationRunExecutionForRun({
    runId: args.runId,
    briefVersionId: args.briefVersionId,
  });
  return runGenerationJob(
    store,
    generationJob.id,
    undefined,
    runExecution.progress,
    runExecution.execution
  );
}

function scheduleEntrypointRun(args: {
  auth: AuthContext;
  requestId: string;
  idempotencyKey: string | null;
  projectId: string;
  runId: string;
  body: unknown;
  briefVersionId: string;
  entrypoint: "prompt" | "uploaded-footage";
  seedBriefGoal?: string;
  assetIds?: string[];
}) {
  const runStore = getGenerationRunStore();
  setImmediate(() => {
    void (async () => {
      try {
        if (await isEntrypointRunTerminal({ store: runStore, runId: args.runId })) {
          return;
        }
        await markEntrypointRunStarting({ store: runStore, runId: args.runId });
        const suppliedAssetIds =
          args.assetIds ?? (isRecord(args.body) ? stringArray(args.body.assetIds) : []);
        const seeded = args.seedBriefGoal
          ? await seedGeneratedAssets({
              auth: args.auth,
              projectId: args.projectId,
              body: args.body,
              briefGoal: args.seedBriefGoal,
            })
          : { assetIds: [], generatedJobIdByAssetId: new Map<string, string>() };
        if (await isEntrypointRunTerminal({ store: runStore, runId: args.runId })) {
          return;
        }
        const job = await startGenerationForExistingRun({
          auth: args.auth,
          requestId: args.requestId,
          idempotencyKey: args.idempotencyKey,
          projectId: args.projectId,
          runId: args.runId,
          body: args.body,
          briefVersionId: args.briefVersionId,
          assetIds: suppliedAssetIds.length ? suppliedAssetIds : seeded.assetIds,
          generatedJobIdByAssetId: seeded.generatedJobIdByAssetId,
        });
        await finalizeEntrypointRunFromJob({
          store: runStore,
          runId: args.runId,
          job,
        });
      } catch (err) {
        console.error("generation entrypoint background run failed", err);
        await failEntrypointRun({ store: runStore, runId: args.runId, err });
      }
    })();
  });
}

async function createRunAndScheduleGeneration(args: {
  auth: AuthContext;
  requestId: string;
  idempotencyKey: string | null;
  projectId: string;
  body: unknown;
  briefVersionId: string;
  entrypoint: "prompt" | "uploaded-footage";
  seedBriefGoal?: string;
  assetIds?: string[];
}) {
  if (isOrchestratorToolLoopEnabled()) {
    const requestBody = generationBody(
      args.body,
      args.briefVersionId,
      args.assetIds ?? []
    );
    const { run, replayed } = await createEntrypointOrchestratorRun({
      auth: args.auth,
      projectId: args.projectId,
      entrypoint: args.entrypoint,
      idempotencyKey: args.idempotencyKey,
      briefVersionId: args.briefVersionId,
      body: args.body,
      requestBody,
    });
    if (!replayed) {
      setImmediate(() => {
        void runOrchestratorToCompletion(run.id, {
          workspaceId: args.auth.workspaceId,
        }).catch((err) => {
          console.error("orchestrator entrypoint background run failed", err);
        });
      });
    }
    return { status: 202, body: { job: null, runId: run.id } };
  }

  const runStore = getGenerationRunStore();
  const payload = await createRunWithSeedStages({
    store: runStore,
    projectId: args.projectId,
    body: {
      ...(isRecord(args.body) ? args.body : {}),
      briefVersionId: args.briefVersionId,
    },
  });
  scheduleEntrypointRun({
    ...args,
    runId: payload.run.runId,
  });
  return { status: 202, body: { job: null, runId: payload.run.runId } };
}

generationEntrypointsRouter.post(
  "/projects/:projectId/generation-entrypoints/prompt",
  mutation(async ({ auth, body, req, requestId }, params) => {
    const projectId = requireProjectId(params);
    const brief = promptBriefFromBody(body);
    const { briefVersion } = await createBriefVersion(auth.workspaceId, projectId, brief);
    const shouldRun = isRecord(body) && body.runNow === false ? false : true;
    if (!shouldRun) {
      const suppliedAssetIds = isRecord(body) ? stringArray(body.assetIds) : [];
      const seeded = await seedGeneratedAssets({
        auth,
        projectId,
        body,
        briefGoal: brief.goal,
      });
      return createAndMaybeRunGeneration({
        auth,
        requestId,
        idempotencyKey: req.header("Idempotency-Key"),
        projectId,
        body,
        briefVersionId: briefVersion.id,
        entrypoint: "prompt",
        assetIds: suppliedAssetIds.length ? suppliedAssetIds : seeded.assetIds,
        generatedJobIdByAssetId: seeded.generatedJobIdByAssetId,
      });
    }
    return createRunAndScheduleGeneration({
      auth,
      requestId,
      idempotencyKey: req.header("Idempotency-Key"),
      projectId,
      body,
      briefVersionId: briefVersion.id,
      entrypoint: "prompt",
      seedBriefGoal: brief.goal,
    });
  })
);

generationEntrypointsRouter.post(
  "/projects/:projectId/generation-entrypoints/uploaded-footage",
  mutation(async ({ auth, body, req, requestId }, params) => {
    const projectId = requireProjectId(params);
    if (!isRecord(body)) {
      throw new ApiError("validation_failed", "Request body must be an object.");
    }
    const briefVersionId = String(body.briefVersionId || "").trim();
    if (!briefVersionId) {
      throw new ApiError("brief_missing", "briefVersionId is required.", {
        fields: [{ path: "briefVersionId", message: "Required." }],
      });
    }
    const assetIds = stringArray(body.assetIds);
    if (assetIds.length === 0) {
      throw new ApiError("validation_failed", "assetIds is required.", {
        fields: [{ path: "assetIds", message: "Provide at least one ready visual asset." }],
      });
    }
    const shouldRun = isRecord(body) && body.runNow === false ? false : true;
    if (!shouldRun) {
      return createAndMaybeRunGeneration({
        auth,
        requestId,
        idempotencyKey: req.header("Idempotency-Key"),
        projectId,
        body,
        briefVersionId,
        entrypoint: "uploaded-footage",
        assetIds,
      });
    }
    return createRunAndScheduleGeneration({
      auth,
      requestId,
      idempotencyKey: req.header("Idempotency-Key"),
      projectId,
      body,
      briefVersionId,
      entrypoint: "uploaded-footage",
      assetIds,
    });
  })
);

generationEntrypointsRouter.post(
  "/projects/:projectId/generation-entrypoints/assets",
  mutation(async ({ auth, body }, params) => {
    const projectId = requireProjectId(params);
    return createGeneratedAsset({ auth, projectId, body });
  })
);

generationEntrypointsRouter.get(
  "/projects/:projectId/generation-entrypoints/assets/:jobId",
  route(async ({ auth }, params) => {
    const projectId = requireProjectId(params);
    if (!params.jobId) {
      throw new ApiError("validation_failed", "jobId is required.");
    }
    return getGeneratedAssetJob({ auth, projectId, jobId: params.jobId });
  })
);

generationEntrypointsRouter.post(
  "/projects/:projectId/generation-entrypoints/revisions",
  mutation(async () => {
    throw new ApiError(
      "not_implemented",
      "Timeline revision entrypoints move to /api/v1/projects/:projectId/timelines/:timelineId/revisions."
    );
  })
);
