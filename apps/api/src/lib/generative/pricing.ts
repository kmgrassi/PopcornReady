// Hardcoded cost estimates for generative runs.
//
// These rates are approximations the team set so each saved clip carries a
// "what did this cost roughly" number. They are NOT live provider prices —
// providers do not return cost on their generation responses today. Tune the
// constants below as real bills come in.
//
// Convention:
//   - video / audio rates are USD per second of generated media
//   - image rates are USD per generated image

import type {
  GenerativeAssetKind,
  GenerativeProviderName,
} from "@popcorn/shared/generative/types";

export interface CostEstimateInput {
  provider: GenerativeProviderName;
  kind: GenerativeAssetKind;
  // For video/audio. Falls back to the request's `seconds` if the result did
  // not carry a measured duration.
  durationSec?: number;
  // Image generations are flat-rate, so this is unused for kind === "image".
  model?: string;
}

const VIDEO_USD_PER_SEC: Record<GenerativeProviderName, number> = {
  openai: 0.5,
  ideogram: 0,
  gemini: 0.5,
  runway: 0.12,
  ltx: 0.06,
  kling: 0.18,
  seedance: 0.36,
  xai: 0.3,
  nvidia_api_catalog: 0,
  elevenlabs: 0,
  nanobanano: 0.5,
  mock: 0,
};

// Placeholder until Google publishes Gemini Omni video-edit pricing. The scope
// intentionally uses the current Veo video rate so budget checks never reserve $0.
const GEMINI_OMNI_EDIT_USD_PER_SOURCE_SEC = VIDEO_USD_PER_SEC.gemini;

const AUDIO_USD_PER_SEC: Record<GenerativeProviderName, number> = {
  openai: 0.01,
  ideogram: 0,
  gemini: 0.01,
  runway: 0,
  ltx: 0,
  kling: 0,
  seedance: 0,
  xai: 0,
  nvidia_api_catalog: 0,
  elevenlabs: 0.01,
  nanobanano: 0,
  mock: 0,
};

const IMAGE_USD_PER_GENERATION: Record<GenerativeProviderName, number> = {
  openai: 0.05,
  ideogram: 0.08,
  gemini: 0.05,
  runway: 0,
  ltx: 0,
  kling: 0,
  seedance: 0,
  xai: 0.05,
  nvidia_api_catalog: 0,
  elevenlabs: 0,
  nanobanano: 0.05,
  mock: 0,
};

function roundCents(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * 10000) / 10000;
}

export function estimateCostUsd(input: CostEstimateInput): number {
  if (input.kind === "image") {
    return roundCents(IMAGE_USD_PER_GENERATION[input.provider] ?? 0);
  }
  const seconds = Math.max(0, Number(input.durationSec) || 0);
  if (seconds === 0) return 0;
  const rate = rateForTimedGeneration(input);
  return roundCents(rate * seconds);
}

function rateForTimedGeneration(input: CostEstimateInput): number {
  if (input.kind === "video" && input.provider === "gemini" && isGeminiOmniEdit(input.model)) {
    return GEMINI_OMNI_EDIT_USD_PER_SOURCE_SEC;
  }
  if (input.kind === "video") return VIDEO_USD_PER_SEC[input.provider] ?? 0;
  return AUDIO_USD_PER_SEC[input.provider] ?? 0;
}

function isGeminiOmniEdit(model: string | undefined): boolean {
  return model === "gemini-omni-flash-preview";
}
