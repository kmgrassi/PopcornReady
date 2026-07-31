import assert from "node:assert/strict";
import test from "node:test";
import type {
  BoundRequiredOutput,
  RerunProposalV2,
  RerunTarget,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import type { DispatchDomainRunInput } from "../domain-run-service";
import {
  createVideoRerunExecutors,
  VIDEO_BEAT_CLIP_RERUN_EXECUTOR_ID,
  VIDEO_EDIT_RERUN_EXECUTOR_ID,
  VIDEO_STANDALONE_RERUN_EXECUTOR_ID,
} from "../rerun-video-executor";
import {
  type RerunExecutorContext,
} from "../rerun-executor-registry";
import { productionRerunExecutorRegistry } from "../rerun-production-registry";

const projectTarget = {
  kind: "project" as const,
  projectId: "project-1",
};
const beatTarget = {
  kind: "beat" as const,
  projectId: "project-1",
  beatId: "beat-3",
};
const assetTarget = {
  kind: "asset" as const,
  projectId: "project-1",
  assetId: "source-video-1",
};

function visualsWork(
  target: RerunTarget,
  role: string
): Extract<RerunWorkItem, { owner: "visuals" }> {
  return {
    workItemId: "work-video",
    owner: "visuals",
    kind: "revise_visuals",
    targets: [target],
    requiredOutputs: [{
      bindingId: `binding-${role}`,
      workItemId: "work-video",
      target,
      kind: "clip",
      role,
      ordinal: 0,
    }],
  };
}

function proposal(
  workItem: Extract<RerunWorkItem, { owner: "visuals" }>
): Extract<RerunProposalV2, { outcome: "revision" }> {
  return {
    schemaVersion: "RerunProposal.v2",
    projectId: "project-1",
    rootRunId: "root-1",
    source: "request_changes",
    userIntent: "Revise only the approved video target.",
    targets: workItem.targets,
    inspectedAssetIds: ["source-video-1", "keyframe-3"],
    candidateAffectedAssetIds: ["cut-1"],
    preservedAssetIds: ["source-video-1", "keyframe-3"],
    checklist: workItem.targets.map((target) => ({
      target,
      decision: "change" as const,
      reason: "Requested video change.",
    })),
    pins: {
      assets: [
        {
          assetId: "source-video-1",
          contentHash: "source-hash",
          inputsFingerprint: "source-inputs",
        },
        {
          assetId: "keyframe-3",
          contentHash: "keyframe-hash",
          inputsFingerprint: "keyframe-inputs",
        },
      ],
      selections: [{
        slotOwnerLineageId: null,
        slotRole: "beat_keyframe:beat-3",
        expectedActiveAssetId: "keyframe-3",
        expectedSeq: 7,
      }],
      storySnapshots: [{
        rowKind: "story_beat",
        rowId: "beat-3",
        expectedSnapshotAssetId: "beat-snapshot-3",
      }],
    },
    estimate: { costUsd: 1.2, maxCostUsd: 2, latencyClass: "media" },
    risk: "medium",
    requiresApproval: true,
    rationale: "Only one video output changes.",
    userFacingSummary: "Revise one video output.",
    outcome: "revision",
    selectedWork: [workItem],
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
  };
}

function context(
  workItem: Extract<RerunWorkItem, { owner: "visuals" }>,
  requiredOutputs: readonly BoundRequiredOutput[] = workItem.requiredOutputs
): RerunExecutorContext {
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    actorId: "actor-1",
    proposalActionId: "proposal-1",
    approvalActionId: "approval-1",
    approvalFingerprint: "approval-fingerprint",
    approvedMaxCostUsd: 2,
    rootRunId: "root-1",
    proposal: proposal(workItem),
    workItem,
    requiredOutputs,
    completedBindings: [],
    resolveCompletedBindings: async () => [],
    reserveBudget: async () => {
      throw new Error("bounded child providers own budget admission");
    },
    fence: {
      executionReservationId: "execution-1",
      workReservationId: "work-reservation-1",
      dispatchActionId: "dispatch-1",
      idempotencyKey: "execution-1:work-video:video",
      leaseToken: "lease-1",
      leaseGeneration: 1,
      callbackToken: "callback-1",
      callbackGeneration: 4,
    },
  } as RerunExecutorContext;
}

function dispatchHarness() {
  const calls: DispatchDomainRunInput[] = [];
  return {
    calls,
    dispatch: async (input: DispatchDomainRunInput) => {
      calls.push(input);
      return {
        runId: "visuals-child-1",
        sessionId: "visuals-session-1",
        sessionSequence: 1,
        created: calls.length === 1,
        gateId: null,
        dispatchEnqueued: true,
      };
    },
  };
}

for (const example of [
  {
    name: "beat clip",
    executorId: VIDEO_BEAT_CLIP_RERUN_EXECUTOR_ID,
    target: beatTarget,
    role: "beat_clip",
  },
  {
    name: "content-aware edit",
    executorId: VIDEO_EDIT_RERUN_EXECUTOR_ID,
    target: assetTarget,
    role: "edited_clip",
  },
  {
    name: "standalone video",
    executorId: VIDEO_STANDALONE_RERUN_EXECUTOR_ID,
    target: projectTarget,
    role: "primary_video",
  },
] as const) {
  test(`${example.name} dispatches one bounded Visuals child with exact rerun causation`, async () => {
    const workItem = visualsWork(example.target, example.role);
    const harness = dispatchHarness();
    const executor = createVideoRerunExecutors({
      dispatch: harness.dispatch,
    }).find((candidate) => candidate.id === example.executorId)!;

    const result = await executor.execute(context(workItem));

    assert.deepEqual(result, {
      status: "accepted",
      childRunId: "visuals-child-1",
      jobIds: ["domain-run:visuals-child-1"],
      primitiveActionIds: [],
      budgetReservationKeys: [],
    });
    assert.equal(harness.calls.length, 1);
    const dispatch = harness.calls[0]!;
    assert.equal(dispatch.domain, "visuals");
    assert.equal(dispatch.task.taskKind, "visuals_revision");
    assert.deepEqual(dispatch.task.targets, [example.target]);
    assert.deepEqual(
      dispatch.task.requiredOutputs.map((output) => ({
        bindingId: output.bindingId,
        target: output.target,
        kind: output.kind,
        role: output.role,
      })),
      [{
        bindingId: `binding-${example.role}`,
        target: example.target,
        kind: "clip",
        role: example.role,
      }]
    );
    assert.deepEqual(
      dispatch.task.approvalContext?.rerunCallback,
      {
        executorId: example.executorId,
        workItemId: "work-video",
        generation: 4,
      }
    );
    assert.equal(
      dispatch.task.approvalContext?.approvalFingerprint,
      "approval-fingerprint"
    );
    assert.equal(
      dispatch.origin.kind === "creative_director"
        ? dispatch.origin.rootActionId
        : null,
      "dispatch-1"
    );
    assert.equal(dispatch.idempotencyKey, "execution-1:work-video:video");
    assert.deepEqual(dispatch.pins, {
      proposalActionId: "proposal-1",
      executionReservationId: "execution-1",
      assets: context(workItem).proposal.pins.assets,
      selections: context(workItem).proposal.pins.selections,
      storySnapshots: context(workItem).proposal.pins.storySnapshots,
    });
  });
}

test("executor dispatches only the lifecycle-assigned output subset", async () => {
  const workItem = visualsWork(beatTarget, "beat_clip");
  const second = {
    ...workItem.requiredOutputs[0]!,
    bindingId: "binding-primary-video",
    target: projectTarget,
    role: "primary_video",
    ordinal: 1,
  };
  workItem.requiredOutputs.push(second);
  workItem.targets.push(projectTarget);
  const harness = dispatchHarness();
  const executor = createVideoRerunExecutors({
    dispatch: harness.dispatch,
  }).find((candidate) => candidate.id === VIDEO_BEAT_CLIP_RERUN_EXECUTOR_ID)!;

  await executor.execute(context(workItem, [workItem.requiredOutputs[0]!]));

  assert.deepEqual(
    harness.calls[0]?.task.requiredOutputs.map((output) => output.bindingId),
    ["binding-beat_clip"]
  );
  assert.deepEqual(harness.calls[0]?.task.targets, [beatTarget]);
});

test("semantic target mismatches block before child dispatch", async () => {
  const workItem = visualsWork(assetTarget, "edited_clip");
  const harness = dispatchHarness();
  const beatExecutor = createVideoRerunExecutors({
    dispatch: harness.dispatch,
  }).find((candidate) => candidate.id === VIDEO_BEAT_CLIP_RERUN_EXECUTOR_ID)!;

  const result = await beatExecutor.execute(context(workItem));

  assert.equal(result.status, "blocked");
  assert.equal(
    result.status === "blocked" ? result.precondition.kind : "",
    "root_target_resolution"
  );
  assert.deepEqual(harness.calls, []);
});

test("missing approval fingerprint fails before child dispatch", async () => {
  const workItem = visualsWork(beatTarget, "beat_clip");
  const harness = dispatchHarness();
  const executor = createVideoRerunExecutors({
    dispatch: harness.dispatch,
  }).find((candidate) => candidate.id === VIDEO_BEAT_CLIP_RERUN_EXECUTOR_ID)!;
  const executionContext = context(workItem) as RerunExecutorContext & {
    approvalFingerprint?: string;
  };
  delete executionContext.approvalFingerprint;

  await assert.rejects(
    executor.execute(executionContext),
    (error: unknown) =>
      error instanceof ApiError && error.code === "validation_failed"
  );
  assert.deepEqual(harness.calls, []);
});

test("retry reuses the exact child dispatch identity with production coverage active", async () => {
  const workItem = visualsWork(projectTarget, "primary_video");
  const harness = dispatchHarness();
  const executor = createVideoRerunExecutors({
    dispatch: harness.dispatch,
  }).find((candidate) => candidate.id === VIDEO_STANDALONE_RERUN_EXECUTOR_ID)!;
  const executionContext = context(workItem);

  await executor.execute(executionContext);
  await executor.execute(executionContext);

  assert.deepEqual(
    harness.calls.map((call) => call.idempotencyKey),
    [
      "execution-1:work-video:video",
      "execution-1:work-video:video",
    ]
  );
  assert.doesNotThrow(() => productionRerunExecutorRegistry.preflight([workItem]));
});
