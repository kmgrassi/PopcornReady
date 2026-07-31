import assert from "node:assert/strict";
import test from "node:test";

import type {
  RerunProposalV2,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import type { RerunProposalActionRecord } from "@/lib/api/v1/rerun-lifecycle-store";
import { ApiError } from "@/core/errors";
import {
  approveRerunProposal,
  callbackTokenHash,
  cancelRerunProposal,
  executeRerunProposal,
  refreshRerunProposal,
  rejectRerunProposal,
  type RerunLifecycleDeps,
} from "../rerun-lifecycle-service";
import {
  createFakeRerunExecutor,
  RetryableRerunExecutorError,
  RerunExecutorRegistry,
  validateBoundExecutorOutputs,
} from "../rerun-executor-registry";
import { productionRerunExecutorRegistry } from "../rerun-production-registry";

const target = {
  kind: "asset" as const,
  projectId: "project-1",
  assetId: "asset-1",
};

function revisionProposal(source: "request_changes" | "autonomous_review" = "request_changes"):
Extract<RerunProposalV2, { outcome: "revision" }> {
  return {
    schemaVersion: "RerunProposal.v2",
    projectId: "project-1",
    rootRunId: "root-1",
    source,
    userIntent: "Brighten the shot.",
    targets: [target],
    inspectedAssetIds: ["asset-1"],
    candidateAffectedAssetIds: [],
    preservedAssetIds: [],
    checklist: [{ target, decision: "change", reason: "Requested target." }],
    pins: {
      assets: [{
        assetId: "asset-1",
        contentHash: "hash-1",
        inputsFingerprint: "inputs-1",
      }],
      selections: [],
      storySnapshots: [],
    },
    estimate: { costUsd: 0, maxCostUsd: 0, latencyClass: "interactive" },
    risk: "low",
    requiresApproval: source === "request_changes",
    rationale: "Local revision.",
    userFacingSummary: "Brighten one shot.",
    outcome: "revision",
    selectedWork: [{
      workItemId: "work-1",
      owner: "visuals",
      kind: "revise_visuals",
      targets: [target],
      requiredOutputs: [{
        bindingId: "binding-1",
        workItemId: "work-1",
        target,
        kind: "image",
        role: "revised-shot",
        ordinal: 0,
      }],
    }],
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
  };
}

function action(
  proposal: RerunProposalV2 = revisionProposal()
): RerunProposalActionRecord {
  return {
    id: "proposal-1",
    projectId: "project-1",
    rootRunId: "root-1",
    status: "proposed",
    params: {},
    proposal,
    inputAssetIds: ["asset-1"],
    rationale: proposal.rationale,
  };
}

function harness(input: {
  proposal?: RerunProposalV2;
  registry?: RerunExecutorRegistry;
  stale?: boolean;
  reservedWorkStatus?: "reserved" | "running" | "failed" | "canceled";
  callbackResults?: Array<{
    executorId: string;
    status: "completed" | "failed" | "canceled" | "pending";
    jobIds: string[];
    result: {
      outputs?: unknown[];
      primitiveActionIds?: string[];
      budgetReservationKeys?: string[];
    } | null;
  }>;
  appliedFinalizeError?: ApiError;
}) {
  const proposalAction = action(input.proposal);
  let approval: {
    approvalActionId: string;
    approvedMaxCostUsd: number;
    approvalFingerprint: string;
  } | null = null;
  let reservation:
  {
    reservation_id: string;
    budget_reservation_id: string;
    root_run_id: string;
    status: string;
    lease_generation: number;
    execution_result_action_id: string | null;
  } | null = null;
  let dispatches = 0;
  let reserves = 0;
  let approvals = 0;
  let failedWorkItems = 0;
  let finalOutcome: "applied" | "failed" | null = null;
  const finalOutcomes: Array<"applied" | "failed"> = [];
  let parked = 0;
  let lastParked: Parameters<RerunLifecycleDeps["parkWorkItem"]>[0] | null = null;
  let lastCompleted: Parameters<RerunLifecycleDeps["completeWorkItem"]>[0] | null =
    null;
  const deps: RerunLifecycleDeps = {
    authorizeProject: async () => ({}) as never,
    getProposal: async () => proposalAction,
    getSuccessor: async () => null,
    assertAuthority: async () => {},
    approve: async (request) => {
      approvals += 1;
      if (input.stale) {
        proposalAction.status = "failed";
        return {
          proposal_status: "failed",
          approval_action_id: null,
          replayed: false,
          stale: true,
        };
      }
      proposalAction.status = "approved";
      approval = {
        approvalActionId: request.approvalActionId,
        approvedMaxCostUsd: request.approvedMaxCostUsd,
        approvalFingerprint: request.approvalFingerprint,
      };
      return {
        proposal_status: "approved",
        approval_action_id: request.approvalActionId,
        replayed: false,
        stale: false,
      };
    },
    getApproval: async () => approval,
    reject: async () => "rejected",
    createSuccessor: async () => ({
      successor_action_id: "successor-1",
      replayed: false,
    }),
    ensureReconciliation: async (request) => request.reconciliationActionId,
    reserveExecution: async (request) => {
      reserves += 1;
      if (reservation) {
        return { ...reservation, replayed: true };
      }
      reservation = {
        reservation_id: "reservation-1",
        budget_reservation_id: "budget-1",
        root_run_id: "root-1",
        status: "reserved",
        lease_generation: 0,
        execution_result_action_id: null,
      };
      return { ...reservation, replayed: false };
    },
    claimExecution: async () => {
      if (
        !reservation ||
        !["reserved", "waiting"].includes(reservation.status)
      ) {
        throw new ApiError("idempotency_in_progress", "leased");
      }
      reservation.status = "running";
      reservation.lease_generation += 1;
      return {
        reservationId: "reservation-1",
        leaseToken: "lease-1",
        leaseGeneration: reservation.lease_generation,
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    },
    renewExecution: async ({ lease }) => lease,
    reserveWorkItem: async () => ({
      work_reservation_id: "work-reservation-1",
      work_status: input.reservedWorkStatus ?? "reserved",
      child_run_id: null,
      report_action_id: null,
      reconciliation_action_id: null,
      binding_results: null,
      primitive_action_ids: [],
      budget_reservation_keys: [],
      callback_results: input.callbackResults ?? [],
      replayed: dispatches > 0,
    }),
    completeWorkItem: async (request) => { lastCompleted = request; },
    parkWorkItem: async (request) => {
      parked += 1;
      lastParked = request;
    },
    parkExecution: async () => {
      reservation!.status = "waiting";
    },
    failWorkItem: async () => {
      failedWorkItems += 1;
    },
    reserveChildBudget: async () => ({ reservationId: "child-budget-1", replayed: false }),
    listCompletedBindings: async () => [],
    finalizeExecution: async (request) => {
      finalOutcomes.push(request.outcome);
      if (request.outcome === "applied" && input.appliedFinalizeError) {
        throw input.appliedFinalizeError;
      }
      finalOutcome = request.outcome;
      reservation!.status = "completed";
      proposalAction.status = "applied";
      return "execution-action-1";
    },
    cancelExecution: async () => ({
      executionActionId: "execution-action-canceled",
      status: "failed",
      canceled: true,
    }),
    createProposal: (async () => {
      throw new Error("not used");
    }) as RerunLifecycleDeps["createProposal"],
    registry: input.registry ?? new RerunExecutorRegistry(),
  };
  return {
    deps,
    get dispatches() { return dispatches; },
    incrementDispatch() { dispatches += 1; },
    get reserves() { return reserves; },
    get approvals() { return approvals; },
    get failedWorkItems() { return failedWorkItems; },
    get finalOutcome() { return finalOutcome; },
    get finalOutcomes() { return finalOutcomes; },
    get parked() { return parked; },
    get lastParked() { return lastParked; },
    get lastCompleted() { return lastCompleted; },
  };
}

test("production coverage fails before approval, reservation, or spend", async () => {
  const state = harness({});
  await assert.rejects(
    approveRerunProposal({
      workspaceId: "workspace-1",
      actorId: "actor-1",
      projectId: "project-1",
      actionId: "proposal-1",
      approvedMaxCostUsd: 0,
    }, state.deps),
    (error: unknown) => error instanceof ApiError && error.code === "coverage_unavailable"
  );
  assert.equal(state.reserves, 0);
});

test("multi-output story work fails production coverage before approval", async () => {
  const firstTarget = {
    kind: "beat" as const,
    projectId: "project-1",
    beatId: "beat-1",
  };
  const secondTarget = {
    kind: "beat" as const,
    projectId: "project-1",
    beatId: "beat-2",
  };
  const proposal = revisionProposal();
  proposal.selectedWork = [{
    workItemId: "story-work",
    owner: "creative_director",
    kind: "revise_story",
    targets: [firstTarget, secondTarget],
    requiredOutputs: [firstTarget, secondTarget].map((storyTarget, index) => ({
      bindingId: `story-binding-${index + 1}`,
      workItemId: "story-work",
      target: storyTarget,
      kind: "story_snapshot",
      role: "beat_snapshot",
      ordinal: index,
    })),
  }];
  const state = harness({ proposal, registry: productionRerunExecutorRegistry });

  await assert.rejects(
    approveRerunProposal({
      workspaceId: "workspace-1",
      actorId: "actor-1",
      projectId: "project-1",
      actionId: "proposal-1",
      approvedMaxCostUsd: 0,
    }, state.deps),
    (error: unknown) =>
      error instanceof ApiError && error.code === "coverage_unavailable"
  );
  assert.equal(state.approvals, 0);
  assert.equal(state.reserves, 0);
});

test("preflight rejects ambiguous output ownership before approval", () => {
  const executor = (id: string) => createFakeRerunExecutor({
    id,
    kind: "revise_visuals",
    execute: async () => { throw new Error("must not execute"); },
  });
  const registry = new RerunExecutorRegistry([executor("one"), executor("two")]);
  assert.throws(
    () => registry.preflight(revisionProposal().selectedWork),
    (error: unknown) => error instanceof ApiError && error.code === "coverage_unavailable"
  );
});

test("callback tokens use the raw SHA-256 fence expected by the database", () => {
  assert.equal(
    callbackTokenHash("callback-token"),
    "2bab857641ead2282344948fa6e48b34d6048089f1fd912e68c2f4fafb9c6a8f"
  );
});

test("bound target validation ignores object key insertion order", () => {
  const proposal = revisionProposal();
  const expected = proposal.selectedWork[0]!;
  const reorderedTarget = {
    assetId: "asset-1",
    projectId: "project-1",
    kind: "asset" as const,
  };
  assert.doesNotThrow(() => validateBoundExecutorOutputs(expected, [{
    ...expected.requiredOutputs[0]!,
    target: reorderedTarget,
    assetId: "output-asset",
    intrinsicRole: "revised-shot",
  }]));
});

test("stale pins fail before execution reservation", async () => {
  const state = harness({
    stale: true,
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        kind: "revise_visuals",
        execute: async () => { throw new Error("must not execute"); },
      }),
    ]),
  });
  await assert.rejects(
    approveRerunProposal({
      workspaceId: "workspace-1",
      actorId: "actor-1",
      projectId: "project-1",
      actionId: "proposal-1",
      approvedMaxCostUsd: 0,
    }, state.deps),
    (error: unknown) => error instanceof ApiError && error.code === "stale_proposal"
  );
  assert.equal(state.reserves, 0);
});

test("ten concurrent executes reserve one execution and dispatch one fake work item", async () => {
  let state: ReturnType<typeof harness>;
  const registry = new RerunExecutorRegistry([
    createFakeRerunExecutor({
      kind: "revise_visuals",
      execute: async ({ workItem }) => {
        state.incrementDispatch();
        return {
          status: "succeeded",
          outputs: workItem.requiredOutputs.map((output) => ({
            ...output,
            assetId: "output-asset-1",
            intrinsicRole: output.role,
          })),
          reconciliationActionId: "reconciliation-1",
          primitiveActionIds: [],
          budgetReservationKeys: [],
        };
      },
    }),
  ]);
  state = harness({ registry });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const attempts = await Promise.allSettled(Array.from({ length: 10 }, () =>
    executeRerunProposal({
      workspaceId: "workspace-1",
      actorId: "actor-1",
      projectId: "project-1",
      actionId: "proposal-1",
      idempotencyKey: "execute-once",
    }, state.deps)));
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 10);
  assert.equal(state.dispatches, 1);
  assert.equal(state.reserves, 10);
});

test("clarification answers must preserve the exact question fingerprint", async () => {
  const clarification: RerunProposalV2 = {
    ...revisionProposal(),
    outcome: "ask_clarification",
    selectedWork: [],
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
    requiresApproval: false,
    clarification: {
      question: "Which look?",
      targets: [target],
      options: [
        { id: "warm", label: "Warm", tradeoff: "Less neutral." },
        { id: "neutral", label: "Neutral", tradeoff: "Less stylized." },
      ],
      answerFingerprint: "question-fingerprint",
    },
  };
  const state = harness({ proposal: clarification });
  await assert.rejects(
    refreshRerunProposal({
      workspaceId: "workspace-1",
      projectId: "project-1",
      actionId: "proposal-1",
      idempotencyKey: "answer-1",
      message: "Use warm.",
      clarificationAnswer: {
        answerFingerprint: "stale-fingerprint",
        optionId: "warm",
      },
    }, state.deps),
    (error: unknown) => error instanceof ApiError && error.code === "stale_proposal"
  );
});

test("a valid clarification answer creates one causally linked successor", async () => {
  const clarification: RerunProposalV2 = {
    ...revisionProposal(),
    outcome: "ask_clarification",
    selectedWork: [],
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
    requiresApproval: false,
    clarification: {
      question: "Which look?",
      targets: [target],
      options: [
        { id: "warm", label: "Warm", tradeoff: "Less neutral." },
        { id: "neutral", label: "Neutral", tradeoff: "Less stylized." },
      ],
      answerFingerprint: "question-fingerprint",
    },
  };
  const state = harness({ proposal: clarification });
  const successorInputs: Array<
    Parameters<RerunLifecycleDeps["createSuccessor"]>[0]
  > = [];
  state.deps.createSuccessor = async (input) => {
    successorInputs.push(input);
    return { successor_action_id: "successor-1", replayed: false };
  };
  state.deps.createProposal = (async (input, overrides) => {
    const next = revisionProposal();
    const action = await overrides!.persistProposal!({
      projectId: input.projectId,
      rootRunId: "root-1",
      source: input.source,
      message: input.message,
      targets: input.targets,
      proposal: next,
      priorProposalActionId: input.priorProposalActionId,
      clarificationAnswer: input.clarificationAnswer,
    });
    return { actionId: action.id, proposal: next };
  }) as RerunLifecycleDeps["createProposal"];
  const result = await refreshRerunProposal({
    workspaceId: "workspace-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "answer-1",
    message: "Use warm.",
    clarificationAnswer: {
      answerFingerprint: "question-fingerprint",
      optionId: "warm",
    },
  }, state.deps);
  const successorInput = successorInputs[0]!;
  assert.equal(result.actionId, "successor-1");
  assert.equal(successorInput?.priorActionId, "proposal-1");
  assert.equal(successorInput?.cause, "clarification_answer");
  assert.match(successorInput?.requestFingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(
    successorInput?.params.clarificationAnswer,
    { answerFingerprint: "question-fingerprint", optionId: "warm" }
  );
});

test("a concurrent successor replay returns the persisted winning proposal", async () => {
  const state = harness({});
  const losingProposal = {
    ...revisionProposal(),
    userFacingSummary: "Losing nondeterministic proposal.",
  };
  const winningProposal = {
    ...revisionProposal(),
    userFacingSummary: "Persisted winning proposal.",
  };
  let successorReads = 0;
  state.deps.getSuccessor = async () => {
    successorReads += 1;
    if (successorReads === 1) return null;
    return {
      ...action(winningProposal),
      id: "successor-winner",
      proposal: winningProposal,
      rationale: winningProposal.rationale,
    };
  };
  state.deps.createSuccessor = async () => ({
    successor_action_id: "successor-winner",
    replayed: true,
  });
  state.deps.createProposal = (async (input, overrides) => {
    const persisted = await overrides!.persistProposal!({
      projectId: input.projectId,
      rootRunId: "root-1",
      source: input.source,
      message: input.message,
      targets: input.targets,
      proposal: losingProposal,
      priorProposalActionId: input.priorProposalActionId,
    });
    return { actionId: persisted.id, proposal: losingProposal };
  }) as RerunLifecycleDeps["createProposal"];

  const result = await refreshRerunProposal({
    workspaceId: "workspace-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "refresh-race",
    message: "Try another version.",
  }, state.deps);

  assert.equal(successorReads, 2);
  assert.equal(result.actionId, "successor-winner");
  assert.equal(result.proposal.userFacingSummary, "Persisted winning proposal.");
  assert.equal(result.replayed, true);
});

test("late cancellation reports the persisted successful outcome", async () => {
  const state = harness({});
  state.deps.cancelExecution = async () => ({
    executionActionId: "execution-action-success",
    status: "applied",
    canceled: false,
  });

  const result = await cancelRerunProposal({
    workspaceId: "workspace-1",
    projectId: "project-1",
    actionId: "proposal-1",
    reason: "Too late.",
  }, state.deps);

  assert.deepEqual(result, {
    actionId: "proposal-1",
    executionActionId: "execution-action-success",
    status: "applied",
    canceled: false,
  });
});

test("eligible autonomous work uses the same durable approval path", async () => {
  const proposal = revisionProposal("autonomous_review");
  let state: ReturnType<typeof harness>;
  let approvals = 0;
  const registry = new RerunExecutorRegistry([
    createFakeRerunExecutor({
      kind: "revise_visuals",
      execute: async ({ workItem }) => ({
        status: "succeeded",
        outputs: workItem.requiredOutputs.map((output) => ({
          ...output,
          assetId: "output-asset-1",
          intrinsicRole: output.role,
        })),
        reconciliationActionId: "reconciliation-1",
        primitiveActionIds: [],
        budgetReservationKeys: [],
      }),
    }),
  ]);
  state = harness({ proposal, registry });
  const approve = state.deps.approve;
  state.deps.approve = async (input) => {
    approvals += 1;
    assert.equal(input.autonomous, true);
    return approve(input);
  };
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "system",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "autonomous-1",
  }, state.deps);
  assert.equal(result.status, "applied");
  assert.equal(approvals, 1);
});

test("workspace authorization runs before proposal reads", async () => {
  let read = false;
  const state = harness({});
  state.deps.authorizeProject = async () => {
    throw new ApiError("not_found", "hidden");
  };
  state.deps.getProposal = async () => {
    read = true;
    return action();
  };
  await assert.rejects(rejectRerunProposal({
    workspaceId: "other-workspace",
    projectId: "project-1",
    actionId: "proposal-1",
  }, state.deps));
  assert.equal(read, false);
});

test("executor failure terminalizes the proposal execution and releases the worker path", async () => {
  const registry = new RerunExecutorRegistry([
    createFakeRerunExecutor({
      kind: "revise_visuals",
      execute: async () => {
        throw new Error("fake provider failed");
      },
    }),
  ]);
  const state = harness({ registry });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "executor-failure",
  }, state.deps);
  assert.equal(result.status, "failed");
  assert.equal(state.finalOutcome, "failed");
});

test("retryable executor failure parks and replays the same fenced result", async () => {
  const reservationKey = "root:critique:reservation-1";
  const idempotencyKeys: string[] = [];
  const callbackGenerations: number[] = [];
  const reservedKeys: string[] = [];
  let attempts = 0;
  let stagedAssetCount = 0;
  let stagedAssetId: string | null = null;
  const registry = new RerunExecutorRegistry([
    createFakeRerunExecutor({
      kind: "revise_visuals",
      execute: async (context) => {
        attempts += 1;
        idempotencyKeys.push(context.fence.idempotencyKey);
        callbackGenerations.push(context.fence.callbackGeneration);
        await context.reserveBudget({
          actionId: context.fence.dispatchActionId,
          reservationKey,
          estimatedUsd: 0.05,
        });
        if (!stagedAssetId) {
          stagedAssetId = "pooled-output-1";
          stagedAssetCount += 1;
        }
        if (attempts === 1) {
          throw new RetryableRerunExecutorError(
            "settlement response was lost",
            { budgetReservationKeys: [reservationKey] }
          );
        }
        return {
          status: "succeeded",
          outputs: context.requiredOutputs.map((output) => ({
            ...output,
            assetId: stagedAssetId!,
            intrinsicRole: output.role,
          })),
          primitiveActionIds: [context.fence.dispatchActionId],
          budgetReservationKeys: [reservationKey],
        };
      },
    }),
  ]);
  const retryProposal = revisionProposal();
  retryProposal.estimate = {
    costUsd: 0.05,
    maxCostUsd: 0.05,
    latencyClass: "interactive",
  };
  const state = harness({ registry, proposal: retryProposal });
  let budgetReservations = 0;
  const durableBudgetKeys: string[] = [];
  state.deps.reserveChildBudget = async (request) => {
    budgetReservations += 1;
    reservedKeys.push(request.reservationKey);
    if (!durableBudgetKeys.includes(request.reservationKey)) {
      durableBudgetKeys.push(request.reservationKey);
    }
    return {
      reservationId: "child-budget-1",
      replayed: budgetReservations > 1,
    };
  };
  const parkWorkItem = state.deps.parkWorkItem;
  let retryParkChecked = false;
  state.deps.parkWorkItem = async (request) => {
    if (!request.completedCallbacks?.length && !request.acceptedCallbacks?.length) {
      assert.deepEqual(request.primitiveActionIds, []);
      assert.deepEqual(request.budgetReservationKeys, durableBudgetKeys);
      assert.deepEqual(request.bindingResults, []);
      retryParkChecked = true;
    }
    await parkWorkItem(request);
  };
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0.05,
  }, state.deps);

  const first = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "retryable-root-result",
  }, state.deps);
  assert.equal(first.status, "waiting");
  assert.equal(state.failedWorkItems, 0);
  assert.equal(state.finalOutcome, null);
  assert.deepEqual(state.lastParked?.budgetReservationKeys, [reservationKey]);
  assert.equal(retryParkChecked, true);

  const replay = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "retryable-root-result",
  }, state.deps);
  assert.equal(replay.status, "applied");
  assert.equal(state.failedWorkItems, 0);
  assert.equal(state.finalOutcome, "applied");
  assert.equal(stagedAssetCount, 1);
  assert.deepEqual(idempotencyKeys, [idempotencyKeys[0], idempotencyKeys[0]]);
  assert.deepEqual(callbackGenerations, [1, 1]);
  assert.deepEqual(reservedKeys, [reservationKey, reservationKey]);
});

for (const code of ["stale_proposal", "budget_exceeded"] as const) {
  test(`${code} during atomic application terminalizes failed without redispatch`, async () => {
    let calls = 0;
    const state = harness({
      appliedFinalizeError: new ApiError(code, `forced ${code}`),
      registry: new RerunExecutorRegistry([
        createFakeRerunExecutor({
          kind: "revise_visuals",
          execute: async ({ workItem }) => {
            calls += 1;
            return {
              status: "succeeded",
              outputs: workItem.requiredOutputs.map((output) => ({
                ...output,
                assetId: "pooled-output-1",
                intrinsicRole: output.role,
              })),
              primitiveActionIds: [],
              budgetReservationKeys: [],
            };
          },
        }),
      ]),
    });
    await approveRerunProposal({
      workspaceId: "workspace-1",
      actorId: "actor-1",
      projectId: "project-1",
      actionId: "proposal-1",
      approvedMaxCostUsd: 0,
    }, state.deps);
    const result = await executeRerunProposal({
      workspaceId: "workspace-1",
      actorId: "actor-1",
      projectId: "project-1",
      actionId: "proposal-1",
      idempotencyKey: `atomic-${code}`,
    }, state.deps);
    assert.equal(result.status, "failed");
    assert.equal(calls, 1);
    assert.deepEqual(state.finalOutcomes, ["applied", "failed"]);
  });
}

test("accepted async work parks with a durable callback fence instead of finalizing", async () => {
  const registry = new RerunExecutorRegistry([
    createFakeRerunExecutor({
      kind: "revise_visuals",
      execute: async () => ({
        status: "accepted",
        jobIds: ["00000000-0000-4000-8000-000000000001"],
        primitiveActionIds: [],
        budgetReservationKeys: [],
      }),
    }),
  ]);
  const state = harness({ registry });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "accepted-work",
  }, state.deps);
  assert.equal(result.status, "waiting");
  assert.equal(state.parked, 1);
  assert.equal(state.finalOutcome, null);
});

test("failed durable work replays terminally without invoking an executor", async () => {
  let executorCalls = 0;
  const state = harness({
    reservedWorkStatus: "failed",
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        kind: "revise_visuals",
        execute: async () => {
          executorCalls += 1;
          throw new Error("must not execute");
        },
      }),
    ]),
  });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "failed-replay",
  }, state.deps);
  assert.equal(result.status, "failed");
  assert.equal(executorCalls, 0);
});

test("a blocked prerequisite terminalizes instead of parking budget indefinitely", async () => {
  const state = harness({
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        kind: "revise_visuals",
        execute: async () => ({
          status: "blocked",
          precondition: {
            kind: "missing_picture_duration",
            message: "Picture duration is required.",
            target,
          },
        }),
      }),
    ]),
  });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "blocked-work",
  }, state.deps);
  assert.equal(result.status, "failed");
  assert.equal(state.parked, 0);
  assert.equal(state.finalOutcome, "failed");
});

test("a failed work item wins over a concurrently accepted item", async () => {
  const proposal = revisionProposal();
  const secondOutput = {
    ...proposal.selectedWork[0]!.requiredOutputs[0]!,
    bindingId: "binding-2",
    workItemId: "work-2",
    ordinal: 1,
  };
  proposal.selectedWork = [
    proposal.selectedWork[0]!,
    {
      ...proposal.selectedWork[0]!,
      workItemId: "work-2",
      requiredOutputs: [secondOutput],
    },
  ];
  const state = harness({
    proposal,
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        kind: "revise_visuals",
        execute: async ({ workItem }) => {
          if (workItem.workItemId === "work-2") throw new Error("provider failed");
          return {
            status: "accepted",
            jobIds: ["00000000-0000-4000-8000-000000000002"],
            primitiveActionIds: [],
            budgetReservationKeys: [],
          };
        },
      }),
    ]),
  });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "mixed-failure",
  }, state.deps);
  assert.equal(result.status, "failed");
  assert.equal(state.finalOutcome, "failed");
});

test("mixed adapter work fans out concurrently and converges on one finalization", async () => {
  const proposal = revisionProposal();
  const audioTarget = {
    kind: "selection" as const,
    projectId: "project-1",
    slotOwnerLineageId: null,
    slotRole: "narration",
  };
  const audioOutput = {
    bindingId: "audio-binding",
    workItemId: "audio-work",
    target: audioTarget,
    kind: "audio_track" as const,
    role: "narration",
    ordinal: 0,
  };
  proposal.selectedWork.push({
    workItemId: "audio-work",
    owner: "audio",
    kind: "revise_audio",
    targets: [audioTarget],
    requiredOutputs: [audioOutput],
  });
  let entered = 0;
  let bothEntered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    bothEntered = resolve;
  });
  let release!: () => void;
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = async (assetId: string, workItem: RerunWorkItem) => {
    entered += 1;
    if (entered === 2) bothEntered();
    await releasePromise;
    return {
      status: "succeeded" as const,
      outputs: workItem.requiredOutputs.map((output) => ({
        ...output,
        assetId,
        intrinsicRole: output.role,
      })),
      primitiveActionIds: [],
      budgetReservationKeys: [],
    };
  };
  const state = harness({
    proposal,
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        id: "parallel-visual",
        kind: "revise_visuals",
        execute: ({ workItem }) => execute("visual-output", workItem),
      }),
      createFakeRerunExecutor({
        id: "parallel-audio",
        kind: "revise_audio",
        execute: ({ workItem }) => execute("audio-output", workItem),
      }),
    ]),
  });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const execution = executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "parallel-mixed",
  }, state.deps);
  await enteredPromise;
  assert.equal(entered, 2);
  release();
  assert.equal((await execution).status, "applied");
  assert.deepEqual(state.finalOutcomes, ["applied"]);
});

test("assembly and critique execute in dependent waves after media fan-in", async () => {
  const proposal = revisionProposal();
  proposal.selectedWork.push({
    workItemId: "assembly-work",
    owner: "creative_director",
    kind: "reassemble_cut",
    targets: [target],
    requiredOutputs: [{
      bindingId: "cut-binding",
      workItemId: "assembly-work",
      target,
      kind: "composite",
      role: "cut",
      ordinal: 0,
    }],
  }, {
    workItemId: "critique-work",
    owner: "creative_director",
    kind: "critique_cut",
    targets: [target],
    requiredOutputs: [{
      bindingId: "critique-binding",
      workItemId: "critique-work",
      target,
      kind: "critique",
      role: "critique",
      ordinal: 0,
    }],
  });
  const events: string[] = [];
  let visualEntered!: () => void;
  const visualEnteredPromise = new Promise<void>((resolve) => {
    visualEntered = resolve;
  });
  let releaseVisual!: () => void;
  const releaseVisualPromise = new Promise<void>((resolve) => {
    releaseVisual = resolve;
  });
  const succeed = (workItem: RerunWorkItem) => ({
    status: "succeeded" as const,
    outputs: workItem.requiredOutputs.map((output) => ({
      ...output,
      assetId: `${workItem.workItemId}-asset`,
      intrinsicRole: output.role,
    })),
    primitiveActionIds: [],
    budgetReservationKeys: [],
  });
  const state = harness({
    proposal,
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        kind: "revise_visuals",
        execute: async ({ workItem }) => {
          events.push("visual:start");
          visualEntered();
          await releaseVisualPromise;
          events.push("visual:end");
          return succeed(workItem);
        },
      }),
      createFakeRerunExecutor({
        kind: "reassemble_cut",
        execute: async ({ workItem }) => {
          events.push("assembly");
          return succeed(workItem);
        },
      }),
      createFakeRerunExecutor({
        kind: "critique_cut",
        execute: async ({ workItem }) => {
          events.push("critique");
          return succeed(workItem);
        },
      }),
    ]),
  });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const execution = executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "dependent-waves",
  }, state.deps);
  await visualEnteredPromise;
  assert.deepEqual(events, ["visual:start"]);
  releaseVisual();
  assert.equal((await execution).status, "applied");
  assert.deepEqual(events, ["visual:start", "visual:end", "assembly", "critique"]);
});

test("accepted media parks before reserving dependent assembly or critique", async () => {
  const proposal = revisionProposal();
  proposal.selectedWork.push({
    workItemId: "assembly-work",
    owner: "creative_director",
    kind: "reassemble_cut",
    targets: [target],
    requiredOutputs: [{
      bindingId: "cut-binding",
      workItemId: "assembly-work",
      target,
      kind: "composite",
      role: "cut",
      ordinal: 0,
    }],
  }, {
    workItemId: "critique-work",
    owner: "creative_director",
    kind: "critique_cut",
    targets: [target],
    requiredOutputs: [{
      bindingId: "critique-binding",
      workItemId: "critique-work",
      target,
      kind: "critique",
      role: "critique",
      ordinal: 0,
    }],
  });
  let dependentCalls = 0;
  const state = harness({
    proposal,
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        kind: "revise_visuals",
        execute: async () => ({
          status: "accepted",
          jobIds: ["00000000-0000-4000-8000-000000000099"],
          primitiveActionIds: [],
          budgetReservationKeys: [],
        }),
      }),
      createFakeRerunExecutor({
        kind: "reassemble_cut",
        execute: async () => {
          dependentCalls += 1;
          throw new Error("assembly must wait for media fan-in");
        },
      }),
      createFakeRerunExecutor({
        kind: "critique_cut",
        execute: async () => {
          dependentCalls += 1;
          throw new Error("critique must wait for assembly");
        },
      }),
    ]),
  });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "park-before-dependent-waves",
  }, state.deps);
  assert.equal(result.status, "waiting");
  assert.equal(dependentCalls, 0);
  assert.equal(state.parked, 1);
});

test("a durable completed executor step is skipped after a process crash", async () => {
  const proposal = revisionProposal();
  const imageOutput = proposal.selectedWork[0]!.requiredOutputs[0]!;
  const videoOutput = {
    ...imageOutput,
    bindingId: "binding-video",
    kind: "video" as const,
    role: "revised-clip",
    ordinal: 1,
  };
  proposal.selectedWork[0]!.requiredOutputs = [imageOutput, videoOutput];
  let imageCalls = 0;
  let videoCalls = 0;
  const imageResult = {
    ...imageOutput,
    assetId: "image-output",
    intrinsicRole: "revised-shot",
  };
  const state = harness({
    proposal,
    reservedWorkStatus: "running",
    callbackResults: [{
      executorId: "image-step",
      status: "completed",
      jobIds: [],
      result: {
        outputs: [imageResult],
        primitiveActionIds: [],
        budgetReservationKeys: [],
      },
    }, {
      executorId: "video-step",
      status: "pending",
      jobIds: [],
      result: null,
    }],
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        id: "image-step",
        kind: "revise_visuals",
        outputKinds: ["image"],
        execute: async () => {
          imageCalls += 1;
          throw new Error("completed step must not replay");
        },
      }),
      createFakeRerunExecutor({
        id: "video-step",
        kind: "revise_visuals",
        outputKinds: ["video"],
        execute: async () => {
          videoCalls += 1;
          return {
            status: "succeeded",
            outputs: [{
              ...videoOutput,
              assetId: "video-output",
              intrinsicRole: "revised-clip",
            }],
            primitiveActionIds: [],
            budgetReservationKeys: [],
          };
        },
      }),
    ]),
  });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "resume-step",
  }, state.deps);
  assert.equal(result.status, "applied");
  assert.equal(imageCalls, 0);
  assert.equal(videoCalls, 1);
});

test("inert follow-up metadata survives parking but never enters complete-work causation", async () => {
  const registry = new RerunExecutorRegistry([
    createFakeRerunExecutor({
      kind: "revise_visuals",
      execute: async ({ workItem }) => ({
        status: "succeeded",
        outputs: workItem.requiredOutputs.map((output) => ({
          ...output,
          assetId: "output-asset-1",
          intrinsicRole: output.role,
        })),
        primitiveActionIds: ["dispatch-action-1"],
        budgetReservationKeys: ["budget-key-1"],
        providerResult: { followupProposalActionId: "proposal-followup" },
      }),
    }),
  ]);
  const state = harness({ registry });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "followup-metadata",
  }, state.deps);

  assert.equal(result.status, "applied");
  assert.deepEqual(
    state.lastParked?.completedCallbacks?.[0]?.result.providerResult,
    { followupProposalActionId: "proposal-followup" }
  );
  assert.deepEqual(state.lastCompleted?.primitiveActionIds, ["dispatch-action-1"]);
});

test("a job-backed pending step reparks instead of becoming a failure", async () => {
  let executorCalls = 0;
  const state = harness({
    reservedWorkStatus: "running",
    callbackResults: [{
      executorId: "pending-step",
      status: "pending",
      jobIds: ["00000000-0000-4000-8000-000000000003"],
      result: null,
    }],
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        id: "pending-step",
        kind: "revise_visuals",
        execute: async () => {
          executorCalls += 1;
          throw new Error("pending provider step must not replay");
        },
      }),
    ]),
  });
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "pending-step",
  }, state.deps);
  assert.equal(result.status, "waiting");
  assert.equal(executorCalls, 0);
  assert.equal(state.finalOutcome, null);
});

test("an expired lease with pending callbacks returns durable waiting", async () => {
  const state = harness({
    registry: new RerunExecutorRegistry([
      createFakeRerunExecutor({
        kind: "revise_visuals",
        execute: async () => { throw new Error("must not execute"); },
      }),
    ]),
  });
  state.deps.claimExecution = async () => null;
  await approveRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    approvedMaxCostUsd: 0,
  }, state.deps);
  const result = await executeRerunProposal({
    workspaceId: "workspace-1",
    actorId: "actor-1",
    projectId: "project-1",
    actionId: "proposal-1",
    idempotencyKey: "pending-lease",
  }, state.deps);
  assert.equal(result.status, "waiting");
  assert.equal(result.replayed, true);
  assert.equal(state.finalOutcome, null);
});
