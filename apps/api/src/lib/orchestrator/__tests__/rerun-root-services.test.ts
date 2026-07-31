import assert from "node:assert/strict";
import test from "node:test";
import {
  existingRootResult,
  preserveStablePlanIds,
  validateStableTarget,
} from "../rerun-root-services";

test("pooled root replay returns the action-scoped measured cost", async () => {
  const result = await existingRootResult(
    {
      workspaceId: "workspace-1",
      projectId: "project-1",
      assetId: "asset-1",
      kind: "composite",
      role: "timeline",
      primitiveActionId: "action-1",
    },
    {
      getSnapshot: async () => ({
        id: "asset-1",
        kind: "composite",
        role: "timeline",
        content: {},
        contentHash: "hash-1",
      }),
      sumCost: async (actionId) => {
        assert.equal(actionId, "action-1");
        return 0.073;
      },
    }
  );

  assert.deepEqual(result, {
    assetId: "asset-1",
    intrinsicRole: "timeline",
    actualCostUsd: 0.073,
  });
});

test("story revisions preserve explicit identities across removal and reorder", () => {
  const source = {
    targetLengthSec: 8,
    style: "cinematic",
    aspectRatio: "16:9" as const,
    scenes: [{
      id: "scene-a",
      name: "Opening",
      beats: [
        { id: "beat-a", name: "First", intent: "First", durationSec: 4 },
        { id: "beat-b", name: "Second", intent: "Second", durationSec: 4 },
      ],
    }],
  };
  const revised = {
    ...source,
    scenes: [{
      ...source.scenes[0]!,
      beats: [
        { id: "beat-b", name: "Second", intent: "Revised second", durationSec: 5 },
        { id: "new:ending", name: "New", intent: "New ending", durationSec: 3 },
      ],
    }],
  };

  const result = preserveStablePlanIds(source, revised);
  assert.equal(result.scenes[0]?.beats[0]?.id, "beat-b");
  assert.match(result.scenes[0]?.beats[1]?.id ?? "", /^beat_new_[a-f0-9]{16}$/);
});

test("story revisions reject unknown identities without an explicit new marker", () => {
  const source = {
    targetLengthSec: 8,
    style: "cinematic",
    aspectRatio: "16:9" as const,
    scenes: [{
      id: "scene-a",
      name: "Opening",
      beats: [{ id: "beat-a", name: "First", intent: "First", durationSec: 8 }],
    }],
  };
  assert.throws(
    () => preserveStablePlanIds(source, {
      ...source,
      scenes: [{
        ...source.scenes[0]!,
        beats: [{
          id: "beat-invented",
          name: "Replacement",
          intent: "Replacement",
          durationSec: 8,
        }],
      }],
    }),
    /unknown beat identity/
  );
});

test("story revisions reject deletion of the requested stable target", () => {
  const plan = {
    targetLengthSec: 4,
    style: "cinematic",
    aspectRatio: "16:9" as const,
    scenes: [{
      id: "scene-a",
      name: "Opening",
      beats: [{ id: "beat-b", name: "Second", intent: "Second", durationSec: 4 }],
    }],
  };
  assert.throws(
    () => validateStableTarget(plan, {
      binding: {
        bindingId: "story-binding",
        workItemId: "story-work",
        target: {
          kind: "beat",
          projectId: "project-1",
          beatId: "beat-a",
        },
        kind: "story_snapshot",
        role: "beat_snapshot",
        ordinal: 0,
      },
    }),
    /did not preserve the requested beat identity/
  );
});

test("story revisions reject duplicate stable identities", () => {
  const source = {
    targetLengthSec: 8,
    style: "cinematic",
    aspectRatio: "16:9" as const,
    scenes: [{
      id: "scene-a",
      name: "Opening",
      beats: [{ id: "beat-a", name: "First", intent: "First", durationSec: 8 }],
    }],
  };
  assert.throws(
    () => preserveStablePlanIds(source, {
      ...source,
      scenes: [{
        ...source.scenes[0]!,
        beats: [source.scenes[0]!.beats[0]!, source.scenes[0]!.beats[0]!],
      }],
    }),
    /duplicate beat identity/
  );
});
