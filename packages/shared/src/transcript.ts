export const TRANSCRIPT_SCHEMA_VERSION = "transcript.v1" as const;
export const TRANSCRIPT_SEGMENT_SCHEMA_VERSION = "transcriptSegment.v1" as const;

export interface TranscriptWord {
  w: string;
  startSec: number;
  endSec: number;
  confidence?: number;
}

export interface TranscriptSegment {
  id?: string;
  schemaVersion?: typeof TRANSCRIPT_SEGMENT_SCHEMA_VERSION;
  position: number;
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
  words: TranscriptWord[];
}

export interface TranscriptAssetContent {
  schemaVersion: typeof TRANSCRIPT_SCHEMA_VERSION;
  sourceAssetId: string;
  language?: string;
  provider: string;
  model?: string;
  text: string;
  durationSec?: number;
  segments: TranscriptSegment[];
}

export interface RawTranscriptWord {
  text?: string;
  word?: string;
  w?: string;
  startSec?: number;
  endSec?: number;
  start?: number;
  end?: number;
  confidence?: number;
}

export interface RawTranscriptSegment {
  text?: string;
  startSec?: number;
  endSec?: number;
  start?: number;
  end?: number;
  speaker?: string;
  words?: RawTranscriptWord[];
}

export interface RawTranscriptResult {
  text?: string;
  language?: string;
  durationSec?: number;
  segments?: RawTranscriptSegment[];
  words?: RawTranscriptWord[];
}

export function normalizeTranscriptResult(input: {
  sourceAssetId: string;
  provider: string;
  model?: string;
  language?: string;
  result: RawTranscriptResult;
}): TranscriptAssetContent {
  const segments = normalizeSegments(input.result);
  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    sourceAssetId: input.sourceAssetId,
    provider: input.provider,
    ...(input.model ? { model: input.model } : {}),
    ...(input.language ?? input.result.language
      ? { language: input.language ?? input.result.language }
      : {}),
    text: input.result.text?.trim() || segments.map((segment) => segment.text).join(" ").trim(),
    ...(typeof input.result.durationSec === "number"
      ? { durationSec: input.result.durationSec }
      : {}),
    segments,
  };
}

function normalizeSegments(result: RawTranscriptResult): TranscriptSegment[] {
  const rawSegments = result.segments?.length
    ? result.segments
    : result.words?.length
      ? [{ words: result.words }]
      : result.text
        ? [{ text: result.text, startSec: 0, endSec: 0, words: [] }]
        : [];

  return rawSegments.map((segment, index) => {
    const words = normalizeWords(segment.words ?? []);
    const startSec = finiteNumber(segment.startSec ?? segment.start, words[0]?.startSec ?? 0);
    const lastWord = words[words.length - 1];
    const endSec = finiteNumber(
      segment.endSec ?? segment.end,
      lastWord?.endSec ?? startSec
    );
    const text = (segment.text?.trim() || words.map((word) => word.w).join(" ")).trim();
    return {
      position: index,
      startSec,
      endSec: Math.max(startSec, endSec),
      text,
      ...(segment.speaker ? { speaker: segment.speaker } : {}),
      words,
    };
  });
}

function normalizeWords(words: RawTranscriptWord[]): TranscriptWord[] {
  return words
    .map((word) => {
      const text = (word.w ?? word.word ?? word.text ?? "").trim();
      const startSec = finiteNumber(word.startSec ?? word.start, 0);
      const endSec = finiteNumber(word.endSec ?? word.end, startSec);
      return {
        w: text,
        startSec,
        endSec: Math.max(startSec, endSec),
        ...(typeof word.confidence === "number" && Number.isFinite(word.confidence)
          ? { confidence: clamp(word.confidence, 0, 1) }
          : {}),
      };
    })
    .filter((word) => word.w.length > 0);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
