// Storyboard sketch-tile generator (Storyboard & Scenes scope, Part B).
//
// Given a Scene + Beat (and optional scene/character anchors), produce ONE rough
// sketch panel and register it as a pooled `beat_storyboard` Asset with
// `depicts: { beatId }` and provenance edges back to the beat intent + scene
// context. This is the cheap, low-res pre-viz path that runs BEFORE the
// expensive `beat_keyframe` + `beat_clip` stage, so the full storyboard renders
// in seconds and gates photoreal spend.
//
// It reuses the existing image-provider plumbing (`providerFor`) and the sketch
// style preset, and stays decoupled from any persistence store: the caller
// supplies where to write bytes and how to mint a public URL, so the generator
// is unit-testable offline against the `mock` provider.

import type { Beat, Scene } from "@popcorn/shared/types";
import type { Asset } from "@popcorn/shared/assets/types";
import type {
  GenerativeProviderName,
  GenerateAssetRequest,
} from "@popcorn/shared/generative/types";
import { providerFor } from "./providers";
import {
  STORYBOARD_SKETCH_TILE_QUALITY,
  STORYBOARD_SKETCH_TILE_SIZE,
  buildStoryboardSketchPrompt,
} from "./sketch-style";

// Providers that can produce a still image cheaply. We keep this small and
// explicit; the default is the fast/cheap image path. Minor likenesses are
// forced onto Gemini (OpenAI image-edit rejects editing photorealistic minors —
// see CLAUDE.md / [[openai-image-minor-safety-block]]). Sketches are non-
// photoreal, but we still route any minor through Gemini to stay safe.
export type StoryboardTileProvider = Extract<
  GenerativeProviderName,
  "openai" | "gemini" | "mock"
>;

export const DEFAULT_STORYBOARD_TILE_PROVIDER: StoryboardTileProvider = "openai";

export interface GenerateStoryboardTileInput {
  projectId: string;
  scene: Scene;
  beat: Beat;

  // Optional sketch-form anchors the tile conditions on for within-scene
  // consistency (PR3 generates these; PR2 just threads them through as
  // provenance input edges + reference paths when present).
  sceneAnchorAssetId?: string;
  characterAnchorAssetIds?: string[];
  // Local file paths for any reference images passed to the provider.
  referencePaths?: string[];

  // Force the minor-safe provider regardless of `provider` (any minor likeness
  // routes through Gemini).
  containsMinor?: boolean;
  // Override the image provider. Defaults to the cheap/fast path.
  provider?: StoryboardTileProvider;

  // --- persistence seam (kept out of this module so it stays store-agnostic) -
  // Mint the storage filename's id namespace (the store assigns the real asset
  // id in production; tests pass a deterministic generator).
  newId: () => string;
}

// The generator stays storage-agnostic: it returns the tile metadata plus the
// raw image bytes, and the store layer persists them — uploading to the object
// store and recording storage_key/storage_bucket so the serving layer can
// deliver them in every environment. See addStoryboardTiles.
export interface GeneratedStoryboardTile {
  asset: Asset;
  bytes: Buffer;
}

// Resolve which provider actually runs: minors always go to Gemini.
export function resolveStoryboardTileProvider(input: {
  provider?: StoryboardTileProvider;
  containsMinor?: boolean;
}): StoryboardTileProvider {
  if (input.containsMinor) return "gemini";
  return input.provider ?? DEFAULT_STORYBOARD_TILE_PROVIDER;
}

function imageRequestFor(
  provider: StoryboardTileProvider,
  prompt: string,
  referencePaths: string[] | undefined
): GenerateAssetRequest {
  const base = {
    prompt,
    referencePaths,
    size: STORYBOARD_SKETCH_TILE_SIZE,
    // Low-res / fast: storyboard tiles are deliberately cheap.
    quality: STORYBOARD_SKETCH_TILE_QUALITY,
  };
  if (provider === "gemini") {
    return { provider: "gemini", kind: "image", ...base };
  }
  if (provider === "mock") {
    return { provider: "mock", kind: "image", ...base };
  }
  return { provider: "openai", kind: "image", ...base };
}

export async function generateStoryboardTile(
  input: GenerateStoryboardTileInput
): Promise<GeneratedStoryboardTile> {
  const beatId = input.beat.id;
  if (!beatId) {
    throw new Error(
      "generateStoryboardTile requires a beat with a stable id (call ensureBeatIds first)."
    );
  }

  const provider = resolveStoryboardTileProvider(input);
  const prompt = buildStoryboardSketchPrompt({
    beatIntent: input.beat.intent,
    beatName: input.beat.name,
    sceneName: input.scene.name,
    setting: input.scene.setting,
    mood: input.scene.mood,
  });

  const result = await providerFor(provider).generateAsset(
    imageRequestFor(provider, prompt, input.referencePaths)
  );

  // The storage filename uses its own id namespace (not the asset id) so the
  // bytes can be uploaded before the asset row exists.
  const id = input.newId();
  const filename = `${id}.${result.extension}`;

  // Provenance input edges: the tile depends on the beat intent + scene context,
  // and on any sketch anchors it was conditioned on (NORTH_STAR recompute-
  // affected: editing the beat/scene regenerates only this tile).
  const anchorIds = [
    ...(input.sceneAnchorAssetId ? [input.sceneAnchorAssetId] : []),
    ...(input.characterAnchorAssetIds ?? []),
  ];

  const asset: Asset = {
    id,
    schemaVersion: "asset.v1",
    projectId: input.projectId,
    kind: "image",
    role: "beat_storyboard",
    depicts: { beatId },
    description: `Storyboard sketch — ${input.scene.name}: ${input.beat.name}`,
    media: {
      // Placeholder locator: the store uploads the bytes and records the real
      // storage key/bucket, which drive serving (not this field).
      url: filename,
      filename,
      // Sketches are stills; carry the beat's intended shot duration so a tile
      // reads at the right length in the storyboard timeline.
      durationSec: input.beat.durationSec,
    },
    source: "generated",
    provenance: {
      provider: result.provider,
      ...(result.model ? { model: result.model } : {}),
      prompt,
      ...(result.prompt && result.prompt !== prompt
        ? { providerPrompt: result.prompt }
        : {}),
      ...(typeof result.costUsd === "number" ? { costUsd: result.costUsd } : {}),
      inputs: {
        beatId,
        ...(anchorIds.length ? { anchorIds } : {}),
        ...(input.sceneAnchorAssetId
          ? { referenceAssetIds: [input.sceneAnchorAssetId] }
          : {}),
      },
    },
  };

  return { asset, bytes: result.bytes };
}
