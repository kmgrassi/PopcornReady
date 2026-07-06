import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "../errors";
import {
  buildStoryboardBeatSearchChunk,
  buildStoryboardSceneSearchChunk,
} from "../storyboard-search-chunks";
import { semanticBeatChanged } from "../storyboards-repository";
import type { StoryboardBeatRow } from "../storyboards-types";
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
    shotType: undefined,
    camera: undefined,
    framing: undefined,
    status: undefined,
    beatAssetId: undefined,
  });
  assert.deepEqual(
    parseBeatInput({
      intent: "Open on the hero",
      shotType: "wide",
      camera: "slow dolly-in",
      framing: null,
    }),
    {
      beatIndex: undefined,
      intent: "Open on the hero",
      visualDescription: undefined,
      dialogueSummary: undefined,
      narration: undefined,
      durationSec: undefined,
      shotType: "wide",
      camera: "slow dolly-in",
      framing: null,
      status: undefined,
      beatAssetId: undefined,
    }
  );
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
    () => parseBeatInput({ shotType: 3 }),
    (err) => err instanceof ApiError && err.code === "validation_failed"
  );
  assert.throws(
    () => parsePanelInput({ isSelected: "true" }),
    (err) => err instanceof ApiError && err.code === "validation_failed"
  );
});

// Every column the story_beats_require_snapshot trigger treats as semantic must
// flip semanticBeatChanged, or updates through updateBeat hit check_violation.
test("semanticBeatChanged matches the DB trigger's semantic field list", () => {
  const base: StoryboardBeatRow = {
    id: "beat_1",
    project_id: "project_1",
    scene_id: "scene_1",
    beat_index: 0,
    intent: "Reveal the product.",
    visual_description: "Steam curls around the mug.",
    dialogue_summary: null,
    narration: null,
    duration_sec: 2,
    shot_type: "wide",
    camera: "static",
    framing: "centered",
    status: "ready",
    beat_asset_id: "asset_1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  assert.equal(semanticBeatChanged(base, { ...base }), false);

  const semanticEdits: Partial<StoryboardBeatRow>[] = [
    { intent: "New intent." },
    { visual_description: "New visual." },
    { dialogue_summary: "New dialogue." },
    { narration: "New narration." },
    { duration_sec: 4 },
    { shot_type: "close-up" },
    { camera: "handheld" },
    { framing: "off-center" },
  ];
  for (const edit of semanticEdits) {
    assert.equal(
      semanticBeatChanged(base, { ...base, ...edit }),
      true,
      `expected ${Object.keys(edit)[0]} change to be semantic`
    );
  }

  // Non-semantic bookkeeping changes must not force a snapshot.
  assert.equal(semanticBeatChanged(base, { ...base, beat_index: 3 }), false);
  assert.equal(semanticBeatChanged(base, { ...base, status: "approved" }), false);
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
