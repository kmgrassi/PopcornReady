import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTranscriptResult } from "@popcorn/shared/transcript";
import { transcribeMedia } from "../transcription";

test("normalizes provider words into transcript segments", () => {
  const transcript = normalizeTranscriptResult({
    sourceAssetId: "asset-1",
    provider: "mock",
    result: {
      words: [
        { word: " testing ", start: 0, end: 0.8, confidence: 1.2 },
        { word: "one", start: 1, end: 1.3, confidence: 0.8 },
      ],
    },
  });

  assert.equal(transcript.schemaVersion, "transcript.v1");
  assert.equal(transcript.text, "testing one");
  assert.deepEqual(transcript.segments[0], {
    position: 0,
    startSec: 0,
    endSec: 1.3,
    text: "testing one",
    words: [
      { w: "testing", startSec: 0, endSec: 0.8, confidence: 1 },
      { w: "one", startSec: 1, endSec: 1.3, confidence: 0.8 },
    ],
  });
});

test("mock transcription returns deterministic word timestamps", async () => {
  const result = await transcribeMedia({
    provider: "mock",
    sourceAssetId: "asset-1",
    filename: "fixture.wav",
  });

  assert.equal(result.provider, "mock");
  assert.equal(result.transcript.text, "testing one two three");
  assert.equal(result.transcript.segments[0]?.words.length, 4);
  assert.equal(result.transcript.segments[0]?.words[0]?.startSec, 0);
});
