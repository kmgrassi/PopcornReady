import { AssetObjectNotFoundError, materializeAssetObject, type MaterializedAssetObject } from "@/lib/storage/asset-read";
import { deleteAssetObject, writeAssetObject } from "@/lib/storage/asset-write";
import { measureAudioDurationSec } from "@/lib/generative/audio-duration";
import { preflightGenerationContent } from "@/lib/generative/preflight";
import { withDerivedAssetKnowledge } from "./assets";
import { enqueueAssetEmbeddingRefresh } from "./asset-embeddings/jobs";
import { withLlmCostRecording } from "./llm-costs";
import { providerFor } from "@/lib/generative/providers";
import { noteBillableGeneration, type KeyProvider } from "@/lib/provider-keys/resolve";
import { GenerativeProviderName } from "@popcorn/shared/generative/types";
import type { GeneratedAssetCharacterBinding } from "@popcorn/shared/types";
import { buildSemanticAnalysis } from "@/lib/assets/semantic-analysis";
import { sha256Hex } from "./asset-graph";
import { randomUUID } from "crypto";
import { ApiError } from "./errors";
import { generatedAssetLlmCostScope, pooledImageRevisionWriteContext, resolveGeneratedAssetMetadataWithCost, type RunStageItemHandle } from "./generated-asset-support";
import { GeneratedAssetProvenance, GeneratedAssetProviderSettings } from "./provenance";
import { AssetKind, SCHEMA_VERSIONS } from "./schemas";
import { addAsset, addGeneratedAudioVersion, applyRegeneratedAssetMedia, createAction, effectiveAssetStorageVisibility, getAsset, updateAsset, V1Action, V1Asset } from "./store";
import { readStorageConfig } from "@/lib/storage/config";
import { createLogger } from "@/lib/v1/logger";
import type { AuthContext } from "./auth";
import type { ParsedRequest } from "./generated-asset-request";
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

function compact<T extends object>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}
export async function runGeneration(
  auth: AuthContext,
  projectId: string,
  parsed: ParsedRequest,
  item: RunStageItemHandle | null,
  action: V1Action,
  sessionClaimGeneration?: number
): Promise<V1Asset> {
  const llmCostScope = generatedAssetLlmCostScope(projectId, parsed.runId, action.id);
  let revisionSource: V1Asset | undefined;
  if (parsed.sourceAssetId) {
    if (parsed.kind !== "audio" && parsed.kind !== "image") {
      throw new ApiError(
        "asset_invalid",
        "sourceAssetId is supported only for immutable image or audio revisions."
      );
    }
    revisionSource = await getAsset(
      auth.workspaceId,
      projectId,
      parsed.sourceAssetId
    );
    if (
      revisionSource.kind !== parsed.kind ||
      revisionSource.status !== "ready"
    ) {
      throw new ApiError(
        revisionSource.kind !== parsed.kind ? "asset_invalid" : "asset_not_ready",
        `Revision source must be ready ${parsed.kind}: ${revisionSource.id}.`,
        { assetIds: [revisionSource.id] }
      );
    }
    const hasSourceEdge = parsed.graphInputs?.some(
      (input) =>
        input.assetId === revisionSource!.id && input.role === "source"
    );
    if (!hasSourceEdge) {
      throw new ApiError(
        "validation_failed",
        "Immutable revision requires a source graph edge.",
        { assetIds: [revisionSource.id] }
      );
    }
  }
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
    voiceSettings: parsed.voiceSettings,
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
    voiceSettings: parsed.voiceSettings,
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

  if (revisionSource) {
    if (result.kind !== revisionSource.kind) {
      throw new ApiError(
        "asset_invalid",
        "Revision output kind must match its immutable source."
      );
    }
    const visibility = await effectiveAssetStorageVisibility({
      workspaceId: auth.workspaceId,
      projectId,
      assetVisibility: revisionSource.visibility ?? "public",
    });
    const stored = await writeAssetObject({
      workspaceId: auth.workspaceId,
      projectId,
      assetId: storageName,
      filename,
      bytes: result.bytes,
      visibility,
    });
    if (result.kind === "image") {
      try {
        const revised = await applyRegeneratedAssetMedia(
          auth.workspaceId,
          revisionSource.id,
          {
            filename,
            storageKey: stored.storageKey,
            storageBucket: stored.storageBucket,
            contentHash: asset.contentHash,
            provenance,
            repointSurfaces: false,
            actionId: action.id,
            ...pooledImageRevisionWriteContext({
              runId: parsed.runId,
              sessionClaimGeneration,
              graphInputs: parsed.graphInputs,
            }),
          }
        );
        return getAsset(auth.workspaceId, projectId, revised.assetId);
      } catch (error) {
        await deleteAssetObject({
          storageKey: stored.storageKey,
          visibility,
        }).catch(() => undefined);
        throw error;
      }
    }
    let revised: V1Asset;
    try {
      revised = await addGeneratedAudioVersion({
        workspaceId: auth.workspaceId,
        projectId,
        sourceAssetId: revisionSource.id,
        actionId: action.id,
        asset: withDerivedAssetKnowledge(
          {
            ...asset,
            id: storageName,
            status: "ready",
            slug: null,
            source: { type: "generated", generatedAssetId: storageName },
            storageKey: stored.storageKey,
            storageBucket: stored.storageBucket,
            semanticAnalysis: undefined,
          },
          now
        ),
      });
    } catch (error) {
      await deleteAssetObject({
        storageKey: stored.storageKey,
        visibility,
      }).catch((cleanupError) => {
        logger.error("generated_asset.audio_revision_cleanup_failed", {
          projectId,
          sourceAssetId: revisionSource?.id,
          storageKey: stored.storageKey,
          error: {
            message:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          },
        });
      });
      throw error;
    }
    await createAction({
      projectId,
      orchestratorRunId: parsed.runId,
      tool: "store_asset_bytes",
      status: "applied",
      params: {
        sourceType: "generated_audio_revision",
        sourceAssetId: revisionSource.id,
        provider: result.provider,
        storageKey: stored.storageKey,
        storageBucket: stored.storageBucket,
        contentType: stored.contentType,
      },
      inputAssetIds: [revisionSource.id],
      outputAssetIds: [revised.id],
    });
    void enqueueAssetEmbeddingRefresh(revised, {
      reason: "asset_ready",
    }).catch(() => undefined);
    return revised;
  }

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
