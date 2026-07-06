import type { RenderAudioDuckWindow, RenderAudioLayer } from "@popcorn/shared/types";

export interface AudioMixLayerInput {
  id?: string;
  audioAssetId: string;
  role?: string;
  gainDb?: number;
  duckUnder?: boolean;
  inSec?: number;
  outSec?: number;
  durationSec?: number;
}

export interface ResolveAudioMixInput {
  layers: AudioMixLayerInput[];
  timelineDurationSec: number;
  segmentWindow?: {
    startSec: number;
    endSec: number;
  };
  minGainDb?: number;
  maxGainDb?: number;
  duckGainDb?: number;
}

export interface ResolvedAudioMixPlan {
  layers: RenderAudioLayer[];
  audioAssetIds: string[];
  audioDurationSec: number;
}

const DEFAULT_MIN_GAIN_DB = -60;
const DEFAULT_MAX_GAIN_DB = 12;
const DEFAULT_DUCK_GAIN_DB = -12;

export function resolveAudioMixPlan(input: ResolveAudioMixInput): ResolvedAudioMixPlan {
  const minGainDb = input.minGainDb ?? DEFAULT_MIN_GAIN_DB;
  const maxGainDb = input.maxGainDb ?? DEFAULT_MAX_GAIN_DB;
  const duckGainDb = input.duckGainDb ?? DEFAULT_DUCK_GAIN_DB;
  const segmentWindow = normalizedWindow(input.segmentWindow, input.timelineDurationSec);
  const resolved = input.layers
    .map((layer) => normalizeLayer(layer, input.timelineDurationSec, minGainDb, maxGainDb))
    .filter((layer): layer is RenderAudioLayer => layer !== null)
    .map((layer) => intersectLayer(layer, segmentWindow))
    .filter((layer): layer is RenderAudioLayer => layer !== null);

  const duckSources = resolved.filter((layer) => !layer.duckUnder);
  const layers = resolved.map((layer) => {
    if (!layer.duckUnder) return layer;
    return {
      ...layer,
      duckWindows: duckSources
        .map((source) => overlapWindow(layer, source, duckGainDb))
        .filter((window): window is RenderAudioDuckWindow => window !== null),
    };
  });

  return {
    layers,
    audioAssetIds: [...new Set(layers.map((layer) => layer.audioAssetId))],
    audioDurationSec: layers.reduce((max, layer) => Math.max(max, layer.outSec), 0),
  };
}

function normalizeLayer(
  layer: AudioMixLayerInput,
  timelineDurationSec: number,
  minGainDb: number,
  maxGainDb: number
): RenderAudioLayer | null {
  const inSec = clampFinite(layer.inSec ?? 0, 0, timelineDurationSec);
  const requestedOut = layer.outSec ?? layer.durationSec ?? timelineDurationSec;
  const outSec = clampFinite(requestedOut, inSec, timelineDurationSec);
  if (!layer.audioAssetId || outSec <= inSec) return null;
  return {
    ...(layer.id ? { id: layer.id } : {}),
    audioAssetId: layer.audioAssetId,
    ...(layer.role ? { role: layer.role } : {}),
    gainDb: clampFinite(layer.gainDb ?? 0, minGainDb, maxGainDb),
    duckUnder: layer.duckUnder ?? false,
    inSec,
    outSec,
    duckWindows: [],
  };
}

function normalizedWindow(
  window: ResolveAudioMixInput["segmentWindow"],
  timelineDurationSec: number
): { startSec: number; endSec: number } | undefined {
  if (!window) return undefined;
  const startSec = clampFinite(window.startSec, 0, timelineDurationSec);
  const endSec = clampFinite(window.endSec, startSec, timelineDurationSec);
  return endSec > startSec ? { startSec, endSec } : undefined;
}

function intersectLayer(
  layer: RenderAudioLayer,
  window: { startSec: number; endSec: number } | undefined
): RenderAudioLayer | null {
  if (!window) return layer;
  const inSec = Math.max(layer.inSec, window.startSec);
  const outSec = Math.min(layer.outSec, window.endSec);
  if (outSec <= inSec) return null;
  return { ...layer, inSec, outSec };
}

function overlapWindow(
  ducked: RenderAudioLayer,
  source: RenderAudioLayer,
  gainDb: number
): RenderAudioDuckWindow | null {
  const startSec = Math.max(ducked.inSec, source.inSec);
  const endSec = Math.min(ducked.outSec, source.outSec);
  if (endSec <= startSec) return null;
  return { startSec, endSec, gainDb, sourceAssetIds: [source.audioAssetId] };
}

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
