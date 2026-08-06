import assert from "node:assert/strict";
import test from "node:test";

import type { GenerationStageItem } from "@popcorn/shared/v1/types";
import { canReceiveStageItemFeedback } from "./asset-feedback-eligibility";

function stageItem(
  patch: Partial<GenerationStageItem> = {},
): GenerationStageItem {
  return {
    itemId: "item-1",
    stageId: "stage-1",
    kind: "image",
    purpose: "asset",
    label: "Keyframe",
    status: "succeeded",
    assetId: "asset-1",
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...patch,
  };
}

test("offers asset feedback only for completed image and video items", () => {
  assert.equal(canReceiveStageItemFeedback(stageItem()), true);
  assert.equal(canReceiveStageItemFeedback(stageItem({ kind: "video" })), true);
  assert.equal(canReceiveStageItemFeedback(stageItem({ status: "running" })), false);
  assert.equal(canReceiveStageItemFeedback(stageItem({ status: "failed" })), false);
  assert.equal(canReceiveStageItemFeedback(stageItem({ assetId: undefined })), false);
  assert.equal(canReceiveStageItemFeedback(stageItem({ kind: "audio" })), false);
});
