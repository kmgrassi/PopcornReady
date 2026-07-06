import assert from "node:assert/strict";
import test from "node:test";
import { resolveAudioMixPlan } from "./audio-mix";

test("resolveAudioMixPlan clamps gains and resolves unique audio ids", () => {
  const plan = resolveAudioMixPlan({
    timelineDurationSec: 10,
    layers: [
      { audioAssetId: "voice_1", role: "voiceover", gainDb: 24, inSec: 1, outSec: 5 },
      { audioAssetId: "music_1", role: "soundtrack", gainDb: -80, inSec: 0, outSec: 10 },
      { audioAssetId: "voice_1", role: "voiceover", gainDb: 1, inSec: 6, outSec: 8 },
    ],
  });

  assert.deepEqual(plan.audioAssetIds, ["voice_1", "music_1"]);
  assert.equal(plan.audioDurationSec, 10);
  assert.equal(plan.layers[0].gainDb, 12);
  assert.equal(plan.layers[1].gainDb, -60);
});

test("resolveAudioMixPlan creates duck windows only where ducked layers overlap sources", () => {
  const plan = resolveAudioMixPlan({
    timelineDurationSec: 12,
    layers: [
      { audioAssetId: "voice_1", role: "voiceover", inSec: 2, outSec: 5 },
      { audioAssetId: "voice_2", role: "voiceover", inSec: 8, outSec: 10 },
      {
        audioAssetId: "original_1",
        role: "original_audio",
        duckUnder: true,
        inSec: 0,
        outSec: 12,
      },
    ],
  });

  const original = plan.layers.find((layer) => layer.audioAssetId === "original_1");
  assert.ok(original);
  assert.deepEqual(original.duckWindows, [
    { startSec: 2, endSec: 5, gainDb: -12, sourceAssetIds: ["voice_1"] },
    { startSec: 8, endSec: 10, gainDb: -12, sourceAssetIds: ["voice_2"] },
  ]);
});

test("resolveAudioMixPlan limits preview layers to a requested segment window", () => {
  const plan = resolveAudioMixPlan({
    timelineDurationSec: 20,
    segmentWindow: { startSec: 5, endSec: 9 },
    layers: [
      { audioAssetId: "voice_1", inSec: 0, outSec: 4 },
      { audioAssetId: "voice_2", inSec: 6, outSec: 12 },
      { audioAssetId: "original_1", duckUnder: true, inSec: 0, outSec: 20 },
    ],
  });

  assert.deepEqual(
    plan.layers.map((layer) => ({
      audioAssetId: layer.audioAssetId,
      inSec: layer.inSec,
      outSec: layer.outSec,
      duckWindows: layer.duckWindows,
    })),
    [
      { audioAssetId: "voice_2", inSec: 6, outSec: 9, duckWindows: [] },
      {
        audioAssetId: "original_1",
        inSec: 5,
        outSec: 9,
        duckWindows: [{ startSec: 6, endSec: 9, gainDb: -12, sourceAssetIds: ["voice_2"] }],
      },
    ]
  );
});
