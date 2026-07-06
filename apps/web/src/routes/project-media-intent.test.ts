import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceAsset } from "../lib/api-client";
import {
  MEDIA_INTENT_PRESETS,
  buildMediaIntentBrief,
  canCreateMediaIntentRun,
  presetConstraintHint,
  selectionReducer,
} from "./project-media-intent";

function asset(
  id: string,
  overrides: Partial<WorkspaceAsset> = {}
): WorkspaceAsset {
  return {
    id,
    projectId: "project_1",
    projectName: "Project",
    kind: "video",
    status: "ready",
    source: "uploaded",
    filename: `${id}.mp4`,
    createdAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  };
}

test("selection reducer preserves tap order and renumbers after deselect", () => {
  let state: string[] = [];
  state = selectionReducer(state, { type: "toggle", assetId: "asset_b" });
  state = selectionReducer(state, { type: "toggle", assetId: "asset_a" });
  state = selectionReducer(state, { type: "toggle", assetId: "asset_c" });
  assert.deepEqual(state, ["asset_b", "asset_a", "asset_c"]);

  state = selectionReducer(state, { type: "toggle", assetId: "asset_a" });
  assert.deepEqual(state, ["asset_b", "asset_c"]);

  state = selectionReducer(state, { type: "toggle", assetId: "asset_a" });
  assert.deepEqual(state, ["asset_b", "asset_c", "asset_a"]);
});

test("selection reducer selects all in grid order", () => {
  const state = selectionReducer(["asset_c"], {
    type: "selectAll",
    assetIds: ["asset_a", "asset_b", "asset_a"],
  });

  assert.deepEqual(state, ["asset_a", "asset_b"]);
});

test("preset constraints surface hints and gate create", () => {
  const montage = MEDIA_INTENT_PRESETS.find((preset) => preset.id === "montage")!;
  const narration = MEDIA_INTENT_PRESETS.find((preset) => preset.id === "narration")!;

  assert.match(presetConstraintHint(montage, [asset("asset_1")]) ?? "", /at least 2/);
  assert.match(
    presetConstraintHint(narration, [asset("image_1", { kind: "image" })]) ?? "",
    /video/
  );

  assert.equal(
    canCreateMediaIntentRun({
      intentText: "Make this sing.",
      selectedAssets: [asset("asset_1", { status: "processing" })],
      preset: null,
    }),
    false
  );
  assert.equal(
    canCreateMediaIntentRun({
      intentText: "Make this sing.",
      selectedAssets: [asset("asset_1"), asset("asset_2")],
      preset: montage,
    }),
    true
  );
});

test("brief composition uses text box intent and ordered asset ids", () => {
  const montage = MEDIA_INTENT_PRESETS.find((preset) => preset.id === "montage")!;
  const brief = buildMediaIntentBrief("  Use the sunset as the ending.  ", [
    "asset_b",
    "asset_a",
  ], montage);

  assert.equal(brief.goal, "Use the sunset as the ending.");
  assert.deepEqual(brief.constraints?.mustUseAssetIds, ["asset_b", "asset_a"]);
  assert.equal(brief.targetLengthSec, 45);
});
