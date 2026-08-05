import type { GenerationRun } from "@popcorn/shared/v1/types";

type RunError = GenerationRun["error"];

export type TerminalRecoveryMode =
  | "continue_after_credit"
  | "request_changes"
  | "none";

export function terminalRecoveryMode(
  error: RunError,
  hasCreditRecovery: boolean,
): TerminalRecoveryMode {
  if (error?.code === "insufficient_credits" && hasCreditRecovery) {
    return "continue_after_credit";
  }
  return error?.retryable ? "request_changes" : "none";
}
