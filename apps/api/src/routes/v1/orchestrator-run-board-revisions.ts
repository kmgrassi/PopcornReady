import { ApiError } from "@/core/errors";
import type { AuthContext } from "@/lib/api/v1/auth";
import {
  getWorkspaceRole,
  isWorkspaceAdminRole,
} from "@/lib/api/v1/store";
import { parseBrief } from "@/lib/api/v1/schemas";
import type {
  BoardRevisionTarget,
} from "@popcorn/shared/v1/types";
import type {
  OrchestratorRun,
  OrchestratorRunGate,
  RunActionSummary,
  UpdateOrchestratorRunPatch,
} from "@/lib/api/v1/orchestrator-store";

export const BOARD_FEEDBACK_TOOL = "board_feedback";
const INSUFFICIENT_CREDITS_ERROR_KIND = "insufficient_credits";
const BOARD_REVISION_SCOPES = ["concept", "brief", "script", "board", "tile", "asset"] as const;
const ASSET_USES = [
  "primary_footage",
  "b_roll",
  "character_reference",
  "style_reference",
  "location_reference",
  "logo_or_brand",
  "music",
  "voiceover",
  "dialogue",
  "sound_effect",
  "title_or_graphic",
] as const;

/**
 * Board feedback is an explicit request to re-enter the agent loop. Terminal
 * runs are therefore resumable here; only a live or approval-waiting run can
 * keep its current status.
 */
export function boardRevisionRequiresRunResume(status: OrchestratorRun["status"]): boolean {
  return status !== "running" && status !== "waiting";
}

export function boardRevisionResumePatch(run: OrchestratorRun): UpdateOrchestratorRunPatch {
  return {
    status: "running",
    startedAt: run.startedAt ?? new Date().toISOString(),
    clearCompletedAt: true,
    clearError: true,
  };
}

export function boardRevisionGateIdsToReset(
  run: OrchestratorRun,
  gates: OrchestratorRunGate[]
): string[] {
  if (run.status !== "canceled") return [];
  return gates.filter((gate) => gate.status === "reached").map((gate) => gate.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface OperatorDiagnosticsAuthorizationDeps {
  getWorkspaceRole: typeof getWorkspaceRole;
  nodeEnv: string | undefined;
}

export async function canViewOperatorDiagnostics(
  auth: AuthContext,
  deps: Partial<OperatorDiagnosticsAuthorizationDeps> = {}
): Promise<boolean> {
  const nodeEnv = deps.nodeEnv ?? process.env.NODE_ENV;
  if (auth.isLocal) {
    // The deterministic local identity is the development workspace owner.
    // Never let a production AUTH_MODE misconfiguration disclose diagnostics.
    return nodeEnv !== "production";
  }
  if (auth.actor.type !== "user" || auth.actor.isAnonymous) return false;
  try {
    const role = await (deps.getWorkspaceRole ?? getWorkspaceRole)(
      auth.workspaceId,
      auth.actor.id
    );
    return isWorkspaceAdminRole(role);
  } catch {
    // Diagnostics are additive. Membership lookup failure must fail closed
    // without making creator-safe generation status unavailable.
    return false;
  }
}
function optionalStringField(
  input: Record<string, unknown>,
  key: keyof BoardRevisionTarget
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseBoardRevisionTarget(body: unknown, runId: string): BoardRevisionTarget {
  if (!isRecord(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const target = isRecord(body.target) ? body.target : {};
  const scope =
    typeof target.scope === "string" &&
    BOARD_REVISION_SCOPES.includes(target.scope as (typeof BOARD_REVISION_SCOPES)[number])
      ? (target.scope as BoardRevisionTarget["scope"])
      : undefined;
  if (!scope) {
    const expected = BOARD_REVISION_SCOPES.join(", ");
    throw new ApiError(
      "validation_failed",
      `target.scope must be ${expected}.`,
      {
        fields: [
          {
            path: "target.scope",
            message: `Expected ${expected}.`,
          },
        ],
      }
    );
  }

  const parsed: BoardRevisionTarget = { scope, runId };
  for (const key of [
    "stageId",
    "itemId",
    "fieldId",
    "currentValue",
    "storyboardId",
    "sceneId",
    "beatId",
    "panelId",
    "keyframeAssetId",
    "clipAssetId",
    "assetId",
    "artifactId",
    "label",
  ] as const) {
    const value = optionalStringField(target, key);
    if (value) parsed[key] = value;
  }
  const targetAssetUse = optionalStringField(target, "targetAssetUse");
  if (targetAssetUse) {
    if (!ASSET_USES.includes(targetAssetUse as (typeof ASSET_USES)[number])) {
      throw new ApiError("validation_failed", "target.targetAssetUse is not supported.", {
        fields: [{ path: "target.targetAssetUse", message: "Unknown asset use." }],
      });
    }
    parsed.targetAssetUse = targetAssetUse as BoardRevisionTarget["targetAssetUse"];
  }
  if (scope === "asset" && !parsed.assetId && !parsed.clipAssetId && !parsed.keyframeAssetId) {
    throw new ApiError("validation_failed", "Asset revisions require an asset id.", {
      fields: [{ path: "target.assetId", message: "Required for target.scope=asset." }],
    });
  }
  if (isRecord(target.currentBrief)) {
    parsed.currentBrief = parseBrief(target.currentBrief, "target.currentBrief");
  }
  return parsed;
}

function parseGenerationModel(value: unknown) {
  if (!isRecord(value)) return undefined;
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!provider || !model) return undefined;
  return { provider, model };
}
export function parseBoardRevisionRequest(body: unknown, runId: string) {
  if (!isRecord(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    throw new ApiError("validation_failed", "A feedback message is required.", {
      fields: [{ path: "message", message: "Required." }],
    });
  }
  return {
    message,
    target: parseBoardRevisionTarget(body, runId),
    generationModel: parseGenerationModel(body.generationModel),
  };
}

export function boardRevisionPayload(request: ReturnType<typeof parseBoardRevisionRequest>) {
  return {
    schemaVersion: "board_revision_request.v1",
    message: request.message,
    target: request.target,
    ...(request.generationModel ? { generationModel: request.generationModel } : {}),
  };
}

export function boardRevisionProposal(request: ReturnType<typeof parseBoardRevisionRequest>) {
  return {
    message: request.message,
    target: request.target,
    ...(request.generationModel ? { generationModel: request.generationModel } : {}),
  };
}

export function generationActions(actions: RunActionSummary[]): RunActionSummary[] {
  return actions.filter((action) => action.tool !== BOARD_FEEDBACK_TOOL);
}

export function isInsufficientCreditsFailure(action: RunActionSummary | undefined): boolean {
  return action?.status === "failed" && action.error?.kind === INSUFFICIENT_CREDITS_ERROR_KIND;
}

export function runFailedForInsufficientCredits(run: OrchestratorRun): boolean {
  return run.status === "failed" && run.error?.kind === INSUFFICIENT_CREDITS_ERROR_KIND;
}
