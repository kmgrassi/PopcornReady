import assert from "node:assert/strict";
import test from "node:test";
import type {
  BoundRequiredOutput,
  RerunProposalV2,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import {
  productionRerunExecutorRegistry,
  type RerunExecutorContext,
} from "../rerun-executor-registry";
import {
  createVisualStillRerunExecutor,
  VISUAL_STILL_OUTPUT_KINDS,
} from "../rerun-executors/visual-stills";

const projectId = "project-1";

function output(input: Partial<BoundRequiredOutput> = {}): BoundRequiredOutput {
  return {
    bindingId: "binding-1",
    workItemId: "work-1",
    target: { kind: "asset", projectId, assetId: "keyframe-1" },
    kind: "keyframe",
    role: "beat_keyframe",
    ordinal: 0,
    ...input,
  };
}

function proposal(input: {
  outputs?: BoundRequiredOutput[];
  targets?: RerunWorkItem["targets"];
} = {}): Extract<RerunProposalV2, { outcome: "revision" }> {
  const outputs = input.outputs ?? [output()];
  const targets = input.targets ?? outputs.map((candidate) => candidate.target);
  return {
    schemaVersion: "RerunProposal.v2",
    projectId,
    rootRunId: "root-run-1",
    source: "request_changes",
    userIntent: "Make the exact approved still warmer.",
    targets,
    inspectedAssetIds: ["keyframe-1"],
    candidateAffectedAssetIds: [],
    preservedAssetIds: ["unrelated-upload"],
    checklist: targets.map((target) => ({
      target,
      decision: "change",
      reason: "Requested target.",
    })),
    pins: {
      assets: [{
        assetId: "keyframe-1",
        contentHash: "hash-keyframe-1",
        inputsFingerprint: "inputs-keyframe-1",
      }],
      selections: [{
        slotOwnerLineageId: "beat-lineage-1",
        slotRole: "beat_keyframe:beat-1",
        expectedActiveAssetId: "keyframe-1",
        expectedSeq: 3,
      }],
      storySnapshots: [{
        rowKind: "story_beat",
        rowId: "beat-1",
        expectedSnapshotAssetId: "beat-snapshot-1",
      }],
    },
    estimate: { costUsd: 0.05, maxCostUsd: 0.0625, latencyClass: "media" },
    risk: "low",
    requiresApproval: true,
    rationale: "Revise only the requested still.",
    userFacingSummary: "One still changes.",
    outcome: "revision",
    selectedWork: [{
      workItemId: "work-1",
      owner: "visuals",
      kind: "revise_visuals",
      targets,
      requiredOutputs: outputs,
    }],
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
  };
}

function context(input: {
  proposal?: Extract<RerunProposalV2, { outcome: "revision" }>;
  approvalFingerprint?: string;
  requiredOutputs?: BoundRequiredOutput[];
} = {}): RerunExecutorContext {
  const selectedProposal = input.proposal ?? proposal();
  const workItem = selectedProposal.selectedWork[0]!;
  return {
    workspaceId: "workspace-1",
    projectId,
    actorId: "actor-1",
    proposalActionId: "proposal-action-1",
    approvalActionId: "approval-action-1",
    approvalFingerprint:
      input.approvalFingerprint === undefined
        ? "persisted-approval-fingerprint"
        : input.approvalFingerprint,
    approvedMaxCostUsd: 0.0625,
    rootRunId: "root-run-1",
    proposal: selectedProposal,
    workItem,
    requiredOutputs: input.requiredOutputs ?? workItem.requiredOutputs,
    completedBindings: [],
    resolveCompletedBindings: async () => [],
    reserveBudget: async () => ({
      reservationId: "unused",
      replayed: false,
    }),
    fence: {
      executionReservationId: "execution-1",
      workReservationId: "work-reservation-1",
      dispatchActionId: "dispatch-action-1",
      idempotencyKey: "execution-1:work-1:visual-stills.v1",
      leaseToken: "lease-1",
      leaseGeneration: 1,
      callbackToken: "callback-1",
      callbackGeneration: 4,
    },
  };
}

test("visual still adapter claims only PR 3A kinds while production stays inert", () => {
  const executor = createVisualStillRerunExecutor({ dispatch: async () => {
    throw new Error("not called");
  } });
  for (const kind of VISUAL_STILL_OUTPUT_KINDS) {
    assert.equal(executor.supports(proposal().selectedWork[0]!, output({ kind })), true);
  }
  assert.equal(
    executor.supports(proposal().selectedWork[0]!, output({ kind: "clip" })),
    false
  );
  assert.throws(
    () => productionRerunExecutorRegistry.preflight(proposal().selectedWork),
    (error: unknown) =>
      error instanceof ApiError && error.code === "coverage_unavailable"
  );
});

test("dispatches exact approved still scope with fenced callback metadata", async () => {
  const dispatches: Record<string, unknown>[] = [];
  const executor = createVisualStillRerunExecutor({
    dispatch: async (input) => {
      dispatches.push(input as unknown as Record<string, unknown>);
      return {
        runId: "child-visuals-1",
        sessionId: "session-visuals-1",
        sessionSequence: 1,
        created: true,
        gateId: null,
        dispatchEnqueued: true,
      };
    },
  });
  const result = await executor.execute(context());
  assert.deepEqual(result, {
    status: "accepted",
    childRunId: "child-visuals-1",
    jobIds: ["domain-run:child-visuals-1"],
    primitiveActionIds: [],
    budgetReservationKeys: [],
  });
  assert.equal(dispatches.length, 1);
  const dispatch = dispatches[0]!;
  assert.equal(dispatch.idempotencyKey, "execution-1:work-1:visual-stills.v1");
  assert.equal(dispatch.budgetUsd, 0.0625);
  assert.deepEqual(dispatch.origin, {
    kind: "creative_director",
    parentRunId: "root-run-1",
    rootActionId: "dispatch-action-1",
  });
  const task = dispatch.task as {
    targets: unknown[];
    requiredOutputs: unknown[];
    approvalContext: Record<string, unknown>;
  };
  assert.deepEqual(task.targets, proposal().selectedWork[0]!.targets);
  assert.deepEqual(task.requiredOutputs, [{
    ...output(),
    minimumCount: 1,
  }]);
  assert.equal(
    task.approvalContext.approvalFingerprint,
    "persisted-approval-fingerprint"
  );
  assert.deepEqual(task.approvalContext.rerunCallback, {
    executorId: "visual-stills.v1",
    workItemId: "work-1",
    generation: 4,
  });
  assert.deepEqual(dispatch.pins, {
    proposalActionId: "proposal-action-1",
    executionReservationId: "execution-1",
    assets: proposal().pins.assets,
    selections: proposal().pins.selections,
    storySnapshots: proposal().pins.storySnapshots,
  });
});

test("duplicate execution dispatches one stable child identity", async () => {
  const keys: string[] = [];
  const executor = createVisualStillRerunExecutor({
    dispatch: async (input) => {
      keys.push(input.idempotencyKey);
      return {
        runId: "same-child",
        sessionId: "same-session",
        sessionSequence: 1,
        created: keys.length === 1,
        gateId: null,
        dispatchEnqueued: true,
      };
    },
  });
  const first = await executor.execute(context());
  const replay = await executor.execute(context());
  assert.deepEqual(replay, first);
  assert.deepEqual(keys, [
    "execution-1:work-1:visual-stills.v1",
    "execution-1:work-1:visual-stills.v1",
  ]);
});

test("fails closed without the persisted approval fingerprint", async () => {
  let dispatched = false;
  const executor = createVisualStillRerunExecutor({
    dispatch: async () => {
      dispatched = true;
      throw new Error("must not dispatch");
    },
  });
  await assert.rejects(
    executor.execute(context({ approvalFingerprint: "" })),
    /persisted approval fingerprint/
  );
  assert.equal(dispatched, false);
});

test("blocks unresolved still targets before child dispatch", async () => {
  const unresolved = output({
    target: {
      kind: "timeline_item",
      projectId,
      timelineItemId: "timeline-1",
    },
  });
  let dispatched = false;
  const executor = createVisualStillRerunExecutor({
    dispatch: async () => {
      dispatched = true;
      throw new Error("must not dispatch");
    },
  });
  const result = await executor.execute(context({
    proposal: proposal({ outputs: [unresolved] }),
  }));
  assert.equal(result.status, "blocked");
  assert.equal(dispatched, false);
});

test("a still child cannot inherit sibling video targets from mixed work", async () => {
  const still = output();
  const clip = output({
    bindingId: "binding-clip",
    target: { kind: "project", projectId },
    kind: "clip",
    role: "standalone_video",
    ordinal: 1,
  });
  const mixed = proposal({
    outputs: [still, clip],
    targets: [still.target, clip.target],
  });
  let childTargets: unknown[] = [];
  const executor = createVisualStillRerunExecutor({
    dispatch: async (input) => {
      childTargets = input.task.targets as unknown[];
      return {
        runId: "child-still-only",
        sessionId: "session-still-only",
        sessionSequence: 1,
        created: true,
        gateId: null,
        dispatchEnqueued: true,
      };
    },
  });
  await executor.execute(context({
    proposal: mixed,
    requiredOutputs: [still],
  }));
  assert.deepEqual(childTargets, [still.target]);
});
