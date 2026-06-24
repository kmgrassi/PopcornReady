// Regenerate an image asset by minting a NEW IMMUTABLE VERSION.
//
// Why this exists: generated image bytes can become undeliverable — e.g. a
// storyboard keyframe written only to ephemeral local disk and never uploaded to
// managed storage, so its row is `ready` but `resolveAssetUrl` yields nothing.
// This re-runs image generation from the asset's saved prompt (or a
// caller-supplied one), uploads the result to managed storage, and persists it as
// a new asset version in the same lineage. Assets are immutable, so the store
// inserts the new version and repoints the surfaces (storyboard panels, selection
// slots) that referenced the old asset — a dead URL becomes live again.
//
// If the asset has no saved prompt and the caller didn't provide one, this
// raises `prompt_required` — the typed signal the client uses to pop the
// "enter a prompt" dialog.

import { randomUUID } from "crypto";
import type { GenerateAssetRequest, GeneratedAssetResult } from "@popcorn/shared/generative/types";
import { ApiError } from "@/core/errors";
import { providerFor } from "@/lib/generative/providers";
import { writeAssetObject } from "@/lib/storage/asset-write";
import { createLogger, type LogFields, type Logger } from "@/lib/v1/logger";
import { sha256Hex } from "./asset-graph";
import { GeneratedAssetProvenance } from "./provenance";
import {
  applyRegeneratedAssetMedia,
  effectiveAssetStorageVisibility,
  getAssetByWorkspace,
  type AssetMediaUrls,
  type RegeneratedAssetMedia,
  type V1Asset,
} from "./store";

// Image provider used when the asset carries no provenance provider (older
// assets, or ones generated before provenance was recorded).
const DEFAULT_IMAGE_PROVIDER = "openai";

export interface RegenerateImageAssetArgs {
  workspaceId: string;
  assetId: string;
  /** Caller-supplied prompt; wins over the asset's saved prompt when present. */
  prompt?: string | null;
  /** Caller-supplied provider/model; wins over the asset's saved provenance. */
  provider?: string | null;
  model?: string | null;
  requestId?: string;
  deps?: Partial<RegenerateImageAssetDeps>;
}

export interface RegenerateImageAssetDeps {
  getAsset: (workspaceId: string, assetId: string) => Promise<V1Asset>;
  generateImage: (input: {
    provider: string;
    model?: string;
    prompt: string;
  }) => Promise<GeneratedAssetResult>;
  writeObject: typeof writeAssetObject;
  resolveVisibility: typeof effectiveAssetStorageVisibility;
  applyMedia: (
    workspaceId: string,
    assetId: string,
    update: RegeneratedAssetMedia
  ) => Promise<AssetMediaUrls>;
  logger: Logger;
}

async function defaultGenerateImage(input: {
  provider: string;
  model?: string;
  prompt: string;
}): Promise<GeneratedAssetResult> {
  const request = {
    provider: input.provider,
    kind: "image",
    prompt: input.prompt,
    ...(input.model ? { model: input.model } : {}),
  } as GenerateAssetRequest;
  return providerFor(input.provider).generateAsset(request);
}

const defaultDeps: RegenerateImageAssetDeps = {
  getAsset: getAssetByWorkspace,
  generateImage: defaultGenerateImage,
  writeObject: writeAssetObject,
  resolveVisibility: effectiveAssetStorageVisibility,
  applyMedia: applyRegeneratedAssetMedia,
  logger: createLogger(),
};

function errorFields(err: unknown): LogFields["error"] {
  if (err instanceof ApiError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return { message: String(err) };
}

async function timed<T>(
  logger: Logger,
  event: string,
  fields: LogFields,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logger.info(`${event}.succeeded`, {
      ...fields,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    logger.error(`${event}.failed`, {
      ...fields,
      durationMs: Date.now() - startedAt,
      error: errorFields(err),
    });
    throw err;
  }
}

export async function regenerateImageAsset(
  args: RegenerateImageAssetArgs
): Promise<AssetMediaUrls> {
  const { workspaceId, assetId } = args;
  const { getAsset, generateImage, writeObject, resolveVisibility, applyMedia, logger: baseLogger } = {
    ...defaultDeps,
    ...args.deps,
  };
  const logger = baseLogger.child({
    requestId: args.requestId,
    workspaceId,
  });
  const startedAt = Date.now();

  logger.info("asset_regenerate.started", {
    assetId,
    promptProvided: Boolean((args.prompt ?? "").trim()),
  });

  try {
    const asset = await timed(
      logger,
      "asset_regenerate.asset_lookup",
      { assetId },
      () => getAsset(workspaceId, assetId)
    );
    const assetLogger = logger.child({
      projectId: asset.projectId,
      provider: args.provider?.trim() || asset.provenance?.provider || DEFAULT_IMAGE_PROVIDER,
    });

    // Only images regenerate from a text prompt; video/audio need their own
    // re-run paths (different inputs), so reject them with an actionable error.
    if (asset.kind !== "image") {
      throw new ApiError(
        "asset_invalid",
        `Asset ${assetId} is a ${asset.kind}; only image assets can be regenerated from a prompt.`,
        { assetIds: [assetId] }
      );
    }

    const provided = (args.prompt ?? "").trim();
    const saved = (asset.provenance?.prompt ?? "").trim();
    const prompt = provided || saved;
    if (!prompt) {
      throw new ApiError(
        "prompt_required",
        "This image has no saved prompt to regenerate from. Provide a prompt to continue.",
        { assetIds: [assetId] }
      );
    }

    const provider = args.provider?.trim() || asset.provenance?.provider || DEFAULT_IMAGE_PROVIDER;
    const model = args.model?.trim() || asset.provenance?.model;
    assetLogger.info("asset_regenerate.asset_ready", {
      assetId,
      projectId: asset.projectId,
      kind: asset.kind,
      assetStatus: asset.status,
      assetVisibility: asset.visibility,
      promptSource: provided ? "provided" : "saved",
      promptLength: prompt.length,
      model: model ?? null,
    });

    const result = await timed(
      assetLogger,
      "asset_regenerate.provider_generate",
      { assetId, provider, model: model ?? null },
      () => generateImage({ provider, prompt, ...(model ? { model } : {}) })
    );

    // Fresh filename per regenerate so the managed storage key changes and CDN
    // caches can't serve the old (or missing) object.
    const filename = `${randomUUID()}.${result.extension}`;
    // Respect project visibility: a "public" asset inside a private project must
    // land in the private bucket, mirroring the generated-assets write path. Never
    // publish private project media just because the asset row says "public".
    const visibility = await timed(
      assetLogger,
      "asset_regenerate.visibility_resolve",
      { assetId, projectId: asset.projectId, assetVisibility: asset.visibility ?? "public" },
      () =>
        resolveVisibility({
          workspaceId,
          projectId: asset.projectId,
          assetVisibility: asset.visibility ?? "public",
        })
    );
    const stored = await timed(
      assetLogger,
      "asset_regenerate.storage_write",
      { assetId, projectId: asset.projectId, visibility, contentType: result.mimeType },
      () =>
        writeObject({
          workspaceId,
          projectId: asset.projectId,
          assetId,
          filename,
          bytes: result.bytes,
          visibility,
          contentType: result.mimeType,
        })
    );

    // Preserve existing provenance edges (beatId/anchorIds/etc.); refresh only the
    // generation inputs/outputs that this re-run changed.
    const provenance: GeneratedAssetProvenance = {
      ...(asset.provenance ?? {}),
      provider: result.provider,
      ...(result.model ? { model: result.model } : {}),
      prompt,
      ...(result.prompt && result.prompt !== prompt
        ? { providerPrompt: result.prompt }
        : {}),
    };

    const media = await timed(
      assetLogger,
      "asset_regenerate.apply_media",
      {
        assetId,
        projectId: asset.projectId,
        storageBucket: stored.storageBucket,
      },
      () =>
        applyMedia(workspaceId, assetId, {
          storageKey: stored.storageKey,
          storageBucket: stored.storageBucket,
          filename,
          // New bytes → new content hash, so stale-candidate detection and downstream
          // generation inputs see the asset's content as changed (not the old image).
          contentHash: sha256Hex(result.bytes),
          ...(asset.durationSec != null ? { durationSec: asset.durationSec } : {}),
          provenance,
        })
    );

    assetLogger.info("asset_regenerate.succeeded", {
      assetId,
      projectId: asset.projectId,
      durationMs: Date.now() - startedAt,
      hasUrl: Boolean(media.url),
      storageBucket: stored.storageBucket,
    });
    return media;
  } catch (err) {
    logger.error("asset_regenerate.failed", {
      assetId,
      durationMs: Date.now() - startedAt,
      error: errorFields(err),
    });
    throw err;
  }
}
