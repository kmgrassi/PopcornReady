#!/usr/bin/env tsx
/**
 * transcribe-smoke — exercise the real OpenAI transcription adapter.
 *
 * Usage:
 *   pnpm --filter @popcorn/api exec tsx scripts/transcribe-smoke.ts <audio-or-video-path>
 *
 * The script is gated on OPENAI_API_KEY (or workspace provider-key resolution in
 * app flows). It exits 0 when the key is absent so CI can include the smoke
 * harness without requiring provider credentials.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { transcribeMedia } from "@/lib/generative/transcription";

function usage(): never {
  console.error("usage: transcribe-smoke.ts <audio-or-video-path>");
  process.exit(2);
}

const inputPath = process.argv[2];
if (!inputPath) usage();

if (!process.env.OPENAI_API_KEY) {
  console.log("OPENAI_API_KEY is not set; skipping real transcription smoke.");
  process.exit(0);
}

const bytes = await fs.readFile(inputPath);
const result = await transcribeMedia({
  provider: "openai",
  sourceAssetId: "smoke-source",
  filename: path.basename(inputPath),
  bytes,
});

const words = result.transcript.segments.flatMap((segment) => segment.words);
if (words.length === 0) {
  throw new Error("OpenAI transcription returned no word timestamps.");
}

console.log(
  JSON.stringify(
    {
      provider: result.provider,
      model: result.model,
      text: result.transcript.text,
      segmentCount: result.transcript.segments.length,
      wordCount: words.length,
      firstWord: words[0],
    },
    null,
    2
  )
);
