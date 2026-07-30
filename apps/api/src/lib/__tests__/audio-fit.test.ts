import assert from "node:assert/strict";
import test from "node:test";
import { fitAudioToPicture } from "@popcorn/shared/audio-fit";
import { resolveAudioFitTargetWindow } from "@/lib/api/v1/audio-fit";
import { audioFitCritiqueArtifactId } from "@/lib/api/v1/store";

test("fitAudioToPicture accepts an audio segment already within tolerance", () => {
  const result = fitAudioToPicture({
    audioDurationSec: 5.1,
    targetWindow: { startSec: 10, endSec: 15 },
  });

  assert.equal(result.verdict, "ok");
  assert.equal(result.retime.applied, false);
  assert.equal(result.placement.startSec, 10);
  assert.equal(result.placement.endSec, 15.1);
  assert.ok(result.reasons.includes("duration_within_tolerance"));
});

test("fitAudioToPicture applies bounded retime inside the default cap", () => {
  const result = fitAudioToPicture({
    audioDurationSec: 5.5,
    targetWindow: { startSec: 2, endSec: 7 },
  });

  assert.equal(result.verdict, "ok");
  assert.equal(result.retime.applied, true);
  assert.equal(result.retime.factor, 1.1);
  assert.equal(result.placement.endSec, 7);
  assert.ok(result.reasons.includes("retime_within_cap"));
});

test("fitAudioToPicture marks modest over-cap retime for review and staged rewrite", () => {
  const result = fitAudioToPicture({
    audioDurationSec: 5.75,
    targetWindow: { startSec: 0, endSec: 5 },
  });

  assert.equal(result.verdict, "needs_review");
  assert.equal(result.retime.applied, false);
  assert.equal(result.placement.endSec, 5.75);
  assert.ok(result.reasons.includes("retime_exceeds_cap"));
  assert.ok(result.reasons.includes("tighten_script"));
});

test("fitAudioToPicture fails when duration mismatch is too large for useful retime", () => {
  const result = fitAudioToPicture({
    audioDurationSec: 8,
    targetWindow: { startSec: 0, endSec: 5 },
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.placement.endSec, 8);
  assert.ok(result.reasons.includes("regenerate"));
});

test("fitAudioToPicture uses word overlap to require review", () => {
  const result = fitAudioToPicture({
    audioDurationSec: 5,
    targetWindow: { startSec: 10, endSec: 15 },
    words: [
      { w: "early", startSec: -1, endSec: -0.5 },
      { w: "inside", startSec: 1, endSec: 2 },
    ],
  });

  assert.equal(result.verdict, "needs_review");
  assert.equal(result.metrics.wordOverlapRatio, 0.667);
  assert.ok(result.reasons.includes("word_timing_outside_window"));
});

test("fitAudioToPicture fails degenerate target windows", () => {
  const result = fitAudioToPicture({
    audioDurationSec: 5,
    targetWindow: { startSec: 4, endSec: 4 },
  });

  assert.equal(result.verdict, "fail");
  assert.ok(result.reasons.includes("target_window_invalid"));
});

test("current picture duration overrides a caller-supplied fit window", () => {
  assert.deepEqual(
    resolveAudioFitTargetWindow({
      pictureDurationSec: 5,
      plannedWindow: { startSec: 10, endSec: 16 },
      requestedWindow: { startSec: 99, endSec: 199 },
    }),
    { startSec: 10, endSec: 15 }
  );
});

test("picture-fit retries reuse one deterministic critique artifact", () => {
  const first = audioFitCritiqueArtifactId(
    "00000000-0000-4000-8000-000000000001"
  );
  assert.equal(
    first,
    audioFitCritiqueArtifactId("00000000-0000-4000-8000-000000000001")
  );
  assert.notEqual(
    first,
    audioFitCritiqueArtifactId("00000000-0000-4000-8000-000000000002")
  );
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});
