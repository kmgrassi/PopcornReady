import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationStageItem } from "@popcorn/shared/v1/types";
import {
  latestReadyRunAsset,
  readyAssetStatus,
  readyAssetViewLabel,
} from "./project-ready-asset";

function item(
  itemId: string,
  overrides: Partial<GenerationStageItem> = {},
): GenerationStageItem {
  return {
    itemId,
    stageId: "stage-1",
    kind: "video",
    purpose: "asset",
    label: itemId,
    status: "succeeded",
    assetId: `asset-${itemId}`,
    createdAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:00:00.000Z",
    ...overrides,
  };
}

test("selects the latest succeeded playable stage item with stable identity", () => {
  assert.equal(
    latestReadyRunAsset([
      item("old", { updatedAt: "2026-08-05T09:00:00.000Z" }),
      item("failed-new", {
        status: "failed",
        updatedAt: "2026-08-05T12:00:00.000Z",
      }),
      item("caption", {
        kind: "caption",
        updatedAt: "2026-08-05T13:00:00.000Z",
      }),
      item("ready-new", { updatedAt: "2026-08-05T11:00:00.000Z" }),
    ])?.itemId,
    "ready-new",
  );
});

test("returns no target when the run has no ready media asset", () => {
  assert.equal(
    latestReadyRunAsset([
      item("pending", { status: "running" }),
      item("missing-id", { assetId: undefined }),
    ]),
    null,
  );
});

test("uses direct, media-specific view copy", () => {
  assert.equal(readyAssetViewLabel({ kind: "audio" }), "View audio asset");
  assert.equal(readyAssetStatus({ kind: "image" }), "Image asset ready to view.");
});
