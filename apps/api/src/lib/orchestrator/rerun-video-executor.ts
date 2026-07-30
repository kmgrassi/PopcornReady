import type {
  BoundRequiredOutput,
  RerunTarget,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import { buildProposalDelegatedTask } from "@/lib/orchestrator-tools/delegate-domain";
import {
  dispatchDomainRun,
  type DispatchDomainRunInput,
  type DomainRunDispatch,
} from "./domain-run-service";
import type {
  RerunExecutorContext,
  RerunKindExecutor,
} from "./rerun-executor-registry";

type VisualsWorkItem = Extract<RerunWorkItem, { owner: "visuals" }>;

export const VIDEO_BEAT_CLIP_RERUN_EXECUTOR_ID =
  "rerun:video-beat-clip:v1";
export const VIDEO_EDIT_RERUN_EXECUTOR_ID = "rerun:video-edit:v1";
export const VIDEO_STANDALONE_RERUN_EXECUTOR_ID =
  "rerun:video-standalone:v1";

export interface VideoRerunExecutorDeps {
  dispatch(input: DispatchDomainRunInput): Promise<DomainRunDispatch>;
}

const defaultDeps: VideoRerunExecutorDeps = {
  dispatch: dispatchDomainRun,
};

function isVisualsWorkItem(
  workItem: RerunWorkItem
): workItem is VisualsWorkItem {
  return workItem.owner === "visuals" && workItem.kind === "revise_visuals";
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

function subsetWorkItem(context: RerunExecutorContext): VisualsWorkItem {
  if (!isVisualsWorkItem(context.workItem)) {
    throw new ApiError(
      "validation_failed",
      "Video executor received non-Visuals rerun work."
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

function isBeatClipTarget(output: BoundRequiredOutput): boolean {
  return (
    output.kind === "clip" &&
    (output.target.kind === "beat" ||
      (output.target.kind === "selection" &&
        output.target.slotRole.startsWith("beat_clip:")))
  );
}

function isVideoEditTarget(output: BoundRequiredOutput): boolean {
  return output.kind === "clip" && output.target.kind === "asset";
}

function isStandaloneVideoTarget(output: BoundRequiredOutput): boolean {
  return output.kind === "clip" && output.target.kind === "project";
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

function createExecutor(
  input: {
    id: string;
    supportsOutput(output: BoundRequiredOutput): boolean;
    blockedMessage: string;
  },
  deps: VideoRerunExecutorDeps
): RerunKindExecutor {
  return {
    id: input.id,
    supports(workItem, output) {
      return isVisualsWorkItem(workItem) && input.supportsOutput(output);
    },
    async execute(context) {
      if (!context.approvalFingerprint) {
        throw new ApiError(
          "validation_failed",
          "Video rerun execution is missing its persisted approval fingerprint."
        );
      }

      const workItem = subsetWorkItem(context);
      const unsupported = context.requiredOutputs.find(
        (output) => !input.supportsOutput(output)
      );
      if (unsupported) {
        return {
          status: "blocked",
          precondition: {
            kind: "root_target_resolution",
            message: input.blockedMessage,
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
        domain: "visuals",
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
        jobIds: [`domain-run:${child.runId}`],
        primitiveActionIds: [],
        budgetReservationKeys: [],
      };
    },
  };
}

export function createVideoRerunExecutors(
  overrides: Partial<VideoRerunExecutorDeps> = {}
): RerunKindExecutor[] {
  const deps = { ...defaultDeps, ...overrides };
  return [
    createExecutor(
      {
        id: VIDEO_BEAT_CLIP_RERUN_EXECUTOR_ID,
        supportsOutput: isBeatClipTarget,
        blockedMessage:
          "The Creative Director must resolve beat clip work to one exact beat or beat_clip selection.",
      },
      deps
    ),
    createExecutor(
      {
        id: VIDEO_EDIT_RERUN_EXECUTOR_ID,
        supportsOutput: isVideoEditTarget,
        blockedMessage:
          "The Creative Director must resolve a content-aware video edit to one exact pinned source asset.",
      },
      deps
    ),
    createExecutor(
      {
        id: VIDEO_STANDALONE_RERUN_EXECUTOR_ID,
        supportsOutput: isStandaloneVideoTarget,
        blockedMessage:
          "The Creative Director must resolve standalone video generation to the exact project target.",
      },
      deps
    ),
  ];
}
