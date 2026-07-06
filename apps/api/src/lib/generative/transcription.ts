import {
  normalizeTranscriptResult,
  type RawTranscriptResult,
  type TranscriptAssetContent,
} from "@popcorn/shared/transcript";
import { resolveProviderApiKey } from "@/lib/provider-keys/resolve";

export type TranscriptionProvider = "openai" | "mock";

export interface TranscriptionInput {
  sourceAssetId: string;
  filename: string;
  bytes?: Buffer;
  language?: string;
  provider?: TranscriptionProvider;
  model?: string;
}

export interface TranscriptionResult {
  provider: TranscriptionProvider;
  model?: string;
  transcript: TranscriptAssetContent;
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = "whisper-1";

export async function transcribeMedia(
  input: TranscriptionInput
): Promise<TranscriptionResult> {
  const provider = input.provider ?? "openai";
  if (provider === "mock") return mockTranscription(input);
  return openAITranscription(input);
}

function mockTranscription(input: TranscriptionInput): TranscriptionResult {
  const result: RawTranscriptResult = {
    language: input.language ?? "en",
    durationSec: 3,
    text: "testing one two three",
    segments: [
      {
        startSec: 0,
        endSec: 3,
        text: "testing one two three",
        words: [
          { w: "testing", startSec: 0, endSec: 0.8, confidence: 0.99 },
          { w: "one", startSec: 0.9, endSec: 1.3, confidence: 0.99 },
          { w: "two", startSec: 1.45, endSec: 1.85, confidence: 0.99 },
          { w: "three", startSec: 2.05, endSec: 2.7, confidence: 0.99 },
        ],
      },
    ],
  };
  return {
    provider: "mock",
    model: "mock-transcriber-v1",
    transcript: normalizeTranscriptResult({
      sourceAssetId: input.sourceAssetId,
      provider: "mock",
      model: "mock-transcriber-v1",
      language: input.language,
      result,
    }),
  };
}

async function openAITranscription(
  input: TranscriptionInput
): Promise<TranscriptionResult> {
  if (!input.bytes) throw new Error("Transcription bytes are required for OpenAI.");
  const apiKey = await resolveProviderApiKey("openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set for the OpenAI provider.");

  const model = input.model ?? DEFAULT_OPENAI_TRANSCRIPTION_MODEL;
  const form = new FormData();
  form.set("model", model);
  form.set("response_format", "verbose_json");
  form.set("timestamp_granularities[]", "word");
  form.set("timestamp_granularities[]", "segment");
  if (input.language) form.set("language", input.language);
  form.set(
    "file",
    new Blob([new Uint8Array(input.bytes)], { type: contentTypeForFilename(input.filename) }),
    input.filename
  );

  const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI transcription failed (${response.status}): ${text.slice(0, 500)}`);
  }
  const raw = (await response.json()) as OpenAIVerboseTranscription;
  const result: RawTranscriptResult = {
    text: raw.text,
    language: raw.language,
    durationSec: raw.duration,
    segments: raw.segments?.map((segment) => ({
      startSec: segment.start,
      endSec: segment.end,
      text: segment.text,
      words: raw.words
        ?.filter((word) => word.start >= segment.start && word.end <= segment.end)
        .map((word) => ({
          w: word.word,
          startSec: word.start,
          endSec: word.end,
          confidence: word.confidence,
        })),
    })),
    words: raw.words?.map((word) => ({
      w: word.word,
      startSec: word.start,
      endSec: word.end,
      confidence: word.confidence,
    })),
  };
  return {
    provider: "openai",
    model,
    transcript: normalizeTranscriptResult({
      sourceAssetId: input.sourceAssetId,
      provider: "openai",
      model,
      language: input.language,
      result,
    }),
  };
}

interface OpenAIVerboseTranscription {
  text?: string;
  language?: string;
  duration?: number;
  words?: Array<{ word: string; start: number; end: number; confidence?: number }>;
  segments?: Array<{ text: string; start: number; end: number }>;
}

function contentTypeForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "application/octet-stream";
}
