import { ApiError } from "@/core/errors";
import {
  releaseOrchestratorBudget as realReleaseBudget,
  settleOrchestratorBudget as realSettleBudget,
} from "@/lib/api/v1/orchestrator-budget-controls";
import { updateAction as realUpdateAction } from "@/lib/api/v1/store";
import type {
  BoundRequiredOutput,
  PlannedStoryPointerMove,
  RerunTarget,
  RerunWorkItem,
  StorySnapshotPin,
} from "@popcorn/shared/rerun-proposal";
import type {
  BoundExecutorOutput,
  RerunExecutorContext,
  RerunExecutorResult,
  RerunKindExecutor,
} from "./rerun-executor-registry";

export interface RootStorySnapshotRequest {
  workspaceId: string;
  projectId: string;
  rootRunId: string;
  proposalActionId: string;
  approvalActionId: string;
  primitiveActionId: string;
  idempotencyKey: string;
  instruction: string;
  binding: BoundRequiredOutput;
  pointerMove: PlannedStoryPointerMove;
  pointerPin: StorySnapshotPin;
}

export interface RootProspectiveAsset {
  bindingId: string;
  assetId: string;
  kind: string;
  role: string;
  ordinal: number;
  target: RerunTarget;
}

export interface RootAssemblyRequest {
  workspaceId: string;
  projectId: string;
  rootRunId: string;
  proposalActionId: string;
  approvalActionId: string;
  primitiveActionId: string;
  idempotencyKey: string;
  instruction: string;
  binding: BoundRequiredOutput;
  prospectiveAssets: RootProspectiveAsset[];
  preservedAssetIds: string[];
}

export interface RootCritiqueRequest extends RootAssemblyRequest {
  prospectiveCutAssetId: string;
}

export interface RootServiceResult {
  assetId: string;
  intrinsicRole: string;
  /** Measured canonical service cost, including model/provider cost when used. */
  actualCostUsd: number;
  /**
   * Optional inert successor proposal. It remains proposed; this executor must
   * never approve or execute it recursively.
   */
  followupProposalActionId?: string;
}

export interface RootRerunExecutorServices {
  stageStorySnapshot(input: RootStorySnapshotRequest): Promise<RootServiceResult>;
  assembleProspectiveCut(input: RootAssemblyRequest): Promise<RootServiceResult>;
  critiqueProspectiveCut(input: RootCritiqueRequest): Promise<RootServiceResult>;
  estimateCritiqueUsd(input: RootCritiqueRequest): number;
  updateAction: typeof realUpdateAction;
  settleBudget: typeof realSettleBudget;
  releaseBudget: typeof realReleaseBudget;
}

type RootWorkItem = Extract<RerunWorkItem, { owner: "creative_director" }>;

function rootWork(
  context: RerunExecutorContext,
  kind: RootWorkItem["kind"],
  outputKind: string
): { workItem: RootWorkItem; binding: BoundRequiredOutput } {
  if (
    context.workItem.owner !== "creative_director" ||
    context.workItem.kind !== kind
  ) {
    throw new ApiError("validation_failed", `Root ${kind} executor received foreign work.`);
  }
  if (
    context.requiredOutputs.length !== 1 ||
    context.requiredOutputs[0]?.kind !== outputKind
  ) {
    throw new ApiError(
      "validation_failed",
      `Root ${kind} executor requires exactly one ${outputKind} binding.`
    );
  }
  return {
    workItem: context.workItem,
    binding: context.requiredOutputs[0],
  };
}

function canonicalTarget(target: RerunTarget): string {
  return JSON.stringify(target, Object.keys(target).sort());
}

function assertCompletedBinding(
  expected: BoundRequiredOutput,
  actual: BoundExecutorOutput
): void {
  if (
    actual.bindingId !== expected.bindingId ||
    actual.workItemId !== expected.workItemId ||
    actual.kind !== expected.kind ||
    actual.role !== expected.role ||
    actual.ordinal !== expected.ordinal ||
    canonicalTarget(actual.target) !== canonicalTarget(expected.target)
  ) {
    throw new ApiError(
      "validation_failed",
      `Prospective output ${actual.bindingId} is outside the approved proposal.`
    );
  }
}

async function completedProspectiveAssets(
  context: RerunExecutorContext
): Promise<Map<string, RootProspectiveAsset>> {
  const expected = new Map(
    context.proposal.selectedWork.flatMap((work) =>
      work.requiredOutputs.map((output) => [output.bindingId, output] as const)
    )
  );
  const resolved = [
    ...context.completedBindings,
    ...await context.resolveCompletedBindings(),
  ];
  const completed = new Map<string, RootProspectiveAsset>();
  for (const output of resolved) {
    const approved = expected.get(output.bindingId);
    if (!approved) {
      throw new ApiError(
        "validation_failed",
        `Completed binding ${output.bindingId} was not approved.`
      );
    }
    assertCompletedBinding(approved, output);
    const prior = completed.get(output.bindingId);
    if (prior && prior.assetId !== output.assetId) {
      throw new ApiError(
        "idempotency_conflict",
        `Completed binding ${output.bindingId} changed assets.`
      );
    }
    completed.set(output.bindingId, {
      bindingId: output.bindingId,
      assetId: output.assetId,
      kind: output.kind,
      role: output.role,
      ordinal: output.ordinal,
      target: output.target,
    });
  }
  return completed;
}

function storyPointer(
  context: RerunExecutorContext,
  binding: BoundRequiredOutput
): { move: PlannedStoryPointerMove; pin: StorySnapshotPin } {
  const moves = context.proposal.plannedStoryPointerMoves.filter(
    (move) => move.bindingId === binding.bindingId
  );
  if (moves.length !== 1) {
    throw new ApiError(
      "validation_failed",
      "Story snapshot binding must own one exact prospective pointer move."
    );
  }
  const move = moves[0];
  const targetMatches =
    (binding.target.kind === "project" && move.rowKind === "story_blueprint") ||
    (
      binding.target.kind === "storyboard" &&
      move.rowKind === "storyboard" &&
      move.rowId === binding.target.storyboardId
    ) ||
    (
      binding.target.kind === "scene" &&
      move.rowKind === "story_scene" &&
      move.rowId === binding.target.sceneId
    ) ||
    (
      binding.target.kind === "beat" &&
      move.rowKind === "story_beat" &&
      move.rowId === binding.target.beatId
    );
  if (!targetMatches) {
    throw new ApiError(
      "validation_failed",
      "Story snapshot pointer does not match its approved stable target."
    );
  }
  const pin = context.proposal.pins.storySnapshots.find(
    (candidate) =>
      candidate.rowKind === move.rowKind &&
      candidate.rowId === move.rowId &&
      candidate.expectedSnapshotAssetId === move.expectedSnapshotAssetId
  );
  if (!pin) {
    throw new ApiError(
      "stale_proposal",
      "Story snapshot pointer is not backed by its approved freshness pin."
    );
  }
  return { move, pin };
}

function requiredAssemblyBindings(
  context: RerunExecutorContext
): BoundRequiredOutput[] {
  return context.proposal.selectedWork.flatMap((work) =>
    work.workItemId === context.workItem.workItemId ||
      work.kind === "critique_cut"
      ? []
      : work.requiredOutputs
  );
}

function prospectiveCut(
  context: RerunExecutorContext,
  completed: Map<string, RootProspectiveAsset>
): string | null {
  const plannedCuts = context.proposal.selectedWork
    .filter((work) => work.kind === "reassemble_cut")
    .flatMap((work) => work.requiredOutputs)
    .filter((output) => output.kind === "composite");
  if (plannedCuts.length > 0) {
    if (plannedCuts.length !== 1) {
      throw new ApiError(
        "validation_failed",
        "Whole-cut critique requires one approved composite binding."
      );
    }
    return completed.get(plannedCuts[0].bindingId)?.assetId ?? null;
  }
  const assetTarget = context.workItem.targets.find(
    (target): target is Extract<RerunTarget, { kind: "asset" }> =>
      target.kind === "asset"
  );
  if (assetTarget) {
    return context.proposal.pins.assets.some(
      (pin) => pin.assetId === assetTarget.assetId
    )
      ? assetTarget.assetId
      : null;
  }
  const activeCutId = context.proposal.pins.selections.find(
    (pin) => pin.slotOwnerLineageId === null && pin.slotRole === "cut"
  )?.expectedActiveAssetId ?? null;
  return activeCutId && context.proposal.pins.assets.some(
    (pin) => pin.assetId === activeCutId
  )
    ? activeCutId
    : null;
}

function blocked(
  kind: string,
  message: string,
  target: RerunTarget
): RerunExecutorResult {
  return { status: "blocked", precondition: { kind, message, target } };
}

function budgetKey(context: RerunExecutorContext, suffix: string): string {
  return `rerun-root:${suffix}:${context.fence.workReservationId}:${context.fence.callbackGeneration}`;
}

function measuredCost(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ApiError("validation_failed", "Root service returned an invalid actual cost.");
  }
  return Number(value.toFixed(4));
}

async function executeService(input: {
  context: RerunExecutorContext;
  suffix: string;
  estimatedUsd: number;
  releaseOnFailure: boolean;
  binding: BoundRequiredOutput;
  services: RootRerunExecutorServices;
  run(): Promise<RootServiceResult>;
}): Promise<RerunExecutorResult> {
  const reservationKey = budgetKey(input.context, input.suffix);
  await input.context.reserveBudget({
    actionId: input.context.fence.dispatchActionId,
    reservationKey,
    estimatedUsd: input.estimatedUsd,
  });
  let result: RootServiceResult;
  try {
    result = await input.run();
  } catch (error) {
    if (input.releaseOnFailure) {
      await input.services.releaseBudget({
        projectId: input.context.projectId,
        reservationKey,
        reason: `root_${input.suffix}_failed_before_completion`,
      });
    }
    throw error;
  }
  const actualUsd = measuredCost(result.actualCostUsd);
  if (actualUsd > input.estimatedUsd) {
    throw new ApiError(
      "budget_exceeded",
      "Root service actual cost exceeded its approved child reservation."
    );
  }
  await input.services.updateAction(input.context.fence.dispatchActionId, {
    status: "applied",
    outputAssetIds: [result.assetId],
  });
  await input.services.settleBudget({
    projectId: input.context.projectId,
    reservationKey,
    actualUsd,
  });
  return {
    status: "succeeded",
    outputs: [{
      ...input.binding,
      assetId: result.assetId,
      intrinsicRole: result.intrinsicRole,
    }],
    primitiveActionIds: [
      input.context.fence.dispatchActionId,
      ...(result.followupProposalActionId
        ? [result.followupProposalActionId]
        : []),
    ],
    budgetReservationKeys: [reservationKey],
  };
}

function storyExecutor(services: RootRerunExecutorServices): RerunKindExecutor {
  return {
    id: "root-story-snapshot.v1",
    supports: (work, output) =>
      work.owner === "creative_director" &&
      work.kind === "revise_story" &&
      output.kind === "story_snapshot",
    async execute(context) {
      const { binding } = rootWork(context, "revise_story", "story_snapshot");
      const pointer = storyPointer(context, binding);
      return executeService({
        context,
        suffix: "story",
        estimatedUsd: 0,
        releaseOnFailure: true,
        binding,
        services,
        run: () => services.stageStorySnapshot({
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          rootRunId: context.rootRunId,
          proposalActionId: context.proposalActionId,
          approvalActionId: context.approvalActionId,
          primitiveActionId: context.fence.dispatchActionId,
          idempotencyKey: context.fence.idempotencyKey,
          instruction: context.proposal.userIntent,
          binding,
          pointerMove: pointer.move,
          pointerPin: pointer.pin,
        }),
      });
    },
  };
}

function assemblyExecutor(services: RootRerunExecutorServices): RerunKindExecutor {
  return {
    id: "root-prospective-assembly.v1",
    supports: (work, output) =>
      work.owner === "creative_director" &&
      work.kind === "reassemble_cut" &&
      output.kind === "composite",
    async execute(context) {
      const { binding } = rootWork(context, "reassemble_cut", "composite");
      const completed = await completedProspectiveAssets(context);
      const required = requiredAssemblyBindings(context);
      const missing = required.filter((output) => !completed.has(output.bindingId));
      if (missing.length > 0) {
        return blocked(
          "prospective_bindings_incomplete",
          `Assembly is waiting for approved bindings: ${missing.map((o) => o.bindingId).join(", ")}.`,
          binding.target
        );
      }
      const prospectiveAssets = required.map(
        (output) => completed.get(output.bindingId)!
      );
      const pinnedAssets = new Set(
        context.proposal.pins.assets.map((pin) => pin.assetId)
      );
      if (
        context.proposal.preservedAssetIds.some(
          (assetId) => !pinnedAssets.has(assetId)
        )
      ) {
        throw new ApiError(
          "stale_proposal",
          "Assembly preservation set is missing an approved asset pin."
        );
      }
      return executeService({
        context,
        suffix: "assembly",
        estimatedUsd: 0,
        releaseOnFailure: true,
        binding,
        services,
        run: () => services.assembleProspectiveCut({
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          rootRunId: context.rootRunId,
          proposalActionId: context.proposalActionId,
          approvalActionId: context.approvalActionId,
          primitiveActionId: context.fence.dispatchActionId,
          idempotencyKey: context.fence.idempotencyKey,
          instruction: context.proposal.userIntent,
          binding,
          prospectiveAssets,
          preservedAssetIds: context.proposal.preservedAssetIds,
        }),
      });
    },
  };
}

function critiqueExecutor(services: RootRerunExecutorServices): RerunKindExecutor {
  return {
    id: "root-prospective-critique.v1",
    supports: (work, output) =>
      work.owner === "creative_director" &&
      work.kind === "critique_cut" &&
      output.kind === "critique",
    async execute(context) {
      const { binding } = rootWork(context, "critique_cut", "critique");
      const completed = await completedProspectiveAssets(context);
      const cutAssetId = prospectiveCut(context, completed);
      if (!cutAssetId) {
        return blocked(
          "prospective_cut_incomplete",
          "Whole-cut critique is waiting for its approved prospective composite.",
          binding.target
        );
      }
      const prospectiveAssets = [...completed.values()];
      const request: RootCritiqueRequest = {
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        rootRunId: context.rootRunId,
        proposalActionId: context.proposalActionId,
        approvalActionId: context.approvalActionId,
        primitiveActionId: context.fence.dispatchActionId,
        idempotencyKey: context.fence.idempotencyKey,
        instruction: context.proposal.userIntent,
        binding,
        prospectiveAssets,
        preservedAssetIds: context.proposal.preservedAssetIds,
        prospectiveCutAssetId: cutAssetId,
      };
      return executeService({
        context,
        suffix: "critique",
        estimatedUsd: measuredCost(services.estimateCritiqueUsd(request)),
        // A model-backed critic may spend before surfacing a failure. Preserve
        // its reservation for retry/recovery settlement.
        releaseOnFailure: false,
        binding,
        services,
        run: () => services.critiqueProspectiveCut(request),
      });
    },
  };
}

/**
 * Inert adapter factory. PR 5 supplies reviewed canonical services and registers
 * these executors only alongside atomic selection/story-pointer application.
 */
export function createRootRerunExecutors(
  services: RootRerunExecutorServices
): RerunKindExecutor[] {
  return [
    storyExecutor(services),
    assemblyExecutor(services),
    critiqueExecutor(services),
  ];
}
