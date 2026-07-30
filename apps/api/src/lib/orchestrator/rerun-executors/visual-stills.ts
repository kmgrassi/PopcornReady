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
} from "@/lib/orchestrator/domain-run-service";
import { buildProposalDelegatedTask } from "@/lib/orchestrator-tools/delegate-domain";
import type {
  RerunExecutorContext,
  RerunKindExecutor,
} from "../rerun-executor-registry";

export const VISUAL_STILL_OUTPUT_KINDS = [
  "image",
  "poster",
  "anchor",
  "storyboard",
  "keyframe",
] as const;

const outputKinds = new Set<string>(VISUAL_STILL_OUTPUT_KINDS);
type VisualWorkItem = Extract<RerunWorkItem, { owner: "visuals" }>;

export interface VisualStillExecutorDeps {
  dispatch(input: DispatchDomainRunInput): Promise<DomainRunDispatch>;
}

const defaultDeps: VisualStillExecutorDeps = {
  dispatch: dispatchDomainRun,
};

function isVisualWorkItem(workItem: RerunWorkItem): workItem is VisualWorkItem {
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

function subsetWorkItem(context: RerunExecutorContext): VisualWorkItem {
  if (!isVisualWorkItem(context.workItem)) {
    throw new ApiError(
      "validation_failed",
      "Visual-still executor received non-Visuals rerun work."
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

function supportedTarget(output: BoundRequiredOutput): boolean {
  return (
    output.target.kind === "project" ||
    output.target.kind === "storyboard" ||
    output.target.kind === "scene" ||
    output.target.kind === "beat" ||
    output.target.kind === "panel" ||
    output.target.kind === "asset" ||
    output.target.kind === "selection"
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

export function createVisualStillRerunExecutor(
  overrides: Partial<VisualStillExecutorDeps> = {}
): RerunKindExecutor {
  const deps = { ...defaultDeps, ...overrides };
  return {
    id: "visual-stills.v1",
    supports: (workItem, output) =>
      isVisualWorkItem(workItem) && outputKinds.has(output.kind),
    async execute(context) {
      if (!context.approvalFingerprint) {
        throw new ApiError(
          "validation_failed",
          "Visual-still execution is missing its persisted approval fingerprint."
        );
      }
      const workItem = subsetWorkItem(context);
      const unsupported = context.requiredOutputs.find(
        (output) => !outputKinds.has(output.kind) || !supportedTarget(output)
      );
      if (unsupported) {
        return {
          status: "blocked",
          precondition: {
            kind: "root_target_resolution",
            message:
              "The Creative Director must resolve still work to an exact project, story, beat, panel, asset, or selection target.",
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
            executorId: "visual-stills.v1",
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
