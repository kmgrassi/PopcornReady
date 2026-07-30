import assert from "node:assert/strict";
import test from "node:test";
import type {
  DomainReportV1,
  DomainTaskV1,
} from "@popcorn/shared/domain-agent-contract";
import type {
  RerunProposalV2,
  RerunTarget,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import type { DomainRunRecord } from "@/lib/api/v1/domain-session-store";
import {
  type DispatchDomainRunInput,
  recordProposalExecutorCallback,
} from "../domain-run-service";
import {
  createAudioRerunExecutors,
} from "../rerun-audio-executors";
import {
  AUDIO_FIT_RERUN_EXECUTOR_ID,
  AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
  rerunChildBudgetReservationKey,
  rerunExecutorCallbackToken,
} from "../rerun-callback-fence";
import {
  productionRerunExecutorRegistry,
  type RerunExecutorContext,
} from "../rerun-executor-registry";

const projectTarget = {
  kind: "project" as const,
  projectId: "project-1",
};
const beatTarget = {
  kind: "beat" as const,
  projectId: "project-1",
  beatId: "beat-1",
};

function proposal(workItem: RerunWorkItem): Extract<
  RerunProposalV2,
  { outcome: "revision" }
> {
  return {
    schemaVersion: "RerunProposal.v2",
    projectId: "project-1",
    rootRunId: "root-1",
    source: "request_changes",
    userIntent: "Make the narration warmer without changing the picture.",
    targets: workItem.targets,
    inspectedAssetIds: ["script-1", "clip-1"],
    candidateAffectedAssetIds: ["cut-1"],
    preservedAssetIds: ["clip-1"],
    checklist: workItem.targets.map((target) => ({
      target,
      decision: "change" as const,
      reason: "Requested Audio change.",
    })),
    pins: {
      assets: [
        {
          assetId: "script-1",
          contentHash: "script-hash",
          inputsFingerprint: "script-inputs",
        },
        {
          assetId: "clip-1",
          contentHash: "clip-hash",
          inputsFingerprint: "clip-inputs",
        },
      ],
      selections: [{
        slotOwnerLineageId: null,
        slotRole: "voiceover:beat-1",
        expectedActiveAssetId: null,
        expectedSeq: 0,
      }],
      storySnapshots: [],
    },
    estimate: { costUsd: 0.8, maxCostUsd: 1, latencyClass: "media" },
    risk: "medium",
    requiresApproval: true,
    rationale: "Only Audio needs work.",
    userFacingSummary: "Revise one narration segment.",
    outcome: "revision",
    selectedWork: [workItem],
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
  };
}

function audioWork(
  kind: "audio_track" | "audio_fit" = "audio_track",
  target: RerunTarget = beatTarget
): Extract<RerunWorkItem, { owner: "audio" }> {
  return {
    workItemId: "work-audio",
    owner: "audio",
    kind: "revise_audio",
    targets: [target],
    requiredOutputs: [{
      bindingId: `binding-${kind}`,
      workItemId: "work-audio",
      target,
      kind,
      role: kind === "audio_fit" ? "fit:beat-1" : "voiceover:beat-1",
      ordinal: 0,
    }],
  };
}

function context(
  workItem: Extract<RerunWorkItem, { owner: "audio" }>
): RerunExecutorContext {
  const rerunProposal = proposal(workItem);
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    actorId: "actor-1",
    proposalActionId: "proposal-1",
    approvalActionId: "approval-1",
    approvalFingerprint: "approval-fingerprint",
    approvedMaxCostUsd: 1,
    rootRunId: "root-1",
    proposal: rerunProposal,
    workItem,
    requiredOutputs: workItem.requiredOutputs,
    completedBindings: [],
    resolveCompletedBindings: async () => [],
    reserveBudget: async () => ({
      reservationId: "child-budget-1",
      replayed: false,
    }),
    fence: {
      executionReservationId: "execution-1",
      workReservationId: "work-reservation-1",
      dispatchActionId: "dispatch-1",
      idempotencyKey: "execution-1:work-audio:audio-production",
      leaseToken: "lease-1",
      leaseGeneration: 1,
      callbackToken: "callback-1",
      callbackGeneration: 1,
    },
  };
}

test("Audio production dispatch keeps exact proposal scope and remains inactive in production", async () => {
  const workItem = audioWork();
  const dispatches: DispatchDomainRunInput[] = [];
  const reserves: Array<{ reservationKey: string; estimatedUsd: number }> = [];
  const executors = createAudioRerunExecutors({
    dispatch: async (input) => {
      dispatches.push(input);
      return {
        runId: "audio-child-1",
        sessionId: "audio-session-1",
        sessionSequence: 1,
        created: true,
        gateId: null,
        dispatchEnqueued: true,
      };
    },
  });
  const executor = executors.find(
    (candidate) => candidate.id === AUDIO_PRODUCTION_RERUN_EXECUTOR_ID
  )!;
  const executionContext: RerunExecutorContext = {
    ...context(workItem),
    reserveBudget: async (input) => {
      reserves.push(input);
      return { reservationId: "child-budget-1", replayed: false };
    },
  };
  const result = await executor.execute(executionContext);

  assert.equal(result.status, "accepted");
  assert.deepEqual(result.status === "accepted" ? result.jobIds : [], [
    "domain-run:audio-child-1",
  ]);
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0]?.domain, "audio");
  assert.equal(dispatches[0]?.task.taskKind, "audio_production");
  assert.deepEqual(dispatches[0]?.task.targets, [beatTarget]);
  assert.equal(
    dispatches[0]?.task.approvalContext?.rerunCallback?.executorId,
    AUDIO_PRODUCTION_RERUN_EXECUTOR_ID
  );
  assert.deepEqual(
    dispatches[0]?.task.approvalContext?.rerunCallback?.budgetReservationKeys,
    [rerunChildBudgetReservationKey({
      executionReservationId: "execution-1",
      workItemId: "work-audio",
      executorId: AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
    })]
  );
  assert.deepEqual(reserves.map((entry) => entry.estimatedUsd), [1]);
  assert.throws(
    () => productionRerunExecutorRegistry.preflight([workItem]),
    (error: unknown) =>
      error instanceof ApiError && error.code === "coverage_unavailable"
  );
});

test("unsupported Audio semantic targets block back to the Creative Director", async () => {
  const sceneTarget = {
    kind: "scene" as const,
    projectId: "project-1",
    sceneId: "scene-1",
  };
  const workItem = audioWork("audio_fit", sceneTarget);
  let dispatched = false;
  const executor = createAudioRerunExecutors({
    dispatch: async () => {
      dispatched = true;
      throw new Error("must not dispatch");
    },
  }).find((candidate) => candidate.id === AUDIO_FIT_RERUN_EXECUTOR_ID)!;

  const result = await executor.execute(context(workItem));
  assert.equal(result.status, "blocked");
  assert.equal(
    result.status === "blocked" ? result.precondition.kind : "",
    "root_target_resolution"
  );
  assert.equal(dispatched, false);
});

test("picture fit requires an exact beat even when the generic target is otherwise supported", async () => {
  const workItem = audioWork("audio_fit", projectTarget);
  let dispatched = false;
  const executor = createAudioRerunExecutors({
    dispatch: async () => {
      dispatched = true;
      throw new Error("must not dispatch");
    },
  }).find((candidate) => candidate.id === AUDIO_FIT_RERUN_EXECUTOR_ID)!;

  const result = await executor.execute(context(workItem));
  assert.equal(result.status, "blocked");
  assert.match(
    result.status === "blocked" ? result.precondition.message : "",
    /exact beat/
  );
  assert.equal(dispatched, false);
});

test("terminal bound Audio report records the exact fenced lifecycle callback", async () => {
  const workItem = audioWork();
  const executionContext = context(workItem);
  const requiredOutput = {
    ...workItem.requiredOutputs[0]!,
    kind: "audio_track" as const,
    minimumCount: 1,
  };
  const task = {
    schemaVersion: "DomainTask.v1",
    domain: "audio",
    taskKind: "audio_production",
    objective: "Revise one narration segment.",
    instruction: "Warmer delivery.",
    targets: [beatTarget],
    requiredOutputs: [requiredOutput],
    allowedOutputKinds: ["audio_track"],
    creativeConstraints: {},
    preserve: {
      assetIds: ["clip-1"],
      selections: [],
      fingerprints: [],
      pins: [],
    },
    candidateAffectedAssetIds: [],
    budgetUsd: 1,
    approvalContext: {
      proposalActionId: "proposal-1" as never,
      approvalActionId: "approval-1" as never,
      executionReservationId: "execution-1",
      approvedBudgetUsd: 1,
      approvalFingerprint: "approval-fingerprint",
      rerunCallback: {
        executorId: AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
        workItemId: "work-audio",
        generation: 1,
        budgetReservationKeys: [
          rerunChildBudgetReservationKey({
            executionReservationId: "execution-1",
            workItemId: "work-audio",
            executorId: AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
          }),
        ],
      },
    },
    acceptanceCriteria: ["Warmer delivery."],
    origin: {
      kind: "creative_director",
      rootRunId: "root-1" as never,
      rootActionId: "dispatch-1" as never,
      creatorMessageId: "proposal-1",
    },
    responseRecipient: { kind: "creative_director" },
  } satisfies DomainTaskV1;
  const run = {
    id: "audio-child-1",
    projectId: "project-1",
    taskParams: task,
  } as unknown as DomainRunRecord;
  const output = {
    ...requiredOutput,
    assetId: "audio-new-1",
    intrinsicRole: "voiceover",
  };
  const report: DomainReportV1 = {
    schemaVersion: "DomainReport.v1",
    outcome: {
      outcome: "done",
      outputs: [output],
      changedSelections: [],
      acceptanceEvidence: [{
        criterion: "Warmer delivery.",
        satisfied: true,
        evidence: "Generated one bounded narration alternative.",
        assetIds: ["audio-new-1"],
      }],
      sessionSummary: "One narration alternative is ready.",
    },
  };
  const callbacks: Record<string, unknown>[] = [];

  await recordProposalExecutorCallback({
    projectId: "project-1",
    run,
    reportActionId: "report-1",
    report,
  }, async (input) => {
    callbacks.push(input);
    return false;
  });

  assert.equal(callbacks.length, 1);
  assert.deepEqual(callbacks[0], {
    projectId: "project-1",
    reservationId: "execution-1",
    workItemId: "work-audio",
    executorId: AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
    callbackToken: rerunExecutorCallbackToken({
      executionReservationId: "execution-1",
      workItemId: "work-audio",
      executorId: AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
    }),
    callbackGeneration: 1,
    outcome: "completed",
    result: {
      providerResult: { domainReport: report },
      childRunId: "audio-child-1",
      reportActionId: "report-1",
      primitiveActionIds: [],
      budgetReservationKeys:
        task.approvalContext?.rerunCallback?.budgetReservationKeys,
      outputs: [output],
    },
  });
  assert.equal(executionContext.proposal.selectedWork[0]?.owner, "audio");
});

test("terminal blocked Audio report records a failed callback without outputs", async () => {
  const workItem = audioWork();
  const requiredOutput = {
    ...workItem.requiredOutputs[0]!,
    kind: "audio_track" as const,
    minimumCount: 1,
  };
  const task = {
    schemaVersion: "DomainTask.v1",
    domain: "audio",
    taskKind: "audio_production",
    objective: "Revise one narration segment.",
    instruction: "Warmer delivery.",
    targets: [beatTarget],
    requiredOutputs: [requiredOutput],
    allowedOutputKinds: ["audio_track"],
    creativeConstraints: {},
    preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
    candidateAffectedAssetIds: [],
    budgetUsd: 1,
    approvalContext: {
      proposalActionId: "proposal-1" as never,
      approvalActionId: "approval-1" as never,
      executionReservationId: "execution-1",
      approvedBudgetUsd: 1,
      approvalFingerprint: "approval-fingerprint",
      rerunCallback: {
        executorId: AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
        workItemId: "work-audio",
        generation: 1,
        budgetReservationKeys: [],
      },
    },
    acceptanceCriteria: ["Warmer delivery."],
    origin: {
      kind: "creative_director",
      rootRunId: "root-1" as never,
      rootActionId: "dispatch-1" as never,
      creatorMessageId: "proposal-1",
    },
    responseRecipient: { kind: "creative_director" },
  } satisfies DomainTaskV1;
  const report: DomainReportV1 = {
    schemaVersion: "DomainReport.v1",
    outcome: {
      outcome: "blocked",
      reason: "The source dialogue asset is no longer current.",
      precondition: {
        requirement: "current source dialogue",
        because: "The approved source pin is stale.",
      },
      requiredDomain: "creative_director",
      targets: [beatTarget],
    },
  };
  const callbacks: Record<string, unknown>[] = [];

  await recordProposalExecutorCallback({
    projectId: "project-1",
    run: {
      id: "audio-child-1",
      projectId: "project-1",
      taskParams: task,
    } as unknown as DomainRunRecord,
    reportActionId: "report-1",
    report,
  }, async (input) => {
    callbacks.push(input);
    return false;
  });

  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0]?.outcome, "failed");
  assert.deepEqual(
    (callbacks[0]?.result as { outputs: unknown[] }).outputs,
    []
  );
});

test("a stale child callback loses the fence without failing domain finalization", async () => {
  const workItem = audioWork();
  const requiredOutput = {
    ...workItem.requiredOutputs[0]!,
    kind: "audio_track" as const,
    minimumCount: 1,
  };
  const task = {
    schemaVersion: "DomainTask.v1",
    domain: "audio",
    taskKind: "audio_production",
    objective: "Revise one narration segment.",
    instruction: "Warmer delivery.",
    targets: [beatTarget],
    requiredOutputs: [requiredOutput],
    allowedOutputKinds: ["audio_track"],
    creativeConstraints: {},
    preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
    candidateAffectedAssetIds: [],
    budgetUsd: 1,
    approvalContext: {
      proposalActionId: "proposal-1" as never,
      approvalActionId: "approval-1" as never,
      executionReservationId: "execution-1",
      approvedBudgetUsd: 1,
      approvalFingerprint: "approval-fingerprint",
      rerunCallback: {
        executorId: AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
        workItemId: "work-audio",
        generation: 1,
        budgetReservationKeys: [],
      },
    },
    acceptanceCriteria: ["Warmer delivery."],
    origin: {
      kind: "creative_director",
      rootRunId: "root-1" as never,
      rootActionId: "dispatch-1" as never,
      creatorMessageId: "proposal-1",
    },
    responseRecipient: { kind: "creative_director" },
  } satisfies DomainTaskV1;
  const report: DomainReportV1 = {
    schemaVersion: "DomainReport.v1",
    outcome: {
      outcome: "blocked",
      reason: "Canceled while the provider was finishing.",
      precondition: {
        requirement: "an active execution fence",
        because: "Cancellation advanced the callback generation.",
      },
      requiredDomain: "creative_director",
      targets: [beatTarget],
    },
  };

  await assert.doesNotReject(() =>
    recordProposalExecutorCallback({
      projectId: "project-1",
      run: {
        id: "audio-child-1",
        projectId: "project-1",
        taskParams: task,
      } as unknown as DomainRunRecord,
      reportActionId: "report-1",
      report,
    }, async () => {
      throw new ApiError(
        "idempotency_in_progress",
        "A newer callback generation owns this work."
      );
    })
  );
});
