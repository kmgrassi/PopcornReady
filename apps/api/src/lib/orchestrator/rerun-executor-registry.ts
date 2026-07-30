import type {
  BoundRequiredOutput,
  RerunProposalV2,
  RerunTarget,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";

export interface BoundExecutorOutput extends BoundRequiredOutput {
  assetId: string;
  intrinsicRole: string;
}

export interface RerunExecutorFence {
  executionReservationId: string;
  workReservationId: string;
  dispatchActionId: string;
  idempotencyKey: string;
  leaseToken: string;
  leaseGeneration: number;
  callbackToken: string;
  callbackGeneration: number;
}

export interface RerunExecutorContext {
  workspaceId: string;
  projectId: string;
  actorId: string;
  proposalActionId: string;
  approvalActionId: string;
  approvedMaxCostUsd: number;
  rootRunId: string;
  proposal: Extract<RerunProposalV2, { outcome: "revision" }>;
  workItem: RerunWorkItem;
  requiredOutputs: readonly BoundRequiredOutput[];
  completedBindings: readonly BoundExecutorOutput[];
  resolveCompletedBindings(): Promise<readonly BoundExecutorOutput[]>;
  reserveBudget(input: {
    actionId: string;
    childRunId?: string;
    jobId?: string;
    reservationKey: string;
    estimatedUsd: number;
  }): Promise<{ reservationId: string; replayed: boolean }>;
  fence: RerunExecutorFence;
}

export interface RerunExecutorSucceeded {
  status: "succeeded";
  outputs: BoundExecutorOutput[];
  primitiveActionIds: string[];
  budgetReservationKeys: string[];
  /** Durable inert executor metadata; never treated as output causation. */
  providerResult?: Record<string, unknown>;
  childRunId?: string;
  reportActionId?: string;
  reconciliationActionId?: string;
}

export interface RerunExecutorAccepted {
  status: "accepted";
  childRunId?: string;
  jobIds: string[];
  primitiveActionIds: string[];
  budgetReservationKeys: string[];
}

export interface RerunExecutorBlocked {
  status: "blocked";
  precondition: {
    kind: string;
    message: string;
    target: RerunTarget;
  };
}

export type RerunExecutorResult =
  | RerunExecutorSucceeded
  | RerunExecutorAccepted
  | RerunExecutorBlocked;

export interface RerunKindExecutor {
  readonly id: string;
  supports(
    workItem: RerunWorkItem,
    requiredOutput: BoundRequiredOutput
  ): boolean;
  execute(context: RerunExecutorContext): Promise<RerunExecutorResult>;
}

/**
 * PR 2 production registry is deliberately inert. PRs 3A/3B/3C may implement
 * adapters behind this interface, but PR 5 owns their production activation.
 */
export class RerunExecutorRegistry {
  private readonly executors = new Map<string, RerunKindExecutor>();

  constructor(executors: readonly RerunKindExecutor[] = []) {
    for (const executor of executors) {
      if (this.executors.has(executor.id)) {
        throw new Error(`Duplicate rerun executor registration: ${executor.id}`);
      }
      this.executors.set(executor.id, executor);
    }
  }

  preflight(work: readonly RerunWorkItem[]): void {
    const unavailable = work.flatMap((item) =>
      item.requiredOutputs.flatMap((output) => {
        const matches = [...this.executors.values()].filter((executor) =>
          executor.supports(item, output));
        return matches.length === 1
          ? []
          : [{
              binding: `${item.kind}:${output.kind}:${output.bindingId}`,
              matches: matches.map((executor) => executor.id),
            }];
      }));
    if (unavailable.length > 0) {
      throw new ApiError(
        "coverage_unavailable",
        "Selective-regeneration execution coverage is not active for this proposal.",
        { bindings: unavailable }
      );
    }
  }

  plan(workItem: RerunWorkItem): Array<{
    executor: RerunKindExecutor;
    requiredOutputs: BoundRequiredOutput[];
  }> {
    const groups = new Map<RerunKindExecutor, BoundRequiredOutput[]>();
    for (const output of workItem.requiredOutputs) {
      const matches = [...this.executors.values()].filter((executor) =>
        executor.supports(workItem, output));
      if (matches.length !== 1) {
        throw new ApiError(
          "coverage_unavailable",
          matches.length === 0
            ? `No active executor for ${workItem.kind}:${output.kind}.`
            : `Multiple executors claim ${workItem.kind}:${output.kind}.`
        );
      }
      const executor = matches[0]!;
      groups.set(executor, [...(groups.get(executor) ?? []), output]);
    }
    return [...groups].map(([executor, requiredOutputs]) => ({
      executor,
      requiredOutputs,
    }));
  }
}

export const productionRerunExecutorRegistry = new RerunExecutorRegistry();

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function validateBoundExecutorOutputs(
  workItem: RerunWorkItem,
  outputs: readonly BoundExecutorOutput[]
): void {
  if (outputs.length !== workItem.requiredOutputs.length) {
    throw new ApiError("validation_failed", "Executor returned the wrong bound output count.");
  }
  const byBinding = new Map(outputs.map((output) => [output.bindingId, output]));
  if (byBinding.size !== outputs.length) {
    throw new ApiError("validation_failed", "Executor returned a binding more than once.");
  }
  for (const expected of workItem.requiredOutputs) {
    const actual = byBinding.get(expected.bindingId);
    if (
      !actual ||
      actual.workItemId !== expected.workItemId ||
      actual.kind !== expected.kind ||
      actual.role !== expected.role ||
      actual.ordinal !== expected.ordinal ||
      canonicalJson(actual.target) !== canonicalJson(expected.target)
    ) {
      throw new ApiError(
        "validation_failed",
        `Executor output is not a member of work item ${workItem.workItemId}.`
      );
    }
  }
}

/** Deterministic test-only adapter. It has no provider, job, or spend hook. */
export function createFakeRerunExecutor(input: {
  id?: string;
  kind: RerunWorkItem["kind"];
  outputKinds?: readonly BoundRequiredOutput["kind"][];
  execute: RerunKindExecutor["execute"];
}): RerunKindExecutor {
  const outputKinds = new Set(input.outputKinds ?? []);
  return {
    id: input.id ?? `fake:${input.kind}:${[...outputKinds].join(",") || "*"}`,
    supports: (workItem, output) =>
      workItem.kind === input.kind &&
      (outputKinds.size === 0 || outputKinds.has(output.kind)),
    execute: input.execute,
  };
}
