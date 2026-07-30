import type { AuthContext } from "@/lib/api/v1/auth";
import {
  getWorkspaceRole,
  isWorkspaceAdminRole,
} from "@/lib/api/v1/store";
import type {
  OrchestratorRun,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";

const INSUFFICIENT_CREDITS_ERROR_KIND = "insufficient_credits";
const RETIRED_BOARD_FEEDBACK_TOOL = "board_feedback";

export interface OperatorDiagnosticsAuthorizationDeps {
  getWorkspaceRole: typeof getWorkspaceRole;
  nodeEnv: string | undefined;
}

export async function canViewOperatorDiagnostics(
  auth: AuthContext,
  deps: Partial<OperatorDiagnosticsAuthorizationDeps> = {}
): Promise<boolean> {
  const nodeEnv = deps.nodeEnv ?? process.env.NODE_ENV;
  if (auth.isLocal) return nodeEnv !== "production";
  if (auth.actor.type !== "user" || auth.actor.isAnonymous) return false;
  try {
    const role = await (deps.getWorkspaceRole ?? getWorkspaceRole)(
      auth.workspaceId,
      auth.actor.id
    );
    return isWorkspaceAdminRole(role);
  } catch {
    return false;
  }
}

/** Historical feedback actions stay readable but are not generation progress. */
export function generationActions(actions: RunActionSummary[]): RunActionSummary[] {
  return actions.filter((action) => action.tool !== RETIRED_BOARD_FEEDBACK_TOOL);
}

export function isInsufficientCreditsFailure(action: RunActionSummary | undefined): boolean {
  return action?.status === "failed" && action.error?.kind === INSUFFICIENT_CREDITS_ERROR_KIND;
}

export function runFailedForInsufficientCredits(run: OrchestratorRun): boolean {
  return run.status === "failed" && run.error?.kind === INSUFFICIENT_CREDITS_ERROR_KIND;
}
