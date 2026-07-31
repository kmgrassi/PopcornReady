import type { BoardRevisionTarget } from "@popcorn/shared/v1/types";

export interface StartedExecutionTarget {
  actionId: string;
  target: BoardRevisionTarget;
}

export function settledExecutionTarget(
  actionId: string,
  startedExecution: StartedExecutionTarget | null,
  currentTarget: BoardRevisionTarget | null
) {
  return startedExecution?.actionId === actionId
    ? startedExecution.target
    : currentTarget;
}
