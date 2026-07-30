import type {
  BoundRequiredOutput,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import {
  dispatchDomainRun,
  type DispatchDomainRunInput,
  type DomainRunDispatch,
} from "./domain-run-service";
import {
  AUDIO_FIT_RERUN_EXECUTOR_ID,
  AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
  AUDIO_REVISION_RERUN_EXECUTOR_ID,
  rerunChildBudgetReservationKey,
} from "./rerun-callback-fence";
import type {
  RerunExecutorContext,
  RerunKindExecutor,
} from "./rerun-executor-registry";
import { buildProposalDelegatedTask } from "@/lib/orchestrator-tools/delegate-domain";

type AudioWorkItem = Extract<RerunWorkItem, { owner: "audio" }>;

export interface AudioRerunExecutorDeps {
  dispatch(input: DispatchDomainRunInput): Promise<DomainRunDispatch>;
}

const defaultDeps: AudioRerunExecutorDeps = {
  dispatch: dispatchDomainRun,
};

function isAudioWorkItem(workItem: RerunWorkItem): workItem is AudioWorkItem {
  return workItem.owner === "audio" && workItem.kind === "revise_audio";
}

function subsetWorkItem(
  context: RerunExecutorContext
): AudioWorkItem {
  if (!isAudioWorkItem(context.workItem)) {
    throw new ApiError(
      "validation_failed",
      "Audio executor received non-Audio rerun work."
    );
  }
  return {
    ...context.workItem,
    requiredOutputs: [...context.requiredOutputs],
  };
}

function isSupportedAudioTarget(output: BoundRequiredOutput): boolean {
  if (output.kind === "audio_fit") {
    return output.target.kind === "beat";
  }
  return (
    output.target.kind === "project" ||
    output.target.kind === "beat" ||
    output.target.kind === "asset" ||
    output.target.kind === "timeline_item"
  );
}

function allocatedBudgetUsd(context: RerunExecutorContext): number {
  const billable = context.proposal.selectedWork
    .flatMap((work) => work.requiredOutputs)
    .filter((output) =>
      [
        "image",
        "poster",
        "anchor",
        "keyframe",
        "clip",
        "render",
        "audio_track",
      ].includes(output.kind)
    )
    .sort((left, right) =>
      left.ordinal - right.ordinal ||
      left.bindingId.localeCompare(right.bindingId)
    );
  if (billable.length === 0) return 0;
  const totalUnits = Math.round(context.approvedMaxCostUsd * 10_000);
  const quotient = Math.floor(totalUnits / billable.length);
  const remainder = totalUnits % billable.length;
  const selected = new Set(context.requiredOutputs.map((output) => output.bindingId));
  const units = billable.reduce((sum, output, index) =>
    sum + (selected.has(output.bindingId)
      ? quotient + (index < remainder ? 1 : 0)
      : 0), 0);
  return units / 10_000;
}

function pins(context: RerunExecutorContext) {
  return {
    proposalActionId: context.proposalActionId,
    executionReservationId: context.fence.executionReservationId,
    assets: context.proposal.pins.assets,
    selections: context.proposal.pins.selections,
    storySnapshots: context.proposal.pins.storySnapshots,
  };
}

function createExecutor(input: {
  id: string;
  supportsOutput(output: BoundRequiredOutput): boolean;
}, deps: AudioRerunExecutorDeps): RerunKindExecutor {
  return {
    id: input.id,
    supports(workItem, output) {
      return isAudioWorkItem(workItem) && input.supportsOutput(output);
    },
    async execute(context) {
      if (!context.approvalFingerprint) {
        throw new ApiError(
          "validation_failed",
          "Audio rerun execution is missing its persisted approval fingerprint."
        );
      }
      const workItem = subsetWorkItem(context);
      const unsupported = context.requiredOutputs.find(
        (output) => !isSupportedAudioTarget(output)
      );
      if (unsupported) {
        return {
          status: "blocked",
          precondition: {
            kind: "root_target_resolution",
            message:
              unsupported.kind === "audio_fit"
                ? "The Creative Director must resolve picture-fit work to one exact beat."
                : "The Creative Director must resolve this Audio request to an exact project, beat, asset, or timeline item.",
            target: unsupported.target,
          },
        };
      }
      const delegatedTask = buildProposalDelegatedTask({
        projectId: context.projectId,
        rootRunId: context.rootRunId,
        delegationActionId: context.fence.dispatchActionId,
        creatorMessageId: context.proposalActionId,
        proposalActionId: context.proposalActionId,
        approvalActionId: context.approvalActionId,
        executionReservationId: context.fence.executionReservationId,
        approvalFingerprint: context.approvalFingerprint,
        proposal: context.proposal,
        workItem,
      });
      const reservationKey = rerunChildBudgetReservationKey({
        executionReservationId: context.fence.executionReservationId,
        workItemId: workItem.workItemId,
        executorId: input.id,
      });
      const estimatedUsd = allocatedBudgetUsd(context);
      const budgetReservationKeys: string[] = [];
      if (estimatedUsd > 0) {
        await context.reserveBudget({
          actionId: context.fence.dispatchActionId,
          reservationKey,
          estimatedUsd,
        });
        budgetReservationKeys.push(reservationKey);
      }
      const task = {
        ...delegatedTask,
        approvalContext: {
          ...delegatedTask.approvalContext!,
          rerunCallback: {
            executorId: input.id,
            workItemId: workItem.workItemId,
            generation: context.fence.callbackGeneration,
            budgetReservationKeys,
          },
        },
      };
      const child = await deps.dispatch({
        projectId: context.projectId,
        domain: "audio",
        task,
        inputSummary: context.proposal.userFacingSummary,
        budgetUsd: estimatedUsd,
        origin: {
          kind: "creative_director",
          parentRunId: context.rootRunId,
          rootActionId: context.fence.dispatchActionId,
        },
        pins: pins(context),
        idempotencyKey: context.fence.idempotencyKey,
      });
      return {
        status: "accepted",
        childRunId: child.runId,
        // The lifecycle treats these as durable completion handles. Domain
        // finalization records the fenced callback using the same child id.
        jobIds: [`domain-run:${child.runId}`],
        primitiveActionIds: [],
        budgetReservationKeys,
      };
    },
  };
}

export function createAudioRerunExecutors(
  overrides: Partial<AudioRerunExecutorDeps> = {}
): RerunKindExecutor[] {
  const deps = { ...defaultDeps, ...overrides };
  return [
    createExecutor({
      id: AUDIO_PRODUCTION_RERUN_EXECUTOR_ID,
      supportsOutput: (output) =>
        output.kind === "audio_track" && output.target.kind !== "asset",
    }, deps),
    createExecutor({
      id: AUDIO_REVISION_RERUN_EXECUTOR_ID,
      supportsOutput: (output) =>
        output.kind === "audio_track" && output.target.kind === "asset",
    }, deps),
    createExecutor({
      id: AUDIO_FIT_RERUN_EXECUTOR_ID,
      supportsOutput: (output) => output.kind === "audio_fit",
    }, deps),
  ];
}
