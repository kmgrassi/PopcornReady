// PR2: Generated Asset Endpoint For Agents.
//
// Turns an agent generation request into a normal project asset (in the PR1
// asset store) with full provenance, modeled as an `asset_generation` job.
// Reuses the existing preflight + provider pipeline; adds typed errors and
// actual audio-duration capture. Idempotency is handled by the shared
// handleMutation wrapper, so this module stays framework-free and testable.

import {
  AssetObjectNotFoundError,
  materializeAssetObject,
  type MaterializedAssetObject,
} from "@/lib/storage/asset-read";
import { writeAssetObject } from "@/lib/storage/asset-write";
import { measureAudioDurationSec } from "@/lib/generative/audio-duration";
import { type LlmUsage } from "@popcorn/llm";
import { withDerivedAssetKnowledge } from "./assets";
import { enqueueAssetEmbeddingRefresh } from "./asset-embeddings/jobs";
import { resolveWorkspaceGenerationModel } from "./model-settings";
import { preflightGenerationContent } from "@/lib/generative/preflight";
import { type LlmCostScope, withLlmCostRecording } from "./llm-costs";
import { providerFor } from "@/lib/generative/providers";
import { estimateCostUsd } from "@/lib/generative/pricing";
import { recordModelCallCost } from "./model-call-costs";
import {
  noteBillableGeneration,
  type KeyProvider,
} from "@/lib/provider-keys/resolve";
import {
  GenerativeAssetKind,
  GenerativeProviderName,
} from "@popcorn/shared/generative/types";
import type { GeneratedAssetCharacterBinding } from "@popcorn/shared/types";
import { buildSemanticAnalysis } from "@/lib/assets/semantic-analysis";
import { sha256Hex } from "./asset-graph";
import { randomUUID } from "crypto";
import type { Job } from "@popcorn/shared/v1/types";
import type { V1Job } from "./jobs";
import { AuthContext } from "./auth";
import { ApiError, ApiErrorCode, validationError } from "./errors";
import { resolveAssetMetadata } from "./naming";
import {
  GeneratedAssetProvenance,
  GeneratedAssetProviderSettings,
} from "./provenance";
import { AssetKind, SCHEMA_VERSIONS } from "./schemas";
import {
  addAsset,
  canonicalizeAssetIds,
  claimProviderJobExecution,
  completeProviderJobExecution,
  createJob,
  assertRunBudgetAllows,
  createAction,
  effectiveAssetStorageVisibility,
  getAssetFingerprintPins,
  getAsset,
  getJob,
  getProject,
  renewProviderJobExecution,
  updateAction,
  updateAsset,
  V1Action,
  V1Asset,
} from "./store";
import { readStorageConfig } from "@/lib/storage/config";
import { createLogger } from "@/lib/v1/logger";
import {
  parseGeneratedAssetRequest,
  PROVIDER_KIND_SUPPORT,
  type ParsedRequest,
} from "./generated-asset-request";

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export type GeneratedAssetJob = V1Job & {
  type: "asset_generation";
  actionId?: string;
};

function asGeneratedAssetJob(job: Job): GeneratedAssetJob {
  if (job.type !== "asset_generation") {
    throw new ApiError("internal_error", `Expected an asset_generation job: ${job.id}.`);
  }
  return job as unknown as GeneratedAssetJob;
}

const CHARACTER_PROMPT_INVARIANT_VERSION = "char.invariant.v1";

// Map a generative provider to the user-key provider its cost is billed/credited
// under (matches the name each provider passes to resolveProviderApiKey). `mock`
// and unbilled providers map to undefined → never metered.
const BILLABLE_KEY_PROVIDER: Partial<Record<GenerativeProviderName, KeyProvider>> = {
  openai: "openai",
  gemini: "gemini",
  nanobanano: "gemini",
  ideogram: "ideogram",
  runway: "runway",
  ltx: "ltx",
  kling: "kling",
  seedance: "seedance",
  xai: "xai",
  nvidia_api_catalog: "nvidia",
  elevenlabs: "elevenlabs",
};

const logger = createLogger();

async function localPathForAssetBytes(
  asset: V1Asset
): Promise<MaterializedAssetObject> {
  if (!asset.storageKey || !asset.storageBucket) {
    throw new ApiError(
      "asset_not_ready",
      `Reference asset is missing stored bytes: ${asset.id}.`,
      {
        assetIds: [asset.id],
        storageKey: asset.storageKey,
        storageBucket: asset.storageBucket,
      }
    );
  }
  const storageConfig = readStorageConfig();
  const logFields = {
    workspaceId: asset.workspaceId,
    projectId: asset.projectId,
    assetId: asset.id,
    assetRole: asset.role,
    assetKind: asset.kind,
    storageBackend: storageConfig.backend,
    dbBackend: process.env.DB_BACKEND ?? "local",
    storageBucket: asset.storageBucket,
    storageKey: asset.storageKey,
  };
  logger.info("generated_asset.reference_resolve_started", logFields);
  try {
    const materialized = await materializeAssetObject({
      storageKey: asset.storageKey,
      storageBucket: asset.storageBucket,
      config: storageConfig,
    });
    logger.info("generated_asset.reference_resolve_succeeded", {
      ...logFields,
      resolver: "object_store",
    });
    return materialized;
  } catch (err) {
    logger.error("generated_asset.reference_resolve_failed", {
      ...logFields,
      resolver: "object_store",
      error: { message: err instanceof Error ? err.message : String(err) },
    });
    const details = {
      assetIds: [asset.id],
      storageKey: asset.storageKey,
      storageBucket: asset.storageBucket,
    };
    if (err instanceof AssetObjectNotFoundError) {
      throw new ApiError(
        "object_not_found",
        `Stored bytes for reference asset ${asset.id} could not be read.`,
        details
      );
    }
    throw new ApiError(
      "storage_error",
      `Reference storage failed while reading asset ${asset.id}.`,
      details
    );
  }
}

export function generatedAssetLlmCostScope(
  projectId: string,
  runId: string | undefined,
  actionId: string
): LlmCostScope {
  return {
    projectId,
    ...(runId ? { runId } : {}),
    actionId,
  };
}

type RecordLlmUsage = (scope: LlmCostScope, usage: LlmUsage) => Promise<void>;

interface ResolveGeneratedAssetMetadataWithCostArgs {
  scope: LlmCostScope;
  input: Parameters<typeof resolveAssetMetadata>[0];
  resolveMetadata?: typeof resolveAssetMetadata;
  recordUsage?: RecordLlmUsage;
}

/** Keeps optional AI display-name generation in the owning asset action's cost scope. */
export async function resolveGeneratedAssetMetadataWithCost(
  args: ResolveGeneratedAssetMetadataWithCostArgs
): Promise<Awaited<ReturnType<typeof resolveAssetMetadata>>> {
  return withLlmCostRecording(
    args.scope,
    () => (args.resolveMetadata ?? resolveAssetMetadata)(args.input),
    args.recordUsage
  );
}

type ProgressItemKind = "image" | "video" | "audio" | "caption" | "timeline" | "export";

interface RunStageItemHandle {
  update(patch: { progressPercent?: number; message?: string }): Promise<void>;
  succeed(patch?: { assetId?: string; message?: string }): Promise<void>;
  fail(error: { code: string; message: string; retryable?: boolean }): Promise<void>;
}

interface RunStageHandle {
  startItem(input: {
    kind: ProgressItemKind;
    label: string;
    provider?: string;
    prompt?: string;
    promptPreview?: string;
  }): Promise<RunStageItemHandle>;
  attachJob(jobId: string): Promise<void>;
}

function stageItemKindForAssetKind(kind: GenerativeAssetKind): ProgressItemKind {
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  return "image";
}

function toGenerationErrorSummary(error: ApiError, fallbackCode = "job_failed") {
  return {
    code: error.code || fallbackCode,
    message: error.message,
    retryable: error.status >= 500,
  };
}

function compact<T extends object>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

function actionToolForParsed(parsed: Pick<ParsedRequest, "kind" | "assetRole">): string {
  if (parsed.kind === "image" && parsed.assetRole === "poster") {
    return "generate_poster";
  }
  if (parsed.kind === "audio") return "generate_audio";
  if (parsed.kind === "video") return "generate_clip";
  return "generate_keyframe";
}

function buildGenerationActionProposal(args: {
  parsed: ParsedRequest;
  jobId: string;
  estimatedCostUsd: number;
  pinnedFingerprints: Record<string, string>;
}): Record<string, unknown> {
  return {
    summary: `Generate ${args.parsed.kind} asset with ${args.parsed.provider}.`,
    plannedWork: [
      {
        tool: actionToolForParsed(args.parsed),
        provider: args.parsed.provider,
        kind: args.parsed.kind,
        durationSec: args.parsed.durationSec,
        jobId: args.jobId,
      },
    ],
    pinnedFingerprints: args.pinnedFingerprints,
    estimate: {
      costUsd: args.estimatedCostUsd,
      unit:
        args.parsed.kind === "image"
          ? "generation"
          : `${args.parsed.durationSec}s`,
    },
  };
}

async function runGeneration(
  auth: AuthContext,
  projectId: string,
  parsed: ParsedRequest,
  item: RunStageItemHandle | null,
  action: V1Action
): Promise<V1Asset> {
  const llmCostScope = generatedAssetLlmCostScope(projectId, parsed.runId, action.id);
  // Resolve reference assets to local file paths the provider can read.
  const referencePaths: string[] = [];
  const materializedObjects: MaterializedAssetObject[] = [];
  let result;
  let preflight: Awaited<ReturnType<typeof preflightGenerationContent>>;
  try {
  for (const id of parsed.referenceAssetIds) {
    const asset = await getAsset(auth.workspaceId, projectId, id); // throws not_found
    if (asset.status !== "ready" || !asset.storageKey) {
      logger.warn("generated_asset.reference_not_ready", {
        workspaceId: auth.workspaceId,
        projectId,
        runId: parsed.runId,
        assetId: asset.id,
        assetRole: asset.role,
        assetKind: asset.kind,
        status: asset.status,
        hasStorageKey: Boolean(asset.storageKey),
      });
      throw new ApiError(
        "asset_not_ready",
        `Reference asset is not ready: ${id}.`,
        { assetIds: [id] }
      );
    }
    try {
      const materialized = await localPathForAssetBytes(asset);
      materializedObjects.push(materialized);
      referencePaths.push(materialized.path);
    } catch (err) {
      logger.error("generated_asset.reference_download_failed", {
        workspaceId: auth.workspaceId,
        projectId,
        runId: parsed.runId,
        assetId: asset.id,
        assetRole: asset.role,
        assetKind: asset.kind,
        storageBucket: asset.storageBucket,
        storageKey: asset.storageKey,
        error: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }
  let editSourceVideoPath: string | undefined;
  if (parsed.editSourceAssetId) {
    const asset = await getAsset(
      auth.workspaceId,
      projectId,
      parsed.editSourceAssetId
    );
    if (asset.kind !== "video") {
      throw new ApiError(
        "asset_invalid",
        `Edit source asset must be a video: ${parsed.editSourceAssetId}.`,
        { assetIds: [parsed.editSourceAssetId] }
      );
    }
    if (asset.status !== "ready" || !asset.storageKey) {
      throw new ApiError(
        "asset_not_ready",
        `Edit source asset is not ready: ${parsed.editSourceAssetId}.`,
        { assetIds: [parsed.editSourceAssetId] }
      );
    }
    const materialized = await localPathForAssetBytes(asset);
    materializedObjects.push(materialized);
    editSourceVideoPath = materialized.path;
  }

  if (item) {
    await item.update({
      progressPercent: 25,
      message:
        parsed.preflightIterations > 0
          ? "Refining the generation prompt."
          : "Preparing the generation prompt.",
    });
  }
  preflight = await withLlmCostRecording(
    llmCostScope,
    () =>
      preflightGenerationContent({
        provider: parsed.provider,
        kind: parsed.kind,
        prompt: parsed.prompt,
        description: parsed.description,
        iterations: parsed.preflightIterations,
        dialogueInputs: parsed.dialogueInputs,
      })
  );

  if (item) {
    await item.update({
      progressPercent: 50,
      message: `Calling ${parsed.provider} to generate the ${parsed.kind}.`,
    });
  }
  const provider = providerFor(parsed.provider);
  const baseRequest = {
    prompt: preflight.finalPrompt || parsed.prompt,
    referencePaths,
    model: parsed.model,
    size: parsed.size,
    quality: parsed.quality,
    aspectRatio: parsed.aspectRatio,
    renderingSpeed: parsed.renderingSpeed,
    magicPrompt: parsed.magicPrompt,
    numImages: parsed.numImages,
    styleType: parsed.styleType,
    stylePreset: parsed.stylePreset,
    customModelUri: parsed.customModelUri,
    enableCopyrightDetection: parsed.enableCopyrightDetection,
    seconds: parsed.providerSeconds,
    audioMode: parsed.audioMode,
    voiceId: parsed.voiceId,
    outputFormat: parsed.outputFormat,
    languageCode: parsed.languageCode,
    dialogueInputs: preflight.finalDialogueInputs || parsed.dialogueInputs,
    loop: parsed.loop,
    promptInfluence: parsed.promptInfluence,
    forceInstrumental: parsed.forceInstrumental,
    seed: parsed.seed,
    frameCount: parsed.frameCount,
    fps: parsed.fps,
    steps: parsed.steps,
    guidanceScale: parsed.guidanceScale,
    negativePrompt: parsed.negativePrompt,
    resolution: parsed.resolution,
  };

  if (parsed.provider === "openai" && parsed.kind === "image") {
    result = await provider.generateAsset({
      provider: "openai",
      kind: "image",
      ...baseRequest,
    });
  } else if (parsed.provider === "ideogram" && parsed.kind === "image") {
    result = await provider.generateAsset({
      provider: "ideogram",
      kind: "image",
      ...baseRequest,
    });
  } else if (parsed.provider === "openai" && parsed.kind === "video") {
    result = await provider.generateAsset({
      provider: "openai",
      kind: "video",
      ...baseRequest,
    });
  } else if (parsed.provider === "gemini" && parsed.kind === "video") {
    result = await provider.generateAsset({
      provider: "gemini",
      kind: "video",
      ...baseRequest,
      editSourceVideoPath,
    });
  } else if (parsed.provider === "gemini" && parsed.kind === "image") {
    result = await provider.generateAsset({
      provider: "gemini",
      kind: "image",
      ...baseRequest,
    });
  } else if (parsed.provider === "runway" && parsed.kind === "video") {
    result = await provider.generateAsset({
      provider: "runway",
      kind: "video",
      ...baseRequest,
    });
  } else if (parsed.provider === "ltx" && parsed.kind === "video") {
    result = await provider.generateAsset({
      provider: "ltx",
      kind: "video",
      ...baseRequest,
    });
  } else if (parsed.provider === "kling" && parsed.kind === "video") {
    result = await provider.generateAsset({
      provider: "kling",
      kind: "video",
      ...baseRequest,
    });
  } else if (parsed.provider === "seedance" && parsed.kind === "video") {
    result = await provider.generateAsset({
      provider: "seedance",
      kind: "video",
      ...baseRequest,
    });
  } else if (parsed.provider === "xai" && parsed.kind === "image") {
    result = await provider.generateAsset({
      provider: "xai",
      kind: "image",
      ...baseRequest,
    });
  } else if (parsed.provider === "xai" && parsed.kind === "video") {
    result = await provider.generateAsset({
      provider: "xai",
      kind: "video",
      ...baseRequest,
    });
  } else if (parsed.provider === "nvidia_api_catalog" && parsed.kind === "video") {
    result = await provider.generateAsset({
      provider: "nvidia_api_catalog",
      kind: "video",
      ...baseRequest,
    });
  } else if (parsed.provider === "elevenlabs" && parsed.kind === "audio") {
    result = await provider.generateAsset({
      provider: "elevenlabs",
      kind: "audio",
      ...baseRequest,
    });
  } else if (parsed.provider === "mock" && parsed.kind === "image") {
    result = await provider.generateAsset({
      provider: "mock",
      kind: "image",
      ...baseRequest,
    });
  } else if (parsed.provider === "mock" && parsed.kind === "video") {
    result = await provider.generateAsset({
      provider: "mock",
      kind: "video",
      ...baseRequest,
    });
  } else if (parsed.provider === "mock" && parsed.kind === "audio") {
    result = await provider.generateAsset({
      provider: "mock",
      kind: "audio",
      ...baseRequest,
    });
  } else if (parsed.provider === "nanobanano" && parsed.kind === "image") {
    result = await provider.generateAsset({
      provider: "nanobanano",
      kind: "image",
      ...baseRequest,
    });
  } else {
    throw new Error(`${parsed.provider} provider does not support ${parsed.kind}.`);
  }
  } finally {
    await Promise.allSettled(
      materializedObjects.map((materialized) => materialized.cleanup())
    );
  }

  // Meter this generation against the run's credit balance. Only cost incurred on
  // PLATFORM keys is billable; the run tally ignores BYO-key providers, and there
  // is no tally at all for local/guest/in-request generation — so this is a no-op
  // in those cases. The engine debits the accumulated billable cost per tool.
  const billProvider = BILLABLE_KEY_PROVIDER[parsed.provider];
  if (billProvider && result.costUsd) {
    noteBillableGeneration(billProvider, result.costUsd);
  }

  const storageName = randomUUID();
  const filename = `${storageName}.${result.extension}`;

  const actualDurationSec =
    result.kind === "audio"
      ? measureAudioDurationSec(result.bytes, result.extension) ?? undefined
      : undefined;
  const durationSec =
    result.kind === "audio"
      ? actualDurationSec ?? parsed.durationSec
      : parsed.durationSec;

  // assetId is filled in after the DB assigns it (see below); the binding's
  // assetId is patched onto the persisted row.
  const characterBinding: GeneratedAssetCharacterBinding | undefined =
    parsed.characterProfileIds.length > 0
      ? {
          assetId: "",
          characterProfileIds: parsed.characterProfileIds,
          referenceIds: parsed.characterReferenceIds,
          consistencyMode: parsed.consistencyMode,
          originalPrompt: parsed.prompt,
          promptInvariantVersion: CHARACTER_PROMPT_INVARIANT_VERSION,
        }
      : undefined;

  const providerSettings = compact<GeneratedAssetProviderSettings>({
    model: result.model,
    size: parsed.size,
    quality: parsed.quality,
    aspectRatio: parsed.aspectRatio,
    renderingSpeed: parsed.renderingSpeed,
    magicPrompt: parsed.magicPrompt,
    numImages: parsed.numImages,
    styleType: parsed.styleType,
    stylePreset: parsed.stylePreset,
    customModelUri: parsed.customModelUri,
    enableCopyrightDetection: parsed.enableCopyrightDetection,
    seconds: parsed.providerSeconds,
    audioMode: parsed.audioMode,
    voiceId: parsed.voiceId,
    outputFormat: parsed.outputFormat,
    languageCode: parsed.languageCode,
    loop: parsed.loop,
    promptInfluence: parsed.promptInfluence,
    forceInstrumental: parsed.forceInstrumental,
    seed: parsed.seed,
    frameCount: parsed.frameCount,
    fps: parsed.fps,
    steps: parsed.steps,
    guidanceScale: parsed.guidanceScale,
    negativePrompt: parsed.negativePrompt,
    resolution: parsed.resolution,
    consistency: result.providerSettings as Record<string, unknown> | undefined,
  });

  const provenance: GeneratedAssetProvenance = {
    provider: result.provider,
    model: result.model,
    prompt: preflight.finalPrompt,
    providerPrompt: result.prompt,
    preflight: preflight.completedIterations > 0 ? preflight : undefined,
    referenceAssetIds: parsed.referenceAssetIds.length
      ? parsed.referenceAssetIds
      : undefined,
    beatId: parsed.beatId,
    anchorIds: parsed.anchorIds.length ? parsed.anchorIds : undefined,
    characterBinding,
    providerSettings,
    requestedDurationSec: parsed.durationSec,
    actualDurationSec,
  };

  const now = new Date().toISOString();
  const { name: displayName, slug } = await resolveGeneratedAssetMetadataWithCost({
    scope: llmCostScope,
    input: {
      agent: { name: parsed.displayName, slug: parsed.slug },
      kind: parsed.kind,
      provider: parsed.provider,
      prompt: preflight.finalPrompt || parsed.prompt,
      description: parsed.description,
      role: parsed.assetRole,
    },
  });
  const context = parsed.description ? { summary: parsed.description } : undefined;
  const asset: V1Asset = {
    // Placeholder; addAsset omits it on insert and the DB assigns the real id,
    // which is then stamped onto the self-referential fields below.
    id: "",
    schemaVersion: SCHEMA_VERSIONS.asset,
    workspaceId: auth.workspaceId,
    projectId,
    kind: result.kind as AssetKind,
    filename,
    status: "pending",
    source: { type: "generated", generatedAssetId: "" },
    role: parsed.assetRole,
    name: displayName,
    ...(slug ? { slug } : {}),
    durationSec,
    context,
    userContext: {
      title: displayName,
      ...(parsed.description ? { description: parsed.description } : {}),
    },
    semanticAnalysis: buildSemanticAnalysis({
      // Seed for the in-JSON segment/word ids (exempt in-document keys). The
      // top-level assetId pointer is patched to the DB row id after insert.
      id: storageName,
      kind: result.kind as AssetKind,
      durationSec,
      filename,
      source: { type: "generated" },
      context,
      provenance,
    }),
    provenance,
    graphInputs: parsed.graphInputs,
    contentHash: sha256Hex(result.bytes),
    createdAt: now,
    updatedAt: now,
  };

  const created = await addAsset(withDerivedAssetKnowledge(asset, now), {
    createdByActionId: action.id,
  });

  const visibility = await effectiveAssetStorageVisibility({
    workspaceId: auth.workspaceId,
    projectId,
    assetVisibility: created.visibility ?? "public",
  });
  const stored = await writeAssetObject({
    workspaceId: auth.workspaceId,
    projectId,
    assetId: created.id,
    filename,
    bytes: result.bytes,
    visibility,
  });

  // Stamp the DB-generated id onto the asset's self-referential fields (these
  // could not be known before the row existed).
  const updated = await updateAsset(auth.workspaceId, projectId, created.id, (a) => {
    a.status = "ready";
    a.source = { type: "generated", generatedAssetId: created.id };
    a.storageKey = stored.storageKey;
    a.storageBucket = stored.storageBucket;
    if (a.semanticAnalysis) a.semanticAnalysis.assetId = created.id;
    if (a.provenance?.characterBinding) {
      a.provenance.characterBinding.assetId = created.id;
    }
    const derived = withDerivedAssetKnowledge(a);
    a.assetKnowledge = derived.assetKnowledge;
    a.clipUnderstanding = derived.clipUnderstanding;
    a.semanticAnalysis = derived.semanticAnalysis;
    if (a.semanticAnalysis) a.semanticAnalysis.assetId = created.id;
  });
  await createAction({
    projectId,
    orchestratorRunId: parsed.runId,
    tool: "store_asset_bytes",
    status: "applied",
    params: {
      sourceType: "generated",
      provider: result.provider,
      storageKey: stored.storageKey,
      storageBucket: stored.storageBucket,
      contentType: stored.contentType,
    },
    outputAssetIds: [updated.id],
  });
  void enqueueAssetEmbeddingRefresh(updated, { reason: "asset_ready" }).catch(() => undefined);
  return updated;
}

export interface CreateGeneratedAssetArgs {
  auth: AuthContext;
  projectId: string;
  body: unknown;
  // Optional stage handle when this generation runs inside a tracked run. The
  // caller (run orchestrator) is expected to have opened the matching stage
  // (asset_generation for image/video, audio_generation for audio) and to
  // close it once all items for the stage are finished.
  progress?: RunStageHandle;
}

interface GeneratedAssetJobInput {
  body: unknown;
}

const PROMPT_PREVIEW_MAX = 240;
const PROVIDER_CLAIM_STALE_MS = 15 * 60_000;
const PROVIDER_CLAIM_HEARTBEAT_MS = 30_000;

function clipPromptPreview(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= PROMPT_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, PROMPT_PREVIEW_MAX - 1)}…`;
}

export async function createGeneratedAsset(
  args: CreateGeneratedAssetArgs
): Promise<ApiResult> {
  const { auth, projectId, body, progress } = args;
  const job = await enqueueGeneratedAssetJob({ auth, projectId, body });
  const finished = await runGeneratedAssetJob({
    auth,
    projectId,
    jobId: job.id,
    progress,
  });
  if (finished.status === "failed") {
    throw new ApiError(
      (finished.error?.code as ApiErrorCode | undefined) || "job_failed",
      finished.error?.message || "Asset generation failed."
    );
  }
  return { status: 202, body: { job: finished } };
}

export async function startGeneratedAssetJob(
  args: CreateGeneratedAssetArgs
): Promise<ApiResult> {
  const { auth, projectId, body, progress } = args;
  const job = await enqueueGeneratedAssetJob({ auth, projectId, body });
  void runGeneratedAssetJob({
    auth,
    projectId,
    jobId: job.id,
    progress,
  }).catch((err) => {
    logger.error("generated_asset.background_job_failed", {
      workspaceId: auth.workspaceId,
      projectId,
      jobId: job.id,
      error: { message: err instanceof Error ? err.message : String(err) },
    });
  });
  return { status: 202, body: { job } };
}

export async function enqueueGeneratedAssetJob(
  args: Pick<CreateGeneratedAssetArgs, "auth" | "projectId" | "body">
): Promise<V1Job> {
  const { auth, projectId, body } = args;

  await getProject(auth.workspaceId, projectId); // throws not_found
  const parsed = parseGeneratedAssetRequest(body);
  let durableBody = body;
  if (!parsed.providerWasExplicit) {
    const resolved = await resolveWorkspaceGenerationModel({
      workspaceId: auth.workspaceId,
      kind: parsed.kind,
      explicitModel: parsed.model,
    });
    parsed.provider = resolved.provider;
    parsed.model = resolved.model;
    const supportedKinds = PROVIDER_KIND_SUPPORT[parsed.provider];
    if (!supportedKinds?.includes(parsed.kind)) {
      throw validationError("The request body is invalid.", [
        {
          path: "provider",
          message: `Provider "${parsed.provider}" supports ${supportedKinds?.join(", ") || "no"} generation, not ${parsed.kind}.`,
        },
      ]);
    }
    durableBody = {
      ...(body as Record<string, unknown>),
      provider: parsed.provider,
      ...(parsed.model ? { model: parsed.model } : {}),
    };
  }
  // Persist the action's graph references in canonical UUID form before the
  // durable job can be claimed. The provider boundary must never be the first
  // point at which its provenance becomes valid relational data.
  parsed.referenceAssetIds = await canonicalizeAssetIds(
    auth.workspaceId,
    projectId,
    parsed.referenceAssetIds
  );
  if (parsed.editSourceAssetId) {
    const [editSourceAssetId] = await canonicalizeAssetIds(
      auth.workspaceId,
      projectId,
      [parsed.editSourceAssetId]
    );
    parsed.editSourceAssetId = editSourceAssetId;
  }
  parsed.anchorIds = await canonicalizeAssetIds(auth.workspaceId, projectId, parsed.anchorIds);
  if (parsed.graphInputs?.length) {
    const canonical = await canonicalizeAssetIds(
      auth.workspaceId,
      projectId,
      parsed.graphInputs.map((input) => input.assetId)
    );
    parsed.graphInputs = parsed.graphInputs.map((input, index) => ({
      ...input,
      assetId: canonical[index],
    }));
  }
  const action = await createAction({
    id: randomUUID(),
    projectId,
    orchestratorRunId: parsed.runId,
    tool: actionToolForParsed(parsed),
    status: "running",
    params: {
      provider: parsed.provider,
      kind: parsed.kind,
      model: parsed.model,
      prompt: parsed.prompt,
      displayName: parsed.displayName,
      slug: parsed.slug,
      durationSec: parsed.durationSec,
      referenceAssetIds: parsed.referenceAssetIds,
      beatId: parsed.beatId,
      anchorIds: parsed.anchorIds,
    },
    inputAssetIds: parsed.referenceAssetIds,
    rationale: `Generate a ${parsed.kind} asset for the project.`,
  });

  const job = await createJob({
    workspaceId: auth.workspaceId,
    projectId,
    type: "asset_generation",
    status: "queued",
    progress: { currentStep: "queued", percent: 0 },
    payload: { body: durableBody } satisfies GeneratedAssetJobInput,
    result: null,
    actionId: action.id,
  });
  await updateAction(action.id, { jobIds: [job.id] });
  return asGeneratedAssetJob(job);
}

function generatedAssetJobInput(job: GeneratedAssetJob): GeneratedAssetJobInput {
  const input = job.input as GeneratedAssetJobInput | null | undefined;
  if (!input || !("body" in input)) {
    throw new ApiError(
      "job_failed",
      `Generated-asset job is missing durable input: ${job.id}.`
    );
  }
  return input;
}

export async function runGeneratedAssetJob(args: {
  auth: AuthContext;
  projectId: string;
  jobId: string;
  progress?: RunStageHandle;
}): Promise<GeneratedAssetJob> {
  const { auth, projectId, jobId, progress } = args;
  await getProject(auth.workspaceId, projectId); // throws not_found

  const job = await getJob(auth.workspaceId, projectId, jobId);
  if (
    !job ||
    job.workspaceId !== auth.workspaceId ||
    job.projectId !== projectId ||
    job.type !== "asset_generation"
  ) {
    throw new ApiError("not_found", `Generated-asset job not found: ${jobId}.`);
  }
  if (job.status === "succeeded" || job.status === "failed" || job.status === "canceled") {
    return asGeneratedAssetJob(job);
  }
  const generatedJob = asGeneratedAssetJob(job);

  const claim = await claimProviderJobExecution({
    workspaceId: auth.workspaceId,
    projectId,
    jobId: job.id,
    staleBefore: new Date(Date.now() - PROVIDER_CLAIM_STALE_MS).toISOString(),
  });
  if (claim.state !== "claimed") {
    const current = await getJob(auth.workspaceId, projectId, job.id);
    return asGeneratedAssetJob(current);
  }
  if (!claim.claimToken) {
    throw new ApiError("internal_error", "Provider job claim was missing its token.");
  }
  const claimHeartbeat = setInterval(() => {
    void renewProviderJobExecution({
      workspaceId: auth.workspaceId,
      projectId,
      jobId: job.id,
      claimToken: claim.claimToken!,
    }).catch((err) => {
      logger.error("generated_asset.provider_claim_renewal_failed", {
        workspaceId: auth.workspaceId,
        projectId,
        jobId: job.id,
        error: { message: err instanceof Error ? err.message : String(err) },
      });
    });
  }, PROVIDER_CLAIM_HEARTBEAT_MS);

  const running = generatedJob;
  let action: V1Action | null = null;
  let item: RunStageItemHandle | null = null;
  let parsed: ParsedRequest | null = null;
  let estimatedCostUsd = 0;

  try {
    if (!running.actionId) {
      throw new ApiError(
        "job_failed",
        `Generated-asset job is missing canonical action attribution: ${running.id}.`
      );
    }
    parsed = parseGeneratedAssetRequest(generatedAssetJobInput(generatedJob).body);
    if (!parsed.providerWasExplicit) {
      const resolved = await resolveWorkspaceGenerationModel({
        workspaceId: auth.workspaceId,
        kind: parsed.kind,
        explicitModel: parsed.model,
      });
      parsed.provider = resolved.provider;
      parsed.model = resolved.model;
      const supportedKinds = PROVIDER_KIND_SUPPORT[parsed.provider];
      if (!supportedKinds?.includes(parsed.kind)) {
        throw validationError("The request body is invalid.", [
          {
            path: "provider",
            message: `Provider "${parsed.provider}" supports ${supportedKinds?.join(", ") || "no"} generation, not ${parsed.kind}.`,
          },
        ]);
      }
    }
    // The agent may reference inputs by slug (e.g. "character_homeowner"). Resolve
    // every asset reference to its canonical uuid BEFORE these values are written to
    // uuid columns (createAction.input_asset_ids, asset_edges via graphInputs), or
    // Postgres rejects the raw slug with 22P02. See store.canonicalizeAssetIds.
    parsed.referenceAssetIds = await canonicalizeAssetIds(
      auth.workspaceId,
      projectId,
      parsed.referenceAssetIds
    );
    if (parsed.editSourceAssetId) {
      const [editSourceAssetId] = await canonicalizeAssetIds(
        auth.workspaceId,
        projectId,
        [parsed.editSourceAssetId]
      );
      parsed.editSourceAssetId = editSourceAssetId;
    }
    parsed.anchorIds = await canonicalizeAssetIds(auth.workspaceId, projectId, parsed.anchorIds);
    if (parsed.graphInputs?.length) {
      const canonical = await canonicalizeAssetIds(
        auth.workspaceId,
        projectId,
        parsed.graphInputs.map((input) => input.assetId)
      );
      parsed.graphInputs = parsed.graphInputs.map((input, index) => ({
        ...input,
        assetId: canonical[index],
      }));
    }
    estimatedCostUsd = estimateCostUsd({
      provider: parsed.provider,
      kind: parsed.kind,
      durationSec: parsed.durationSec,
      model: parsed.model,
    });
    const pinnedFingerprints = await getAssetFingerprintPins(
      projectId,
      parsed.referenceAssetIds
    );
    await assertRunBudgetAllows({
      runId: parsed.runId,
      projectId,
      additionalCostUsd: estimatedCostUsd,
    });
    action = await createAction({
      id: running.actionId,
      projectId,
      orchestratorRunId: parsed.runId,
      tool: actionToolForParsed(parsed),
      status: "running",
      params: {
        provider: parsed.provider,
        kind: parsed.kind,
        model: parsed.model,
        prompt: parsed.prompt,
        displayName: parsed.displayName,
        slug: parsed.slug,
        durationSec: parsed.durationSec,
        referenceAssetIds: parsed.referenceAssetIds,
        beatId: parsed.beatId,
        anchorIds: parsed.anchorIds,
      },
      inputAssetIds: parsed.referenceAssetIds,
      rationale: `Generate a ${parsed.kind} asset for the project.`,
      proposal: buildGenerationActionProposal({
        parsed,
        jobId: running.id,
        estimatedCostUsd,
        pinnedFingerprints,
      }),
      jobIds: [running.id],
    });

    // Reserve this call's cost up front (linked to the generation action), so
    // concurrent generations in the same run see each other's in-flight spend in
    // the budget check rather than both passing a one-call budget. Cost is
    // deterministic from the request; we record the estimate now and don't double
    // count it later. (is_estimate stays true until rates/usage are measured.)
    if (estimatedCostUsd > 0) {
      await recordModelCallCost({
        projectId,
        runId: parsed.runId,
        actionId: action.id,
        provider: parsed.provider,
        model: parsed.model,
        unit: parsed.kind === "image" ? "images" : "seconds",
        quantity: parsed.kind === "image" ? 1 : parsed.durationSec ?? 0,
        costUsd: estimatedCostUsd,
      });
    }

    // Bind a stage item to this asset so the progress UI can show a per-asset
    // card. The item lives for the duration of this call and is closed before
    // the function returns (success, validation failure, or provider error).
    item = progress
      ? await progress.startItem({
          kind: stageItemKindForAssetKind(parsed.kind),
          label:
            parsed.description ||
            clipPromptPreview(parsed.prompt) ||
            `Generated ${parsed.kind}`,
          provider: parsed.provider,
          prompt: parsed.prompt,
          promptPreview: clipPromptPreview(parsed.prompt),
        })
      : null;
    if (progress) await progress.attachJob(running.id);

    const asset = await runGeneration(auth, projectId, parsed, item, action);
    const finished = await completeProviderJobExecution({
      workspaceId: auth.workspaceId,
      projectId,
      jobId: running.id,
      claimToken: claim.claimToken,
      status: "succeeded",
      progress: { currentStep: "saving_artifact", percent: 100 },
      result: { assetIds: [asset.id] },
      error: null,
      actionOutputAssetIds: [asset.id],
    });
    if (!finished) return getJob(auth.workspaceId, projectId, running.id).then(asGeneratedAssetJob);
    if (item) {
      await item.succeed({
        assetId: asset.id,
        message: `Generated ${parsed.kind}.`,
      });
    }
    return asGeneratedAssetJob(finished);
  } catch (err) {
    const apiErr =
      err instanceof ApiError
        ? err
        : err instanceof Error && /^Run budget exceeded:/.test(err.message)
          ? new ApiError("budget_exceeded", err.message, {
              reason: "budget_exceeded",
              estimatedCostUsd,
              runId: parsed?.runId,
            })
        : err instanceof Error &&
            (/^Run not found:/.test(err.message) ||
              /^Run project mismatch:/.test(err.message))
          ? new ApiError("validation_failed", err.message, {
              fields: [
                {
                  path: "runId",
                  message: "runId must belong to the current project.",
                },
              ],
            })
        : new ApiError(
            "job_failed",
            err instanceof Error ? err.message : "Asset generation failed."
          );
    const failed = await completeProviderJobExecution({
      workspaceId: auth.workspaceId,
      projectId,
      jobId: running.id,
      claimToken: claim.claimToken,
      status: "failed",
      error: { code: apiErr.code, message: apiErr.message },
    });
    if (!failed) {
      return getJob(auth.workspaceId, projectId, running.id).then(asGeneratedAssetJob);
    }
    if (item) {
      await item.fail(toGenerationErrorSummary(apiErr));
    }
    return asGeneratedAssetJob(failed);
  } finally {
    clearInterval(claimHeartbeat);
  }
}

export interface GetGeneratedAssetJobArgs {
  auth: AuthContext;
  projectId: string;
  jobId: string;
}

export async function getGeneratedAssetJob(
  args: GetGeneratedAssetJobArgs
): Promise<ApiResult> {
  const { auth, projectId, jobId } = args;
  await getProject(auth.workspaceId, projectId); // throws not_found

  let loaded = await getJob(auth.workspaceId, projectId, jobId);
  // Polling is also the safe reconciliation trigger after a process crash.
  // It only examines an already-running provider claim; it never claims a
  // queued job or launches provider work from a read path.
  if (loaded.status === "running") {
    await claimProviderJobExecution({
      workspaceId: auth.workspaceId,
      projectId,
      jobId: loaded.id,
      staleBefore: new Date(Date.now() - PROVIDER_CLAIM_STALE_MS).toISOString(),
    });
    loaded = await getJob(auth.workspaceId, projectId, jobId);
  }
  const job: GeneratedAssetJob | null =
    loaded.type === "asset_generation" ? asGeneratedAssetJob(loaded) : null;
  if (
    !job ||
    job.workspaceId !== auth.workspaceId ||
    job.projectId !== projectId ||
    job.type !== "asset_generation"
  ) {
    throw new ApiError("not_found", `Generated-asset job not found: ${jobId}.`);
  }
  return { status: 200, body: { job } };
}
