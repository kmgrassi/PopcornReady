import assert from "node:assert/strict";
import test from "node:test";
import type { RerunProposalV2 } from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import {
  resolveRerunGraphMoves,
  type DurableRerunBinding,
} from "../rerun-graph-application";

const projectId = "00000000-0000-4000-8000-000000000001";
const oldImage = "00000000-0000-4000-8000-000000000002";
const newImage = "00000000-0000-4000-8000-000000000003";
const oldStory = "00000000-0000-4000-8000-000000000004";
const newStory = "00000000-0000-4000-8000-000000000005";

function proposal(): Extract<RerunProposalV2, { outcome: "revision" }> {
  const imageTarget = {
    kind: "selection" as const,
    projectId,
    slotOwnerLineageId: null,
    slotRole: "poster",
  };
  const storyTarget = { kind: "beat" as const, projectId, beatId: "beat-1" };
  return {
    schemaVersion: "RerunProposal.v2",
    projectId,
    rootRunId: null,
    source: "request_changes",
    userIntent: "Revise the poster and story beat.",
    targets: [imageTarget, storyTarget],
    inspectedAssetIds: [oldImage, oldStory],
    candidateAffectedAssetIds: [],
    preservedAssetIds: [],
    checklist: [],
    pins: {
      assets: [],
      selections: [{
        slotOwnerLineageId: null,
        slotRole: "poster",
        expectedActiveAssetId: oldImage,
        expectedSeq: 4,
      }],
      storySnapshots: [{
        rowKind: "story_beat",
        rowId: "beat-1",
        expectedSnapshotAssetId: oldStory,
      }],
    },
    estimate: { costUsd: 0, maxCostUsd: 0, latencyClass: "interactive" },
    risk: "low",
    requiresApproval: true,
    rationale: "Requested revision.",
    userFacingSummary: "Revise exact approved targets.",
    outcome: "revision",
    selectedWork: [{
      workItemId: "visual-work",
      owner: "visuals",
      kind: "revise_visuals",
      targets: [imageTarget],
      requiredOutputs: [{
        bindingId: "image-binding",
        workItemId: "visual-work",
        target: imageTarget,
        kind: "poster",
        role: "poster",
        ordinal: 0,
      }],
    }, {
      workItemId: "story-work",
      owner: "creative_director",
      kind: "revise_story",
      targets: [storyTarget],
      requiredOutputs: [{
        bindingId: "story-binding",
        workItemId: "story-work",
        target: storyTarget,
        kind: "story_snapshot",
        role: "story_beat",
        ordinal: 0,
      }],
    }],
    plannedSelectionMoves: [{
      bindingId: "image-binding",
      slotOwnerLineageId: null,
      slotRole: "poster",
      expectedActiveAssetId: oldImage,
      expectedSeq: 4,
    }],
    plannedStoryPointerMoves: [{
      bindingId: "story-binding",
      rowKind: "story_beat",
      rowId: "beat-1",
      expectedSnapshotAssetId: oldStory,
    }],
  };
}

function bindings(): DurableRerunBinding[] {
  return [{
    bindingId: "image-binding",
    workItemId: "visual-work",
    role: "poster",
    intrinsicRole: "poster",
    assetId: newImage,
  }, {
    bindingId: "story-binding",
    workItemId: "story-work",
    role: "story_beat",
    intrinsicRole: "story_beat",
    assetId: newStory,
  }];
}

test("resolves the complete approved move set from durable binding results", () => {
  assert.deepEqual(resolveRerunGraphMoves(proposal(), bindings()), {
    selections: [{
      bindingId: "image-binding",
      slotOwnerLineageId: null,
      slotRole: "poster",
      expectedActiveAssetId: oldImage,
      expectedSeq: 4,
      activeAssetId: newImage,
    }],
    storyPointers: [{
      bindingId: "story-binding",
      rowKind: "story_beat",
      rowId: "beat-1",
      expectedSnapshotAssetId: oldStory,
      snapshotAssetId: newStory,
    }],
  });
});

test("rejects incomplete, duplicate, or role-drifted durable results", () => {
  const cases: DurableRerunBinding[][] = [
    bindings().slice(0, 1),
    [...bindings(), bindings()[0]!],
    bindings().map((binding) =>
      binding.bindingId === "image-binding"
        ? { ...binding, intrinsicRole: "unapproved-role" }
        : binding),
  ];
  for (const durable of cases) {
    assert.throws(
      () => resolveRerunGraphMoves(proposal(), durable),
      (error: unknown) =>
        error instanceof ApiError && error.code === "validation_failed"
    );
  }
});

test("rejects duplicate destinations before any database mutation", () => {
  const value = proposal();
  value.plannedSelectionMoves.push({ ...value.plannedSelectionMoves[0]! });
  assert.throws(
    () => resolveRerunGraphMoves(value, bindings()),
    (error: unknown) =>
      error instanceof ApiError && error.code === "validation_failed"
  );
});
