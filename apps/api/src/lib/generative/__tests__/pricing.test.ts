import assert from "node:assert/strict";
import test from "node:test";
import { estimateCostUsd } from "../pricing";

test("video cost is the per-model rate × seconds", () => {
  // Sora 2 ($0.10/s) vs Sora 2 Pro ($0.50/s) — same provider, different price.
  assert.equal(
    estimateCostUsd({ provider: "openai", kind: "video", model: "sora-2", durationSec: 8 }),
    0.8
  );
  assert.equal(
    estimateCostUsd({ provider: "openai", kind: "video", model: "sora-2-pro", durationSec: 8 }),
    4
  );
  // Veo 3.1 quality ($0.40/s), Runway Gen-4.5 ($0.25/s), LTX-2.3 fast ($0.04/s).
  assert.equal(
    estimateCostUsd({ provider: "gemini", kind: "video", model: "veo-3.1-generate-preview", durationSec: 4 }),
    1.6
  );
  assert.equal(
    estimateCostUsd({ provider: "runway", kind: "video", model: "gen4.5", durationSec: 5 }),
    1.25
  );
  assert.equal(
    estimateCostUsd({ provider: "ltx", kind: "video", model: "ltx-2-3-fast", durationSec: 6 }),
    0.24
  );
});

test("versioned snapshot models resolve to their base-model rate", () => {
  // Dated snapshot of Sora 2 Pro must price at $0.50/s, not the OpenAI default.
  assert.equal(
    estimateCostUsd({ provider: "openai", kind: "video", model: "sora-2-pro-2025-10-06", durationSec: 8 }),
    4
  );
  // A sora-2 snapshot resolves to sora-2 ($0.10/s), not the longer sora-2-pro key.
  assert.equal(
    estimateCostUsd({ provider: "openai", kind: "video", model: "sora-2-2025-10-06", durationSec: 8 }),
    0.8
  );
  // Boundary guard: a different model that merely shares a prefix is not matched.
  assert.equal(
    estimateCostUsd({ provider: "openai", kind: "video", model: "sora-29", durationSec: 10 }),
    1 // provider fallback ($0.10/s), not a sora-2 prefix hit
  );
});

test("unknown/omitted model falls back to the provider video rate", () => {
  // No model → provider fallback (runway = $0.25/s).
  assert.equal(
    estimateCostUsd({ provider: "runway", kind: "video", durationSec: 4 }),
    1
  );
  // Unrecognized model → provider fallback, not zero.
  assert.equal(
    estimateCostUsd({ provider: "openai", kind: "video", model: "sora-3-experimental", durationSec: 10 }),
    1
  );
});

test("image cost is a per-model flat rate", () => {
  assert.equal(estimateCostUsd({ provider: "openai", kind: "image", model: "gpt-image-1.5" }), 0.042);
  assert.equal(estimateCostUsd({ provider: "openai", kind: "image", model: "gpt-image-1-mini" }), 0.011);
  assert.equal(estimateCostUsd({ provider: "gemini", kind: "image", model: "gemini-2.5-flash-image" }), 0.039);
  assert.equal(estimateCostUsd({ provider: "ideogram", kind: "image", model: "ideogram-v4" }), 0.06);
  // Unknown image model → provider fallback.
  assert.equal(estimateCostUsd({ provider: "gemini", kind: "image", model: "imagen-future" }), 0.039);
});

test("audio cost scales with measured duration", () => {
  assert.equal(
    estimateCostUsd({ provider: "elevenlabs", kind: "audio", durationSec: 10 }),
    0.03
  );
});

test("missing duration on video/audio returns zero", () => {
  assert.equal(estimateCostUsd({ provider: "openai", kind: "video", model: "sora-2" }), 0);
  assert.equal(estimateCostUsd({ provider: "elevenlabs", kind: "audio" }), 0);
});

test("mock provider is free", () => {
  assert.equal(
    estimateCostUsd({ provider: "mock", kind: "video", model: "mock", durationSec: 30 }),
    0
  );
  assert.equal(estimateCostUsd({ provider: "mock", kind: "image" }), 0);
});

test("negative or non-finite durations are treated as zero", () => {
  assert.equal(
    estimateCostUsd({ provider: "openai", kind: "video", model: "sora-2", durationSec: -5 }),
    0
  );
  assert.equal(
    estimateCostUsd({ provider: "openai", kind: "video", model: "sora-2", durationSec: Number.NaN }),
    0
  );
});
