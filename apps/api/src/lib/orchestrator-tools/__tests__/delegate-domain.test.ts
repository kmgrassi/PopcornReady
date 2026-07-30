import assert from "node:assert/strict";
import test from "node:test";
import type { RerunProposalV2, RerunWorkItem } from "@popcorn/shared/rerun-proposal";

import {
  buildDelegatedTask,
  buildProposalDelegatedTask,
  createDelegateAudioTool,
  createDelegateDomainsTool,
  createDelegateVisualsTool,
} from "../delegate-domain";

test("Visuals delegation requires explicit bounded terminal output kinds", () => {
  const tool = createDelegateVisualsTool();
  assert.throws(() => tool.parseInput({ objective: "Create an anchor plan." }), /requiredOutputKinds/);
  const parsed = tool.parseInput({ objective: "Create an anchor plan.", requiredOutputKinds: ["anchor"] });
  assert.equal(parsed.objective, "Create an anchor plan.");
  assert.deepEqual(parsed.requiredOutputKinds, ["anchor"]);
  assert.throws(
    () => createDelegateVisualsTool().parseInput({ objective: "Audio only.", requiredOutputKinds: [] }),
    /requiredOutputKinds/
  );
});

test("Audio delegation rejects Visuals-only terminal output kinds", () => {
  assert.throws(
    () => createDelegateAudioTool().parseInput({ objective: "Score the cut.", requiredOutputKinds: ["clip"] }),
    /does not accept requiredOutputKinds/
  );
});

test("Visuals delegation derives terminal requirements from the bounded output kinds", () => {
  const task = buildDelegatedTask({
    domain: "visuals",
    projectId: "project-1",
    rootRunId: "root-1",
    rootActionId: "action-1",
    creatorMessageId: "message-1",
    budgetUsd: 5,
    parsed: { objective: "Create the visual anchor plan.", requiredOutputKinds: ["anchor", "image"] },
  });
  assert.equal(task.domain, "visuals");
  assert.deepEqual(task.requiredOutputs, [
    { kind: "anchor", role: "visual_anchor", minimumCount: 1 },
    { kind: "image", role: "image", minimumCount: 1 },
  ]);
  assert.ok(!task.requiredOutputs.some((output) => output.kind === "clip"));
});

test("parallel delegation accepts one independent Visuals and Audio assignment", () => {
  const parsed = createDelegateDomainsTool().parseInput({
    visuals: { objective: "Create the opening clips.", requiredOutputKinds: ["clip"] },
    audio: { objective: "Score the opening." },
  });
  assert.deepEqual(parsed.visuals.requiredOutputKinds, ["clip"]);
  assert.equal(parsed.audio.objective, "Score the opening.");
  assert.throws(
    () => createDelegateDomainsTool().parseInput({ visuals: parsed.visuals }),
    /Delegation input must be an object/
  );
});

test("proposal delegation carries exact scope, bindings, preserves, and approval causation", () => {
  const target = {
    kind: "transcript_segment" as const,
    projectId: "project-1",
    transcriptSegmentId: "segment-1",
  };
  const audioWork: Extract<RerunWorkItem, { owner: "audio" }> = {
    workItemId: "audio-work",
    owner: "audio",
    kind: "revise_audio",
    targets: [target],
    requiredOutputs: [{
      bindingId: "fit-binding",
      workItemId: "audio-work",
      target,
      kind: "audio_fit",
      role: "picture-fit-critique",
      ordinal: 0,
    }],
  };
  const proposal = {
    schemaVersion: "RerunProposal.v2" as const,
    projectId: "project-1",
    rootRunId: "root-1",
    source: "request_changes" as const,
    userIntent: "Shorten the narration.",
    targets: [target],
    inspectedAssetIds: ["audio-1"],
    candidateAffectedAssetIds: ["cut-1"],
    preservedAssetIds: ["music-1"],
    checklist: [{ target, decision: "change" as const, reason: "Shorten it." }],
    pins: {
      assets: [{ assetId: "audio-1", contentHash: "hash", inputsFingerprint: "inputs" }],
      selections: [],
      storySnapshots: [],
    },
    estimate: { costUsd: 1, maxCostUsd: 2, latencyClass: "media" as const },
    risk: "medium" as const,
    requiresApproval: true,
    rationale: "Audio-only revision.",
    userFacingSummary: "Shorten narration and fit it to picture.",
    outcome: "revision" as const,
    selectedWork: [audioWork],
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
  } satisfies RerunProposalV2;
  const task = buildProposalDelegatedTask({
    projectId: "project-1",
    rootRunId: "root-1",
    delegationActionId: "delegation-1",
    creatorMessageId: "message-1",
    proposalActionId: "proposal-1",
    approvalActionId: "approval-1",
    executionReservationId: "execution-1",
    approvalFingerprint: "approval-fingerprint",
    proposal,
    workItem: proposal.selectedWork[0],
  });
  assert.equal(task.domain, "audio");
  assert.equal(task.taskKind, "audio_fit");
  assert.deepEqual(task.targets, [target]);
  assert.deepEqual(task.candidateAffectedAssetIds, ["cut-1"]);
  assert.deepEqual(task.preserve.assetIds, ["music-1"]);
  assert.deepEqual(task.requiredOutputs[0], {
    ...proposal.selectedWork[0].requiredOutputs[0],
    minimumCount: 1,
  });
  assert.equal(task.approvalContext?.approvalActionId, "approval-1");
  assert.equal(task.approvalContext?.executionReservationId, "execution-1");
  assert.equal(task.origin.rootActionId, "delegation-1");
});
