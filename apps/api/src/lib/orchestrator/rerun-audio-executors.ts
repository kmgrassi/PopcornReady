import type {
  BoundRequiredOutput,
  RerunTarget,
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

function targetIdentity(target: RerunTarget): string {
  switch (target.kind) {
    case "project":
      return `project:${target.projectId}`;
    case "storyboard":
      return `storyboard:${target.storyboardId}`;
    case "scene":
      return `scene:${target.sceneId}`;
    case "beat":
      return `beat:${target.beatId}`;
    case "panel":
      return `panel:${target.panelId}`;
    case "asset":
      return `asset:${target.assetId}`;
    case "lineage":
      return `lineage:${target.lineageId}`;
    case "timeline_item":
      return `timeline_item:${target.timelineItemId}`;
    case "export":
      return `export:${target.exportId}`;
    case "selection":
      return `selection:${target.slotOwnerLineageId ?? "project"}:${target.slotRole}`;
    case "transcript_segment":
      return `transcript_segment:${target.transcriptSegmentId}`;
  }
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
  const targets = context.requiredOutputs.flatMap((output, index, outputs) =>
    outputs.findIndex(
      (candidate) =>
        targetIdentity(candidate.target) === targetIdentity(output.target)
    ) === index
      ? [output.target]
      : []
  );
  return {
    ...context.workItem,
    targets,
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
      const task = {
        ...delegatedTask,
        approvalContext: {
          ...delegatedTask.approvalContext!,
          rerunCallback: {
            executorId: input.id,
            workItemId: workItem.workItemId,
            generation: context.fence.callbackGeneration,
          },
        },
      };
      const child = await deps.dispatch({
        projectId: context.projectId,
        domain: "audio",
        task,
        inputSummary: context.proposal.userFacingSummary,
        budgetUsd: context.approvedMaxCostUsd,
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
        budgetReservationKeys: [],
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
