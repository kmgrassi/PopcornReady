import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "../errors";
import {
  buildStoryboardBeatSearchChunk,
  buildStoryboardSceneSearchChunk,
} from "../storyboard-search-chunks";
import {
  parseBeatInput,
  parsePanelInput,
  parseSceneInput,
  parseStoryboardInput,
} from "../storyboards";

test("storyboard parsers preserve null clears and valid statuses", () => {
  assert.deepEqual(parseStoryboardInput({ planAssetId: null, status: "ready" }), {
    planAssetId: null,
    status: "ready",
  });
  assert.deepEqual(parseSceneInput({ sceneIndex: 1, title: null, status: "draft" }), {
    sceneIndex: 1,
    title: null,
    summary: undefined,
    setting: undefined,
    mood: undefined,
    durationSec: undefined,
    sceneAssetId: undefined,
    status: "draft",
  });
  assert.deepEqual(parseBeatInput({ intent: "Open on the hero", durationSec: null }), {
    beatIndex: undefined,
    intent: "Open on the hero",
    visualDescription: undefined,
    dialogueSummary: undefined,
    narration: undefined,
    durationSec: null,
    status: undefined,
    beatAssetId: undefined,
  });
  assert.deepEqual(parsePanelInput({ isSelected: true, approvedAt: null }), {
    panelIndex: undefined,
    imageAssetId: undefined,
    promptAssetId: undefined,
    status: undefined,
    isSelected: true,
    approvedAt: null,
  });
});

test("storyboard parsers reject invalid request shapes", () => {
  assert.throws(
    () => parseStoryboardInput(null),
    (err) => err instanceof ApiError && err.code === "validation_failed"
  );
  assert.throws(
    () => parseSceneInput({ sceneIndex: -1 }),
    (err) => err instanceof ApiError && err.code === "validation_failed"
  );
  assert.throws(
    () => parseBeatInput({ status: "done" }),
    (err) => err instanceof ApiError && err.code === "validation_failed"
  );
  assert.throws(
    () => parseBeatInput({ intent: null }),
    (err) => err instanceof ApiError && err.code === "validation_failed"
  );
  assert.throws(
    () => parsePanelInput({ isSelected: "true" }),
    (err) => err instanceof ApiError && err.code === "validation_failed"
  );
});

test("storyboard search chunks use typed labeled source text", () => {
  const scene = buildStoryboardSceneSearchChunk({
    id: "scene_1",
    sceneIndex: 0,
    title: "Opening",
    summary: "A calm kitchen at sunrise.",
    setting: "Kitchen",
    mood: "Hopeful",
    durationSec: 4.5,
  });

  assert.ok(scene);
  assert.equal(scene.chunkKey, "storyboard.scene.scene_1");
  assert.equal(scene.chunkKind, "storyboard_scene");
  assert.equal(scene.sourceHash.length, 64);
  assert.equal(
    scene.sourceText,
    [
      "Scene 1",
      "Title: Opening",
      "Summary: A calm kitchen at sunrise.",
      "Setting: Kitchen",
      "Mood: Hopeful",
      "Duration seconds: 4.5",
    ].join("\n")
  );

  const beat = buildStoryboardBeatSearchChunk({
    id: "beat_1",
    beatIndex: 1,
    sceneTitle: "Opening",
    sceneSummary: "A calm kitchen at sunrise.",
    intent: "Reveal the product.",
    visualDescription: "Steam curls around the mug.",
    dialogueSummary: "No dialogue.",
    narration: "Start your morning ready.",
    durationSec: 2,
  });

  assert.ok(beat);
  assert.equal(beat.chunkKey, "storyboard.beat.beat_1");
  assert.equal(beat.chunkKind, "storyboard_beat");
  assert.equal(
    beat.sourceText,
    [
      "Beat 2",
      "Scene title: Opening",
      "Scene summary: A calm kitchen at sunrise.",
      "Intent: Reveal the product.",
      "Visual description: Steam curls around the mug.",
      "Dialogue summary: No dialogue.",
      "Narration: Start your morning ready.",
      "Duration seconds: 2",
    ].join("\n")
  );
});

test("storyboard search chunks skip rows without searchable meaning", () => {
  assert.equal(
    buildStoryboardSceneSearchChunk({ id: "scene_1", sceneIndex: 0 }),
    null
  );
  assert.equal(
    buildStoryboardBeatSearchChunk({ id: "beat_1", beatIndex: 0, intent: " " }),
    null
  );
});
