import assert from "node:assert/strict";
import test from "node:test";

import type { RerunProposalV2 } from "@popcorn/shared/rerun-proposal";
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
  RerunExecutorRegistry,
  validateBoundExecutorOutputs,
} from "../rerun-executor-registry";

const target = {
  kind: "asset" as const,
  projectId: "project-1",
  assetId: "asset-1",
};

function revisionProposal(source: "request_changes" | "autonomous_review" = "request_changes"):
RerunProposalV2 {
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

function action(proposal = revisionProposal()): RerunProposalActionRecord {
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
  let finalOutcome: "applied" | "failed" | null = null;
  let parked = 0;
  const deps: RerunLifecycleDeps = {
    authorizeProject: async () => ({}) as never,
    getProposal: async () => proposalAction,
    getSuccessor: async () => null,
    assertAuthority: async () => {},
    approve: async (request) => {
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
      if (!reservation || reservation.status !== "reserved") {
        throw new ApiError("idempotency_in_progress", "leased");
      }
      reservation.status = "running";
      return {
        reservationId: "reservation-1",
        leaseToken: "lease-1",
        leaseGeneration: 1,
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
    completeWorkItem: async () => {},
    parkWorkItem: async () => { parked += 1; },
    parkExecution: async () => {},
    failWorkItem: async () => {},
    reserveChildBudget: async () => ({ reservationId: "child-budget-1", replayed: false }),
    listCompletedBindings: async () => [],
    finalizeExecution: async (request) => {
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
    get finalOutcome() { return finalOutcome; },
    get parked() { return parked; },
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
