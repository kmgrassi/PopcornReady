import assert from "node:assert/strict";
import test from "node:test";
import { createRenderPlanFromTimeline, isRenderDurationPolicy } from "@popcorn/timeline/render-plan";
import { Clip, Timeline } from "@popcorn/shared/types";

const timeline: Timeline = {
  aspectRatio: "16:9",
  fps: 24,
  segments: [
    {
      id: "seg_1",
      clipId: "clip_video",
      sourceInSec: 2,
      sourceOutSec: 7,
      role: "hook",
      reason: "selected opening beat",
    },
  ],
};

function audioClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip_audio",
    filename: "narration.mp3",
    url: "/uploads/narration.mp3",
    kind: "audio",
    durationSec: 12,
    description: "Narration",
    ...overrides,
  };
}

test("createRenderPlanFromTimeline derives deterministic Remotion output settings", () => {
  const { renderPlan, alignment } = createRenderPlanFromTimeline({
    timeline,
    timelineId: "tl_1",
    audioClips: [audioClip()],
  });

  assert.equal(renderPlan.schemaVersion, "render-plan.v1");
  assert.equal(renderPlan.engine, "remotion");
  assert.equal(renderPlan.timelineId, "tl_1");
  assert.equal(renderPlan.durationPolicy, "match_longest_media");
  assert.equal(renderPlan.durationSec, 12);
  assert.equal(renderPlan.timelineDurationSec, 5);
  assert.equal(renderPlan.audioDurationSec, 12);
  assert.deepEqual(renderPlan.audioAssetIds, ["clip_audio"]);
  assert.deepEqual(renderPlan.output, {
    format: "mp4",
    codec: "h264",
    width: 1920,
    height: 1080,
    fps: 24,
    quality: "standard",
  });
  assert.equal(alignment.warning?.includes("exporting to the longer 12s"), true);
});

test("createRenderPlanFromTimeline honors measured audio duration and timeline-only policy", () => {
  const { renderPlan, alignment } = createRenderPlanFromTimeline({
    timeline,
    audioClips: [audioClip({ measuredDurationSec: 8.5 })],
    durationPolicy: "timeline_only",
    quality: "draft",
  });

  assert.equal(renderPlan.durationSec, 5);
  assert.equal(renderPlan.audioDurationSec, 8.5);
  assert.equal(renderPlan.output.quality, "draft");
  assert.equal(alignment.truncatesAudio, true);
});

test("createRenderPlanFromTimeline can carry layered audio mix entries", () => {
  const { renderPlan, alignment } = createRenderPlanFromTimeline({
    timeline,
    audioMixAssetId: "mix_1",
    audioMixLayers: [
      {
        audioAssetId: "voice_1",
        role: "voiceover",
        gainDb: 0,
        duckUnder: false,
        inSec: 0,
        outSec: 4,
        duckWindows: [],
      },
      {
        audioAssetId: "original_1",
        role: "original_audio",
        gainDb: -3,
        duckUnder: true,
        inSec: 0,
        outSec: 5,
        duckWindows: [{ startSec: 0, endSec: 4, gainDb: -12, sourceAssetIds: ["voice_1"] }],
      },
    ],
  });

  assert.equal(renderPlan.audioMixAssetId, "mix_1");
  assert.equal(renderPlan.audioDurationSec, 5);
  assert.deepEqual(renderPlan.audioAssetIds, ["voice_1", "original_1"]);
  assert.equal(renderPlan.audioMixLayers?.[1].duckWindows[0].gainDb, -12);
  assert.equal(alignment.comparison.audioDurationSec, 5);
});

test("isRenderDurationPolicy accepts only supported render duration policies", () => {
  assert.equal(isRenderDurationPolicy("match_longest_media"), true);
  assert.equal(isRenderDurationPolicy("fail_on_mismatch"), true);
  assert.equal(isRenderDurationPolicy("bogus"), false);
});
