import assert from "node:assert/strict";
import test from "node:test";
import type { CreateActionInput } from "@/lib/api/v1/store-types";
import { createRerunProposal } from "../rerun-proposal-service";

test("creates an approval-gated immutable image proposal and preserves downstream candidates", async () => {
  let persisted: CreateActionInput | undefined;
  const result = await createRerunProposal({
    workspaceId: "workspace-1", projectId: "project-1", assetId: "image-1", message: "make it warmer",
  }, {
    getStaleCandidates: async () => ({
      changedAsset: { assetId: "image-1", ref: "asset:image-1", kind: "image", contentHash: "hash-1" },
      candidates: [{
        assetId: "clip-1", depth: 1, ref: "asset:clip-1", kind: "clip", status: "ready", role: "clip",
        lineageId: "lineage-1", version: 1, contentHash: "hash-clip", inputsFingerprint: "inputs-1",
        selections: [{ slotOwnerLineageId: "beat-1", slotRole: "clip", seq: 4 }],
      }],
    }),
    listAssetSelectionRefs: async () => [{ slotOwnerLineageId: "beat-0", slotRole: "keyframe", seq: 2 }],
    createAction: async (input) => {
      persisted = input;
      return { id: "proposal-1" } as never;
    },
  });
  assert.equal(result.actionId, "proposal-1");
  assert.equal(result.proposal.requiresApproval, true);
  assert.equal(result.proposal.executable, false);
  assert.equal(result.proposal.hasImmutableRegenerationCoverage, true);
  assert.deepEqual(result.proposal.selectedAssetIds, ["image-1"]);
  assert.deepEqual(result.proposal.unchangedAssetIds, ["clip-1"]);
  assert.deepEqual(result.proposal.pins.selections, [{
    slotOwnerLineageId: "beat-0", slotRole: "keyframe", activeAssetId: "image-1", seq: 2,
  }, {
    slotOwnerLineageId: "beat-1", slotRole: "clip", activeAssetId: "clip-1", seq: 4,
  }]);
  assert.equal(persisted?.tool, "rerun_proposal");
  assert.equal(persisted?.status, "proposed");
});

test("does not claim an execution path for a kind without immutable coverage", async () => {
  const result = await createRerunProposal({
    workspaceId: "workspace-1", projectId: "project-1", assetId: "audio-1", message: "shorten it",
  }, {
    getStaleCandidates: async () => ({
      changedAsset: { assetId: "audio-1", ref: null, kind: "audio_track", contentHash: "hash-audio" }, candidates: [],
    }),
    listAssetSelectionRefs: async () => [],
    createAction: async () => ({ id: "proposal-2" } as never),
  });
  assert.equal(result.proposal.executable, false);
  assert.equal(result.proposal.hasImmutableRegenerationCoverage, false);
  assert.deepEqual(result.proposal.unavailableKinds, ["audio_track"]);
  assert.deepEqual(result.proposal.selectedAssetIds, []);
});

test("keeps keyframes and anchors unavailable until their immutable paths ship", async () => {
  for (const kind of ["keyframe", "anchor"]) {
    const result = await createRerunProposal({ workspaceId: "workspace-1", projectId: "project-1", assetId: `${kind}-1`, message: "warmer" }, {
      getStaleCandidates: async () => ({ changedAsset: { assetId: `${kind}-1`, ref: null, kind, contentHash: "hash" }, candidates: [] }),
      listAssetSelectionRefs: async () => [],
      createAction: async () => ({ id: `proposal-${kind}` } as never),
    });
    assert.equal(result.proposal.hasImmutableRegenerationCoverage, false);
    assert.deepEqual(result.proposal.selectedAssetIds, []);
    assert.deepEqual(result.proposal.unavailableKinds, [kind]);
  }
});
