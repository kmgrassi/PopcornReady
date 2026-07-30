import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationStageItem } from "@popcorn/shared/v1/types";
import { reviewProposalTarget } from "./reviewProposalTarget";

const item = (assetId?: string): GenerationStageItem => ({
  itemId: assetId ?? "opaque-item",
  stageId: "stage-1",
  kind: "video",
  purpose: "shot",
  label: assetId ? "Selected output" : "Opaque output",
  status: "succeeded",
  assetId,
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
});

test("review proposal targets stable project documents and graph objects", () => {
  assert.deepEqual(
    reviewProposalTarget({ stageType: "brief_intake", runId: "run-1" }),
    { scope: "concept", runId: "run-1", label: "Concept" }
  );
  assert.deepEqual(
    reviewProposalTarget({ stageType: "creative_plan", runId: "run-1" }),
    { scope: "brief", runId: "run-1", label: "Brief" }
  );
  assert.deepEqual(
    reviewProposalTarget({
      stageType: "storyboard",
      runId: "run-1",
      storyboardId: "storyboard-1",
    }),
    {
      scope: "board",
      runId: "run-1",
      storyboardId: "storyboard-1",
      label: "Storyboard",
    }
  );
  assert.deepEqual(
    reviewProposalTarget({
      stageType: "audio_generation",
      runId: "run-1",
      items: [item("asset-1")],
    }),
    {
      scope: "asset",
      runId: "run-1",
      assetId: "asset-1",
      label: "Selected output",
    }
  );
});

test("review proposal targets fail closed for ambiguous or opaque checkpoints", () => {
  assert.equal(
    reviewProposalTarget({
      stageType: "quality_review",
      items: [item("asset-1"), item("asset-2")],
    }),
    null
  );
  assert.equal(
    reviewProposalTarget({
      stageType: "audio_generation",
      items: [item()],
    }),
    null
  );
  assert.equal(reviewProposalTarget({ stageType: "quality_review" }), null);
});
