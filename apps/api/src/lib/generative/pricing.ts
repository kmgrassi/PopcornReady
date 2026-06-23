// Provider cost rates for generative runs.
//
// Generative media cost is deterministic from the request — providers don't
// return a dollar figure, but cost = quantity × rate, where quantity is seconds
// (video/audio) or images (image), and rate is the provider's published price.
// So the only thing we maintain is an accurate rate table.
//
// Rates are keyed by MODEL (the dominant price driver — `sora-2` vs `sora-2-pro`,
// Veo lite vs quality, Gen-4.5 vs Turbo are different prices), with a per-provider
// fallback for unknown models. Each rate is the provider's current published price
// for that model's DEFAULT configuration (typical resolution; audio included where
// the model emits it). Resolution/audio refinements (Sora resolution tiers, Veo
// audio surcharge) are baked into the representative rate for now; threading those
// dimensions from the call sites is a follow-up.
//
// Sources + dates are noted inline — retune as real bills land.

import type {
  GenerativeAssetKind,
  GenerativeProviderName,
} from "@popcorn/shared/generative/types";

export interface CostEstimateInput {
  provider: GenerativeProviderName;
  kind: GenerativeAssetKind;
  // The model id (e.g. "sora-2", "veo-3.1-generate-preview"). Selects the rate;
  // unknown/omitted models fall back to the provider default rate.
  model?: string;
  // For video/audio. Falls back to the request's `seconds` if the result did
  // not carry a measured duration.
  durationSec?: number;
}

// USD per second of generated video, by model.
const VIDEO_USD_PER_SEC_BY_MODEL: Record<string, number> = {
  // OpenAI Sora 2 — $0.10/s @720p standard; Pro $0.30/s @720p, $0.50/s @1024p.
  // (openai.com/api/pricing, Jun 2026)
  "sora-2": 0.1,
  "sora-2-pro": 0.5,
  // Google Veo 3.1 — quality tier ~$0.40/s incl. audio (+50% vs no-audio);
  // fast ~$0.15/s; lite ~$0.05/s. (ai.google.dev/gemini-api/docs/pricing, Jun 2026)
  "veo-3.1-generate-preview": 0.4,
  "veo-3.1-fast-generate-preview": 0.15,
  // Runway — Gen-4.5 25 credits/s × $0.01/credit = $0.25/s; Gen-4 Turbo 5 cr/s =
  // $0.05/s. (docs.dev.runwayml.com/guides/pricing, Jun 2026)
  "gen4.5": 0.25,
  gen4_turbo: 0.05,
  // Lightricks LTX-2.3 — Fast 1080p $0.04/s; Pro 1080p $0.06/s.
  // (docs.ltx.video/pricing, Apr 2026)
  "ltx-2-3-fast": 0.04,
  "ltx-2-3-pro": 0.06,
  // NVIDIA Cosmos (API catalog) — no public per-second price; placeholder. VERIFY.
  "nvidia/cosmos3-nano": 0.05,
};

// Per-provider video rate when the specific model isn't listed above.
const VIDEO_USD_PER_SEC_FALLBACK: Record<GenerativeProviderName, number> = {
  openai: 0.1,
  gemini: 0.4,
  runway: 0.25,
  ltx: 0.04,
  nvidia_api_catalog: 0.05,
  nanobanano: 0.1,
  ideogram: 0,
  elevenlabs: 0,
  mock: 0,
};

// USD per generated image, by model.
const IMAGE_USD_PER_GEN_BY_MODEL: Record<string, number> = {
  // OpenAI gpt-image-1/1.5 — $0.011 low / $0.042 medium / $0.167 high @1024².
  // Default ≈ medium. (costgoat.com/pricing/openai-images, Jun 2026)
  "gpt-image-1.5": 0.042,
  "gpt-image-1": 0.042,
  "gpt-image-1-mini": 0.011,
  // Gemini 2.5 Flash Image (Nano Banana) — 1290 output tok/img × $30/1M tok =
  // $0.039/img. (ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image, Jun 2026)
  "gemini-2.5-flash-image": 0.039,
  // Ideogram — v4 ~$0.06/img; v3 ~$0.08/img. (ideogram pricing; VERIFY v4)
  "ideogram-v4": 0.06,
  "ideogram-v3": 0.08,
};

// Per-provider image rate when the specific model isn't listed above.
const IMAGE_USD_PER_GEN_FALLBACK: Record<GenerativeProviderName, number> = {
  openai: 0.042,
  gemini: 0.039,
  ideogram: 0.06,
  nanobanano: 0.039,
  runway: 0,
  ltx: 0,
  nvidia_api_catalog: 0,
  elevenlabs: 0,
  mock: 0,
};

// USD per second of generated audio. Audio is billed per character upstream
// (ElevenLabs ~$0.0002/char; OpenAI TTS ~$15/1M char); converted to a per-second
// approximation for speech (~15 char/s). Small vs video — keyed by provider only.
const AUDIO_USD_PER_SEC: Record<GenerativeProviderName, number> = {
  elevenlabs: 0.003,
  openai: 0.0003,
  gemini: 0.003,
  ideogram: 0,
  runway: 0,
  ltx: 0,
  nvidia_api_catalog: 0,
  nanobanano: 0,
  mock: 0,
};

function roundCents(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * 10000) / 10000;
}

// Look up a model rate, tolerating versioned snapshots. Providers ship dated
// aliases (e.g. "sora-2-pro-2025-10-06") that share a base model's price but miss
// an exact-key match; without this they'd fall back to the provider default and
// underreport (Sora 2 Pro at $0.10/s instead of $0.50/s). So after an exact miss,
// match the LONGEST base-model key that prefixes the id at a "-" boundary —
// "sora-2-pro-2025-10-06" → "sora-2-pro" (not "sora-2").
function rateForModel(
  table: Record<string, number>,
  model: string | undefined
): number | undefined {
  if (!model) return undefined;
  if (model in table) return table[model];
  let best: string | undefined;
  for (const key of Object.keys(table)) {
    if (model.startsWith(key) && model.charAt(key.length) === "-") {
      if (best === undefined || key.length > best.length) best = key;
    }
  }
  return best === undefined ? undefined : table[best];
}

function videoRatePerSec(input: CostEstimateInput): number {
  return (
    rateForModel(VIDEO_USD_PER_SEC_BY_MODEL, input.model) ??
    VIDEO_USD_PER_SEC_FALLBACK[input.provider] ??
    0
  );
}

function imageRatePerGen(input: CostEstimateInput): number {
  return (
    rateForModel(IMAGE_USD_PER_GEN_BY_MODEL, input.model) ??
    IMAGE_USD_PER_GEN_FALLBACK[input.provider] ??
    0
  );
}

export function estimateCostUsd(input: CostEstimateInput): number {
  if (input.kind === "image") {
    return roundCents(imageRatePerGen(input));
  }
  const seconds = Math.max(0, Number(input.durationSec) || 0);
  if (seconds === 0) return 0;
  const rate =
    input.kind === "video"
      ? videoRatePerSec(input)
      : AUDIO_USD_PER_SEC[input.provider] ?? 0;
  return roundCents(rate * seconds);
}
