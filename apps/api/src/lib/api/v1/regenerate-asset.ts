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
};

export async function regenerateImageAsset(
  args: RegenerateImageAssetArgs
): Promise<AssetMediaUrls> {
  const { workspaceId, assetId } = args;
  const { getAsset, generateImage, writeObject, resolveVisibility, applyMedia } = {
    ...defaultDeps,
    ...args.deps,
  };

  const asset = await getAsset(workspaceId, assetId);

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

  const provider = asset.provenance?.provider || DEFAULT_IMAGE_PROVIDER;
  const model = asset.provenance?.model;
  const result = await generateImage({ provider, prompt, ...(model ? { model } : {}) });

  // Fresh filename per regenerate so the managed storage key changes and CDN
  // caches can't serve the old (or missing) object.
  const filename = `${randomUUID()}.${result.extension}`;
  // Respect project visibility: a "public" asset inside a private project must
  // land in the private bucket, mirroring the generated-assets write path. Never
  // publish private project media just because the asset row says "public".
  const visibility = await resolveVisibility({
    workspaceId,
    projectId: asset.projectId,
    assetVisibility: asset.visibility ?? "public",
  });
  const stored = await writeObject({
    workspaceId,
    projectId: asset.projectId,
    assetId,
    filename,
    bytes: result.bytes,
    visibility,
    contentType: result.mimeType,
  });

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

  return applyMedia(workspaceId, assetId, {
    storageKey: stored.storageKey,
    storageBucket: stored.storageBucket,
    filename,
    // New bytes → new content hash, so stale-candidate detection and downstream
    // generation inputs see the asset's content as changed (not the old image).
    contentHash: sha256Hex(result.bytes),
    ...(asset.durationSec != null ? { durationSec: asset.durationSec } : {}),
    provenance,
  });
}
