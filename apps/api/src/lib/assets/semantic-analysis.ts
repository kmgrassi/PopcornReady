export const ASSET_SEMANTIC_ANALYSIS_SCHEMA_VERSION =
  "semanticAnalysis.v1" as const;

export interface WordTiming {
  id: string;
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface TranscriptSpan {
  id: string;
  assetId: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  text: string;
  words: WordTiming[];
}

export type SceneType =
  | "talking_head"
  | "b_roll"
  | "screen_recording"
  | "product_shot"
  | "title_card";

export interface AudioFeatures {
  energy: number;
  silence: boolean;
  music?: boolean;
  speech?: boolean;
}

export interface QualitySignals {
  sharpness?: number;
  exposure?: number;
  audioClarity?: number;
  faceVisible?: boolean;
  cameraMotion?: "static" | "smooth" | "shaky";
}

export interface MediaSegment {
  id: string;
  assetId: string;
  startMs: number;
  endMs: number;
  transcriptSpanIds?: string[];
  transcript?: TranscriptSpan[];
  visualDescription?: string;
  detectedObjects?: string[];
  sceneType?: SceneType;
  audioFeatures?: AudioFeatures;
  qualitySignals?: QualitySignals;
  semanticTags: string[];
}

export interface AssetSemanticAnalysis {
  schemaVersion: typeof ASSET_SEMANTIC_ANALYSIS_SCHEMA_VERSION;
  assetId: string;
  transcript: TranscriptSpan[];
  segments: MediaSegment[];
  createdAt: string;
}

export interface SemanticAssetInput {
  id: string;
  kind: "video" | "image" | "audio";
  durationSec?: number;
  filename?: string;
  description?: string;
  source?: { type?: string } | string;
  context?: {
    summary?: string;
    recommendedRoles?: string[];
    transcriptText?: string;
    moments?: { startSec: number; endSec: number; label?: string }[];
  };
  provenance?: {
    prompt?: string;
    provider?: string;
    model?: string;
  };
}

interface BuildOptions {
  now?: string;
}

function clampMs(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function durationMsFor(asset: SemanticAssetInput): number {
  if (typeof asset.durationSec === "number" && Number.isFinite(asset.durationSec)) {
    return Math.max(0, Math.round(asset.durationSec * 1000));
  }
  return asset.kind === "image" ? 4000 : 0;
}

function sourceType(asset: SemanticAssetInput): string | undefined {
  if (typeof asset.source === "string") return asset.source;
  return asset.source?.type;
}

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function tagsFor(asset: SemanticAssetInput): string[] {
  return unique([
    asset.kind,
    sourceType(asset),
    ...(asset.context?.recommendedRoles ?? []),
    ...(asset.provenance?.provider ? ["generated"] : []),
  ]);
}

function wordsFromText(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function wordMidpointMs(word: WordTiming): number {
  return word.startMs + (word.endMs - word.startMs) / 2;
}

export function transcriptFromText(args: {
  assetId: string;
  text: string;
  durationMs: number;
  spanId?: string;
}): TranscriptSpan[] {
  const words = wordsFromText(args.text);
  if (words.length === 0) return [];

  const durationMs = Math.max(args.durationMs, words.length * 220);
  const wordDurationMs = durationMs / words.length;
  const timings: WordTiming[] = words.map((word, index) => {
    const startMs = Math.round(index * wordDurationMs);
    const endMs =
      index === words.length - 1
        ? durationMs
        : Math.round((index + 1) * wordDurationMs);
    return {
      id: `${args.assetId}_word_${index + 1}`,
      word,
      startMs,
      endMs,
      confidence: 0.6,
    };
  });

  return [
    {
      id: args.spanId ?? `${args.assetId}_span_1`,
      assetId: args.assetId,
      startMs: 0,
      endMs: durationMs,
      text: words.join(" "),
      words: timings,
    },
  ];
}

function transcriptTextFor(asset: SemanticAssetInput): string | undefined {
  return asset.context?.transcriptText?.trim();
}

function splitTranscriptByMoments(
  assetId: string,
  transcript: TranscriptSpan[],
  moments: { startSec: number; endSec: number; label?: string }[]
): TranscriptSpan[] {
  if (transcript.length === 0 || moments.length === 0) return transcript;
  const words = transcript.flatMap((span) => span.words);
  const spans: TranscriptSpan[] = [];

  moments.forEach((moment, index) => {
    const startMs = Math.round(moment.startSec * 1000);
    const endMs = Math.round(moment.endSec * 1000);
    const momentWords = words.filter((word) => {
      const midpoint = wordMidpointMs(word);
      return midpoint >= startMs && midpoint < endMs;
    });
    if (momentWords.length === 0) return;

    spans.push({
      id: `${assetId}_span_${index + 1}`,
      assetId,
      startMs: momentWords[0].startMs,
      endMs: momentWords[momentWords.length - 1].endMs,
      text: momentWords.map((word) => word.word).join(" "),
      words: momentWords,
    });
  });

  return spans.length > 0 ? spans : transcript;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function segmentTranscriptIds(
  transcript: TranscriptSpan[],
  startMs: number,
  endMs: number
): string[] {
  return transcript
    .filter((span) => {
      if (span.words.length === 0) {
        return overlaps(span.startMs, span.endMs, startMs, endMs);
      }
      return span.words.some((word) => {
        const midpoint = wordMidpointMs(word);
        return midpoint >= startMs && midpoint < endMs;
      });
    })
    .map((span) => span.id);
}

export function decomposeAssetIntoSegments(
  asset: SemanticAssetInput,
  transcript: TranscriptSpan[]
): MediaSegment[] {
  const durationMs = durationMsFor(asset);
  const tags = tagsFor(asset);
  const moments = asset.context?.moments ?? [];

  if (moments.length > 0) {
    return moments.map((moment, index) => {
      const startMs = clampMs(moment.startSec * 1000, 0, durationMs || Number.MAX_SAFE_INTEGER);
      const endMs = clampMs(
        moment.endSec * 1000,
        startMs,
        durationMs || Number.MAX_SAFE_INTEGER
      );
      return {
        id: `${asset.id}_segment_${index + 1}`,
        assetId: asset.id,
        startMs,
        endMs,
        transcriptSpanIds: segmentTranscriptIds(transcript, startMs, endMs),
        visualDescription: moment.label || asset.context?.summary,
        semanticTags: unique([...tags, moment.label]),
      };
    });
  }

  if (transcript.length > 0) {
    return transcript.map((span, index) => ({
      id: `${asset.id}_segment_${index + 1}`,
      assetId: asset.id,
      startMs: span.startMs,
      endMs: span.endMs,
      transcriptSpanIds: [span.id],
      visualDescription: asset.kind === "audio" ? undefined : asset.context?.summary,
      audioFeatures:
        asset.kind === "audio" || asset.kind === "video"
          ? { energy: 0.5, silence: false, speech: true }
          : undefined,
      semanticTags: tags,
    }));
  }

  return [
    {
      id: `${asset.id}_segment_1`,
      assetId: asset.id,
      startMs: 0,
      endMs: durationMs,
      transcriptSpanIds: [],
      visualDescription: asset.context?.summary || asset.description,
      semanticTags: tags,
    },
  ];
}

export function buildSemanticAnalysis(
  asset: SemanticAssetInput,
  options: BuildOptions = {}
): AssetSemanticAnalysis {
  const durationMs = durationMsFor(asset);
  const text = transcriptTextFor(asset);
  const transcript = text
    ? transcriptFromText({ assetId: asset.id, text, durationMs })
    : [];
  const scopedTranscript = splitTranscriptByMoments(
    asset.id,
    transcript,
    asset.context?.moments ?? []
  );
  const segments = decomposeAssetIntoSegments(asset, scopedTranscript);

  return {
    schemaVersion: ASSET_SEMANTIC_ANALYSIS_SCHEMA_VERSION,
    assetId: asset.id,
    transcript: scopedTranscript,
    segments,
    createdAt: options.now ?? new Date().toISOString(),
  };
}
