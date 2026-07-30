import { createHash } from "node:crypto";
import type {
  RerunProposalV2,
  RerunTarget,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import { getProject } from "@/lib/api/v1/store";
import * as lifecycleStore from "@/lib/api/v1/rerun-lifecycle-store";
import { createRerunProposalV2 } from "./rerun-proposal-v2-service";
import {
  productionRerunExecutorRegistry,
  type BoundExecutorOutput,
  RerunExecutorRegistry,
  validateBoundExecutorOutputs,
} from "./rerun-executor-registry";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function callbackTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function deterministicUuid(...parts: string[]): string {
  const digest = fingerprint(parts);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${((parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export interface RerunLifecycleDeps {
  authorizeProject: typeof getProject;
  getProposal: typeof lifecycleStore.getRerunProposalAction;
  getSuccessor: typeof lifecycleStore.getRerunProposalSuccessor;
  assertAuthority: typeof lifecycleStore.assertRerunProposalAuthority;
  approve: typeof lifecycleStore.approveRerunProposal;
  getApproval: typeof lifecycleStore.getRerunProposalApproval;
  reject: typeof lifecycleStore.rejectRerunProposal;
  createSuccessor: typeof lifecycleStore.createRerunProposalSuccessor;
  reserveExecution: typeof lifecycleStore.reserveRerunExecution;
  claimExecution: typeof lifecycleStore.claimRerunExecution;
  renewExecution: typeof lifecycleStore.renewRerunExecution;
  reserveWorkItem: typeof lifecycleStore.reserveRerunWorkItem;
  completeWorkItem: typeof lifecycleStore.completeRerunWorkItem;
  parkWorkItem: typeof lifecycleStore.parkRerunWorkItem;
  parkExecution: typeof lifecycleStore.parkRerunExecution;
  failWorkItem: typeof lifecycleStore.failRerunWorkItem;
  reserveChildBudget: typeof lifecycleStore.reserveRerunChildBudget;
  listCompletedBindings: typeof lifecycleStore.listCompletedRerunBindings;
  ensureReconciliation: typeof lifecycleStore.ensureRerunReconciliation;
  finalizeExecution: typeof lifecycleStore.finalizeRerunExecution;
  cancelExecution: typeof lifecycleStore.cancelRerunExecution;
  createProposal: typeof createRerunProposalV2;
  registry: RerunExecutorRegistry;
}

const defaultDeps: RerunLifecycleDeps = {
  authorizeProject: getProject,
  getProposal: lifecycleStore.getRerunProposalAction,
  getSuccessor: lifecycleStore.getRerunProposalSuccessor,
  assertAuthority: lifecycleStore.assertRerunProposalAuthority,
  approve: lifecycleStore.approveRerunProposal,
  getApproval: lifecycleStore.getRerunProposalApproval,
  reject: lifecycleStore.rejectRerunProposal,
  createSuccessor: lifecycleStore.createRerunProposalSuccessor,
  reserveExecution: lifecycleStore.reserveRerunExecution,
  claimExecution: lifecycleStore.claimRerunExecution,
  renewExecution: lifecycleStore.renewRerunExecution,
  reserveWorkItem: lifecycleStore.reserveRerunWorkItem,
  completeWorkItem: lifecycleStore.completeRerunWorkItem,
  parkWorkItem: lifecycleStore.parkRerunWorkItem,
  parkExecution: lifecycleStore.parkRerunExecution,
  failWorkItem: lifecycleStore.failRerunWorkItem,
  reserveChildBudget: lifecycleStore.reserveRerunChildBudget,
  listCompletedBindings: lifecycleStore.listCompletedRerunBindings,
  ensureReconciliation: lifecycleStore.ensureRerunReconciliation,
  finalizeExecution: lifecycleStore.finalizeRerunExecution,
  cancelExecution: lifecycleStore.cancelRerunExecution,
  createProposal: createRerunProposalV2,
  registry: productionRerunExecutorRegistry,
};

async function authorizedProposal(input: {
  workspaceId: string;
  projectId: string;
  actionId: string;
}, deps: RerunLifecycleDeps) {
  await deps.authorizeProject(input.workspaceId, input.projectId);
  const action = await deps.getProposal({
    projectId: input.projectId,
    actionId: input.actionId,
  });
  await deps.assertAuthority(action);
  return action;
}

function revisionProposal(
  proposal: RerunProposalV2
): asserts proposal is Extract<RerunProposalV2, { outcome: "revision" }> {
  if (proposal.outcome !== "revision") {
    throw new ApiError("validation_failed", "Only revision proposals have an execution lifecycle.");
  }
}

function autoApprovalEligible(
  proposal: Extract<RerunProposalV2, { outcome: "revision" }>
): boolean {
  return (
    proposal.source === "autonomous_review" &&
    !proposal.requiresApproval &&
    proposal.risk === "low" &&
    proposal.estimate.maxCostUsd === 0 &&
    new Set(proposal.selectedWork.map((item) => item.owner)).size === 1 &&
    proposal.plannedSelectionMoves.length <= 1 &&
    proposal.plannedStoryPointerMoves.length === 0
  );
}

export async function approveRerunProposal(input: {
  workspaceId: string;
  actorId: string;
  projectId: string;
  actionId: string;
  approvedMaxCostUsd: number;
}, overrides: Partial<RerunLifecycleDeps> = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const action = await authorizedProposal(input, deps);
  revisionProposal(action.proposal);
  const proposal = action.proposal;
  // Coverage is checked before approval state or budget authority exists.
  deps.registry.preflight(proposal.selectedWork);
  if (input.approvedMaxCostUsd !== action.proposal.estimate.maxCostUsd) {
    throw new ApiError(
      "validation_failed",
      "approvedMaxCostUsd must equal the server-derived proposal ceiling."
    );
  }
  const approvalFingerprint = fingerprint({
    proposalActionId: action.id,
    proposal: action.proposal,
    approvedMaxCostUsd: input.approvedMaxCostUsd,
  });
  const approvalActionId = deterministicUuid(
    "rerun-approval",
    action.id,
    approvalFingerprint
  );
  const approved = await deps.approve({
    projectId: input.projectId,
    proposalActionId: action.id,
    approvalActionId,
    actorId: input.actorId,
    approvedMaxCostUsd: input.approvedMaxCostUsd,
    approvalFingerprint,
    autonomous: false,
  });
  if (approved.stale || !approved.approval_action_id) {
    throw new ApiError(
      "stale_proposal",
      "Proposal inputs changed before approval; refresh the proposal."
    );
  }
  return {
    actionId: action.id,
    status: approved.proposal_status,
    approvalActionId: approved.approval_action_id,
    replayed: approved.replayed,
  };
}

export async function rejectRerunProposal(input: {
  workspaceId: string;
  projectId: string;
  actionId: string;
}, overrides: Partial<RerunLifecycleDeps> = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const action = await authorizedProposal(input, deps);
  const status = await deps.reject({
    projectId: input.projectId,
    proposalActionId: action.id,
  });
  return { actionId: action.id, status };
}

export async function cancelRerunProposal(input: {
  workspaceId: string;
  projectId: string;
  actionId: string;
  reason: string;
}, overrides: Partial<RerunLifecycleDeps> = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const action = await authorizedProposal(input, deps);
  const executionActionId = deterministicUuid("rerun-execution", action.id, "canceled");
  const persistedId = await deps.cancelExecution({
    projectId: input.projectId,
    proposalActionId: action.id,
    executionActionId,
    reason: input.reason,
  });
  return {
    actionId: action.id,
    executionActionId: persistedId,
    status: "failed" as const,
    canceled: true,
  };
}

export async function refreshRerunProposal(input: {
  workspaceId: string;
  projectId: string;
  actionId: string;
  idempotencyKey: string;
  message: string;
  targets?: RerunTarget[];
  clarificationAnswer?: {
    answerFingerprint: string;
    optionId: string;
  };
}, overrides: Partial<RerunLifecycleDeps> = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const prior = await authorizedProposal(input, deps);
  let cause: "refresh" | "clarification_answer" = "refresh";
  if (input.clarificationAnswer) {
    if (
      prior.proposal.outcome !== "ask_clarification" ||
      prior.proposal.clarification.answerFingerprint !==
        input.clarificationAnswer.answerFingerprint ||
      !prior.proposal.clarification.options.some(
        (option) => option.id === input.clarificationAnswer!.optionId
      )
    ) {
      throw new ApiError("stale_proposal", "Clarification answer does not match the live question.");
    }
    cause = "clarification_answer";
  }
  const targets = input.targets ?? prior.proposal.targets;
  const requestFingerprint = fingerprint({
    priorActionId: prior.id,
    idempotencyKey: input.idempotencyKey,
    cause,
    message: input.message,
    targets,
    clarificationAnswer: input.clarificationAnswer ?? null,
  });
  const existing = await deps.getSuccessor({
    projectId: input.projectId,
    priorActionId: prior.id,
    requestFingerprint,
    cause,
  });
  if (existing) {
    return { actionId: existing.id, proposal: existing.proposal, replayed: true };
  }
  const successorActionId = deterministicUuid(
    "rerun-successor",
    prior.id,
    input.idempotencyKey
  );
  let persistedReplay = false;
  const result = await deps.createProposal({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    source: prior.proposal.source,
    message: input.message,
    targets,
    ...(prior.rootRunId ? { rootRunId: prior.rootRunId } : {}),
    priorProposalActionId: prior.id,
    ...(input.clarificationAnswer
      ? { clarificationAnswer: input.clarificationAnswer }
      : {}),
  }, {
    persistProposal: async (created) => {
      const persisted = await deps.createSuccessor({
        projectId: input.projectId,
        priorActionId: prior.id,
        successorActionId,
        requestFingerprint,
        cause,
        rootRunId: created.rootRunId,
        params: {
          schemaVersion: "rerun_proposal_request.v2",
          source: created.source,
          message: created.message,
          targets: created.targets,
          priorProposalActionId: prior.id,
          ...(created.clarificationAnswer
            ? { clarificationAnswer: created.clarificationAnswer }
            : {}),
        },
        proposal: created.proposal,
        inputAssetIds: created.proposal.inspectedAssetIds,
        rationale: created.proposal.rationale,
      });
      persistedReplay = persisted.replayed;
      return { id: persisted.successor_action_id };
    },
  });
  return { ...result, replayed: persistedReplay };
}

async function autoApprove(input: {
  actorId: string;
  action: lifecycleStore.RerunProposalActionRecord;
}, deps: RerunLifecycleDeps) {
  revisionProposal(input.action.proposal);
  if (!autoApprovalEligible(input.action.proposal)) {
    throw new ApiError("validation_failed", "This proposal requires explicit creator approval.");
  }
  const approvedMaxCostUsd = input.action.proposal.estimate.maxCostUsd;
  const approvalFingerprint = fingerprint({
    proposalActionId: input.action.id,
    proposal: input.action.proposal,
    approvedMaxCostUsd,
    autonomous: true,
  });
  const approvalActionId = deterministicUuid(
    "rerun-auto-approval",
    input.action.id,
    approvalFingerprint
  );
  return deps.approve({
    projectId: input.action.projectId,
    proposalActionId: input.action.id,
    approvalActionId,
    actorId: input.actorId,
    approvedMaxCostUsd,
    approvalFingerprint,
    autonomous: true,
  });
}

export async function executeRerunProposal(input: {
  workspaceId: string;
  actorId: string;
  projectId: string;
  actionId: string;
  idempotencyKey: string;
}, overrides: Partial<RerunLifecycleDeps> = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const action = await authorizedProposal(input, deps);
  revisionProposal(action.proposal);
  const proposal = action.proposal;
  // This ordering is a safety property: unavailable real work cannot become
  // approved, reserve budget, enqueue, or spend.
  deps.registry.preflight(proposal.selectedWork);

  let approval = await deps.getApproval({
    projectId: input.projectId,
    proposalActionId: action.id,
  });
  if (!approval && action.status === "proposed") {
    const auto = await autoApprove({ actorId: input.actorId, action }, deps);
    if (auto.stale || !auto.approval_action_id) {
      throw new ApiError(
        "stale_proposal",
        "Proposal inputs changed before execution; refresh the proposal."
      );
    }
    approval = {
      approvalActionId: auto.approval_action_id,
      approvedMaxCostUsd: action.proposal.estimate.maxCostUsd,
      approvalFingerprint: fingerprint({
        proposalActionId: action.id,
        proposal: action.proposal,
        approvedMaxCostUsd: action.proposal.estimate.maxCostUsd,
        autonomous: true,
      }),
    };
  }
  if (!approval) {
    throw new ApiError("validation_failed", "Proposal must be approved before execution.");
  }
  const requestFingerprint = fingerprint({
    proposalActionId: action.id,
    proposal: action.proposal,
    idempotencyKey: input.idempotencyKey,
    approval,
  });
  const reservation = await deps.reserveExecution({
    projectId: input.projectId,
    proposalActionId: action.id,
    approvalActionId: approval.approvalActionId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    approvedMaxCostUsd: approval.approvedMaxCostUsd,
    approvalFingerprint: approval.approvalFingerprint,
  });
  if (!reservation.reservation_id || reservation.status === "failed") {
    throw new ApiError(
      "stale_proposal",
      "Proposal inputs changed before execution; refresh the proposal."
    );
  }
  if (
    reservation.replayed &&
    ["completed", "failed", "canceled"].includes(reservation.status)
  ) {
    const terminalStatus = reservation.status === "completed"
      ? "applied"
      : reservation.status;
    return {
      actionId: action.id,
      reservationId: reservation.reservation_id,
      ...(reservation.execution_result_action_id
        ? { executionActionId: reservation.execution_result_action_id }
        : {}),
      status: terminalStatus,
      replayed: true,
    };
  }
  let claimedLease: lifecycleStore.RerunLease | null;
  try {
    claimedLease = await deps.claimExecution({
      projectId: input.projectId,
      reservationId: reservation.reservation_id,
    });
  } catch (error) {
    if (
      reservation.replayed &&
      error instanceof ApiError &&
      error.code === "idempotency_in_progress"
    ) {
      return {
        actionId: action.id,
        reservationId: reservation.reservation_id,
        status: reservation.status === "waiting"
          ? "waiting" as const
          : "running" as const,
        replayed: true,
      };
    }
    throw error;
  }
  if (!claimedLease) {
    return {
      actionId: action.id,
      reservationId: reservation.reservation_id,
      status: "waiting" as const,
      replayed: true,
    };
  }
  let lease = claimedLease;
  const rootRunId = reservation.root_run_id;
  if (!rootRunId) {
    throw new ApiError("internal_error", "Execution reservation did not bind a root run.");
  }
  let heartbeatError: unknown;
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || heartbeatError) return;
    heartbeatBusy = true;
    void deps.renewExecution({ projectId: input.projectId, lease })
      .then((renewed) => {
        lease = renewed;
      })
      .catch((error: unknown) => {
        heartbeatError = error;
      })
      .finally(() => {
        heartbeatBusy = false;
      });
  }, 20_000);
  heartbeat.unref();
  const settled = await Promise.allSettled(proposal.selectedWork.map(async (workItem) => {
    const executionPlan = deps.registry.plan(workItem);
    const callbackFences = executionPlan.map(({ executor, requiredOutputs }) => {
      const token = fingerprint({
        kind: "rerun-executor-callback",
        executionReservationId: lease.reservationId,
        workItemId: workItem.workItemId,
        executorId: executor.id,
      });
      return {
        executor,
        token,
        descriptor: {
          executorId: executor.id,
          tokenHash: callbackTokenHash(token),
          generation: 1,
          requiredOutputs,
        },
      };
    });
    const workFingerprint = fingerprint({
      proposalActionId: action.id,
      reservationId: lease.reservationId,
      workItem,
    });
    const dispatchActionId = deterministicUuid(
      "rerun-work-dispatch",
      lease.reservationId,
      workItem.workItemId
    );
    const reserved = await deps.reserveWorkItem({
      projectId: input.projectId,
      lease,
      workItemId: workItem.workItemId,
      requestFingerprint: workFingerprint,
      dispatchActionId,
      dispatchParams: {
        schemaVersion: "RerunWorkDispatch.v1",
        proposalActionId: action.id,
        executionReservationId: lease.reservationId,
        workItem,
      },
      callbackFences: callbackFences.map(({ descriptor }) => descriptor),
    });
    if (reserved.work_status === "completed") {
      const outputs = reserved.binding_results ?? [];
      validateBoundExecutorOutputs(
        workItem,
        outputs as BoundExecutorOutput[]
      );
      return {
        status: "completed" as const,
        outputs: outputs as BoundExecutorOutput[],
        ...(reserved.child_run_id ? { childRunId: reserved.child_run_id } : {}),
        ...(reserved.report_action_id ? { reportActionId: reserved.report_action_id } : {}),
        ...(reserved.reconciliation_action_id
          ? { reconciliationActionId: reserved.reconciliation_action_id }
          : {}),
      };
    }
    if (reserved.work_status === "failed" || reserved.work_status === "canceled") {
      return {
        status: "terminal_failure" as const,
        reason: reserved.work_status,
      };
    }
    try {
      const completedStepResults = reserved.callback_results.flatMap((callback) =>
        callback.status === "completed" && callback.result
          ? [{ executorId: callback.executorId, result: callback.result }]
          : []);
      const failedCallback = reserved.callback_results.find(
        (callback) => callback.status === "failed" ||
          callback.status === "canceled"
      );
      if (failedCallback) {
        throw new Error(
          `Executor callback ${failedCallback.executorId} ${failedCallback.status}.`
        );
      }
      const completedBindings = completedStepResults.flatMap(({ result }) =>
        result.outputs ?? []) as BoundExecutorOutput[];
      let pendingExternalStep = false;
      for (const [index, planned] of executionPlan.entries()) {
        const callback = callbackFences[index]!;
        const durableStep = reserved.callback_results.find(
          (candidate) => candidate.executorId === planned.executor.id
        );
        if (durableStep?.status === "completed") {
          validateBoundExecutorOutputs(
            { ...workItem, requiredOutputs: planned.requiredOutputs },
            (durableStep.result?.outputs ?? []) as BoundExecutorOutput[]
          );
          continue;
        }
        if (durableStep?.status === "pending" && durableStep.jobIds.length > 0) {
          pendingExternalStep = true;
          continue;
        }
        const result = await planned.executor.execute({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          proposalActionId: action.id,
          approvalActionId: approval.approvalActionId,
          approvedMaxCostUsd: approval.approvedMaxCostUsd,
          rootRunId,
          proposal,
          workItem,
          requiredOutputs: planned.requiredOutputs,
          completedBindings,
          resolveCompletedBindings: async () =>
            deps.listCompletedBindings({
              projectId: input.projectId,
              executionReservationId: lease.reservationId,
            }) as Promise<readonly BoundExecutorOutput[]>,
          reserveBudget: (budget) =>
            deps.reserveChildBudget({
              projectId: input.projectId,
              executionReservationId: lease.reservationId,
              workItemId: workItem.workItemId,
              ...budget,
            }),
          fence: {
            executionReservationId: lease.reservationId,
            workReservationId: reserved.work_reservation_id,
            dispatchActionId,
            idempotencyKey:
              `${lease.reservationId}:${workItem.workItemId}:${planned.executor.id}`,
            leaseToken: lease.leaseToken,
            leaseGeneration: lease.leaseGeneration,
            callbackToken: callback.token,
            callbackGeneration: callback.descriptor.generation,
          },
        });
        lease = await deps.renewExecution({ projectId: input.projectId, lease });
        if (result.status === "blocked") {
          await deps.failWorkItem({
            projectId: input.projectId,
            lease,
            workItemId: workItem.workItemId,
            error: {
              kind: "blocked_precondition",
              precondition: result.precondition,
            },
          });
          return {
            status: "terminal_failure" as const,
            reason: "blocked_precondition" as const,
          };
        }
        if (result.status === "succeeded") {
          validateBoundExecutorOutputs(
            { ...workItem, requiredOutputs: planned.requiredOutputs },
            result.outputs
          );
          completedBindings.push(...result.outputs);
          const stepResult = {
            outputs: result.outputs,
            primitiveActionIds: result.primitiveActionIds,
            budgetReservationKeys: result.budgetReservationKeys,
            ...(result.childRunId ? { childRunId: result.childRunId } : {}),
            ...(result.reportActionId
              ? { reportActionId: result.reportActionId }
              : {}),
            ...(result.reconciliationActionId
              ? { reconciliationActionId: result.reconciliationActionId }
              : {}),
            ...(result.providerResult
              ? { providerResult: result.providerResult }
              : {}),
          };
          await deps.parkWorkItem({
            projectId: input.projectId,
            lease,
            workItemId: workItem.workItemId,
            completedCallbacks: [{
              executorId: callback.executor.id,
              tokenHash: callback.descriptor.tokenHash,
              generation: callback.descriptor.generation,
              result: stepResult,
            }],
            primitiveActionIds: result.primitiveActionIds,
            budgetReservationKeys: result.budgetReservationKeys,
            bindingResults: completedBindings,
          });
          completedStepResults.push({
            executorId: callback.executor.id,
            result: stepResult,
          });
          continue;
        }
        await deps.parkWorkItem({
          projectId: input.projectId,
          lease,
          workItemId: workItem.workItemId,
          acceptedCallbacks: [{
            executorId: callback.executor.id,
            tokenHash: callback.descriptor.tokenHash,
            generation: callback.descriptor.generation,
            jobIds: result.jobIds,
          }],
          primitiveActionIds: result.primitiveActionIds,
          budgetReservationKeys: result.budgetReservationKeys,
          bindingResults: completedBindings,
        });
        pendingExternalStep = true;
      }
      if (pendingExternalStep) {
        return { status: "parked" as const, reason: "accepted" as const };
      }
      const finalBindings = [...completedBindings].sort((left, right) =>
        left.ordinal - right.ordinal || left.bindingId.localeCompare(right.bindingId));
      validateBoundExecutorOutputs(workItem, finalBindings);
      const primitiveActionIds = completedStepResults.flatMap(({ result }) =>
        result.primitiveActionIds ?? []);
      const budgetReservationKeys = completedStepResults.flatMap(({ result }) =>
        result.budgetReservationKeys ?? []);
      const reconciliationActionIds = [...new Set(
        completedStepResults.flatMap(({ result }) =>
          result.reconciliationActionId ? [result.reconciliationActionId] : [])
      )];
      if (reconciliationActionIds.length > 1) {
        throw new Error("Executor steps returned conflicting reconciliation actions.");
      }
      await deps.completeWorkItem({
        projectId: input.projectId,
        lease,
        workItemId: workItem.workItemId,
        ...(reconciliationActionIds[0]
          ? { reconciliationActionId: reconciliationActionIds[0] }
          : {}),
        bindingResults: finalBindings,
        primitiveActionIds,
        budgetReservationKeys,
      });
      return {
        status: "completed" as const,
        outputs: finalBindings,
        reconciliationActionId: reconciliationActionIds[0],
      };
    } catch (error) {
      await deps.failWorkItem({
        projectId: input.projectId,
        lease,
        workItemId: workItem.workItemId,
        error: {
          kind: "executor_failed",
          message: error instanceof Error ? error.message : "Executor failed.",
        },
      });
      throw error;
    }
  }));
  clearInterval(heartbeat);
  if (heartbeatError) throw heartbeatError;
  const failures = settled.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  const results = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []);
  const terminalFailures = results.filter(
    (result) => result.status === "terminal_failure"
  );
  const reconciliationActionIds = results
    .filter((result) => result.status === "completed")
    .map((result) => result.reconciliationActionId)
    .filter((id): id is string => Boolean(id));
  const distinctReconciliationActionIds = [...new Set(reconciliationActionIds)];
  const executionActionId = deterministicUuid(
    "rerun-execution",
    lease.reservationId
  );
  if (
    failures.length > 0 ||
    terminalFailures.length > 0 ||
    distinctReconciliationActionIds.length > 1
  ) {
    await deps.finalizeExecution({
      projectId: input.projectId,
      lease,
      executionActionId,
      outcome: "failed",
      error: {
        kind: "executor_failed",
        failures: [
          ...failures.map((failure) =>
            failure.reason instanceof Error
              ? failure.reason.message
              : "Executor failed."),
          ...terminalFailures.map((failure) => failure.reason),
          ...(distinctReconciliationActionIds.length > 1
            ? ["conflicting reconciliation actions"]
            : []),
        ],
      },
    });
    return {
      actionId: action.id,
      reservationId: lease.reservationId,
      executionActionId,
      status: "failed" as const,
      replayed: false,
    };
  }
  if (results.some((result) => result.status === "parked")) {
    await deps.parkExecution({ projectId: input.projectId, lease });
    return {
      actionId: action.id,
      reservationId: lease.reservationId,
      status: "waiting" as const,
      replayed: false,
    };
  }
  const reconciliationActionId = distinctReconciliationActionIds[0] ??
    await deps.ensureReconciliation({
      projectId: input.projectId,
      proposalActionId: action.id,
      rootRunId,
      lease,
      reconciliationActionId: deterministicUuid(
        "rerun-reconciliation",
        lease.reservationId
      ),
    });
  await deps.finalizeExecution({
    projectId: input.projectId,
    lease,
    executionActionId,
    outcome: "applied",
    reconciliationActionId,
  });
  return {
    actionId: action.id,
    reservationId: lease.reservationId,
    executionActionId,
    status: "applied" as const,
    replayed: false,
  };
}
