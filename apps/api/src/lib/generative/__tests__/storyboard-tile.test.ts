import assert from "node:assert/strict";
import test from "node:test";
import type { Beat, Scene } from "@popcorn/shared/types";
import {
  generateStoryboardTile,
  resolveStoryboardTileProvider,
} from "../storyboard-tile";
import {
  STORYBOARD_SKETCH_STYLE_PRESET,
  buildStoryboardSketchPrompt,
} from "../sketch-style";

const scene: Scene = {
  id: "scene_1",
  name: "Kitchen reveal",
  setting: "a sunlit kitchen, morning",
  mood: "warm, hopeful",
  beats: [{ id: "beat_1_hook", name: "hook", durationSec: 3, intent: "open on the steaming mug" }],
};
const beat: Beat = scene.beats[0];

// --- sketch style preset ---------------------------------------------------

test("buildStoryboardSketchPrompt leads with the sketch preset, then scene + shot", () => {
  const prompt = buildStoryboardSketchPrompt({
    beatIntent: beat.intent,
    beatName: beat.name,
    sceneName: scene.name,
    setting: scene.setting,
    mood: scene.mood,
  });
  assert.ok(
    prompt.startsWith(STORYBOARD_SKETCH_STYLE_PRESET),
    "the sketch style framing dominates the prompt"
  );
  assert.match(prompt, /storyboard sketch panel/i);
  assert.match(prompt, /Scene: Kitchen reveal/);
  assert.match(prompt, /Setting: a sunlit kitchen/);
  assert.match(prompt, /Mood: warm, hopeful/);
  assert.match(prompt, /Shot \(hook\): open on the steaming mug/);
});

test("buildStoryboardSketchPrompt omits absent scene context cleanly", () => {
  const prompt = buildStoryboardSketchPrompt({ beatIntent: "a wide establishing shot" });
  assert.ok(prompt.startsWith(STORYBOARD_SKETCH_STYLE_PRESET));
  assert.doesNotMatch(prompt, /Scene:/);
  assert.doesNotMatch(prompt, /Setting:/);
  assert.match(prompt, /Shot: a wide establishing shot/);
});

// --- minor-safe provider routing ------------------------------------------

test("resolveStoryboardTileProvider forces Gemini for any minor likeness", () => {
  assert.equal(resolveStoryboardTileProvider({ provider: "openai", containsMinor: true }), "gemini");
  assert.equal(resolveStoryboardTileProvider({ provider: "openai" }), "openai");
  assert.equal(resolveStoryboardTileProvider({}), "openai");
  assert.equal(resolveStoryboardTileProvider({ provider: "mock" }), "mock");
});

// --- generateStoryboardTile ------------------------------------------------

test("generateStoryboardTile produces a beat_storyboard asset with depicts + provenance + bytes", async () => {
  let n = 0;
  const { asset: tile, bytes } = await generateStoryboardTile({
    projectId: "proj_1",
    scene,
    beat,
    sceneAnchorAssetId: "scene_anchor_1",
    characterAnchorAssetIds: ["char_anchor_1"],
    provider: "mock",
    newId: () => `tile_${++n}`,
  });

  assert.equal(tile.role, "beat_storyboard");
  assert.equal(tile.kind, "image");
  assert.equal(tile.projectId, "proj_1");
  assert.deepEqual(tile.depicts, { beatId: "beat_1_hook" });
  assert.equal(tile.source, "generated");
  // Provenance: prompt is the sketch-style prompt; input edges trace the beat
  // + the conditioning anchors.
  assert.ok(tile.provenance);
  assert.ok(tile.provenance!.prompt.startsWith(STORYBOARD_SKETCH_STYLE_PRESET));
  assert.equal(tile.provenance!.inputs?.beatId, "beat_1_hook");
  assert.deepEqual(tile.provenance!.inputs?.anchorIds, ["scene_anchor_1", "char_anchor_1"]);
  assert.equal(tile.media.durationSec, 3);
  assert.match(tile.media.filename, /^tile_1\./);

  // Raw bytes are returned for the store layer to upload (no local-disk write).
  assert.ok(bytes.length > 0, "sketch bytes were produced");
});

test("generateStoryboardTile uses Ideogram v3 for 1024px sketch tiles", async () => {
  const previousKey = process.env.IDEOGRAM_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; body?: unknown }> = [];

  process.env.IDEOGRAM_API_KEY = "ideogram-test-key";
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: init?.body });
    if (String(input).includes("/v1/ideogram-v3/generate")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              prompt: "Storyboard sketch.",
              url: "https://ideogram.ai/api/images/ephemeral/storyboard.png",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(Buffer.from("png-bytes"), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  };

  try {
    const { asset } = await generateStoryboardTile({
      projectId: "proj_1",
      scene,
      beat,
      provider: "ideogram",
      newId: () => "tile_ideogram",
    });

    assert.equal(asset.provenance?.provider, "ideogram");
    assert.equal(asset.provenance?.model, "ideogram-v3");
    assert.equal(requests[0].url, "https://api.ideogram.ai/v1/ideogram-v3/generate");
    assert.ok(requests[0].body instanceof FormData);
    // 1024x1024 is on the v3 allowed list (the v4 list starts at 2048x2048), so
    // the cheap/small sketch-tile size must pass through unchanged.
    assert.equal(requests[0].body.get("resolution"), "1024x1024");
    assert.equal(requests[0].body.get("prompt"), asset.provenance?.prompt);
  } finally {
    if (previousKey === undefined) delete process.env.IDEOGRAM_API_KEY;
    else process.env.IDEOGRAM_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});

test("generateStoryboardTile rejects a beat without a stable id", async () => {
  await assert.rejects(
    generateStoryboardTile({
      projectId: "proj_1",
      scene,
      beat: { name: "hook", durationSec: 3, intent: "x" },
      provider: "mock",
      newId: () => "tile_x",
    }),
    /stable id/
  );
});
