import { ApiError } from "@/core/errors";
import type {
  OrchestratorRun,
  OrchestratorRunGate,
  RunActionSummary,
  UpdateOrchestratorRunPatch,
} from "@/lib/api/v1/orchestrator-store";
import {
  GENERATION_STAGE_ORDER,
  type GenerationStageType,
} from "@popcorn/shared/v1/types";
import { toolStage } from "./orchestrator-run-projections.js";
import { BOARD_FEEDBACK_TOOL } from "./orchestrator-run-board-revisions.js";

const AFTER_GATE_PREFIX = "after:";
const INSUFFICIENT_CREDITS_ERROR_KIND = "insufficient_credits";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function generationActions(actions: RunActionSummary[]): RunActionSummary[] {
  return actions.filter((action) => action.tool !== BOARD_FEEDBACK_TOOL);
}

export function stopAfterTools(body: unknown): string[] {
  if (!isRecord(body)) return [];
  if (body.runThrough === false && typeof body.stopAfter !== "string") {
    return ["generate_storyboard"];
  }
  if (typeof body.stopAfter !== "string") return [];
  switch (body.stopAfter) {
    case "brief_intake":
      return ["create_or_load_brief"];
    case "creative_plan":
      return ["plan_visual_anchors"];
    case "storyboard":
      return ["generate_storyboard"];
    case "asset_generation":
      return ["generate_keyframe"];
    case "audio_generation":
      return ["fit_audio_to_picture"];
    case "timeline_assembly":
      return ["assemble_timeline"];
    case "quality_review":
      return ["critique_timeline"];
    case "export":
      return ["export_video"];
    default:
      throw new ApiError("validation_failed", "stopAfter must be a gateable generation stage.", {
        fields: [{ path: "stopAfter", message: "Expected a gateable generation stage." }],
      });
  }
}

/**
 * Every newly started production run pauses after its complete storyboard.
 * This is server-owned policy: a client checkbox or an orchestrator decision
 * must never be able to skip the creator's first visual review.
 */
export function initialRunStopAfterTools(body: unknown): string[] {
  // `stopAfter` and review-gate payloads are legacy controls. An initial
  // production run has exactly one boundary: a complete storyboard. They are
  // deliberately ignored rather than becoming an earlier client-created stop.
  void body;
  return ["generate_storyboard"];
}

function afterGateTools(tools: string[]): string[] {
  return tools.map((tool) => `${AFTER_GATE_PREFIX}${tool}`);
}

/** The identical gate contract used by prompt and uploaded-footage entrypoints. */
export function initialRunGates(body: unknown): string[] {
  return afterGateTools(initialRunStopAfterTools(body));
}

/** Re-open a storyboard-complete run so approval can continue production. */
export function storyboardContinuationPatch(run: OrchestratorRun): UpdateOrchestratorRunPatch {
  return {
    status: "waiting",
    startedAt: run.startedAt ?? new Date().toISOString(),
    clearCompletedAt: true,
    clearError: true,
  };
}

export function isStoryboardAfterGate(gate: Pick<OrchestratorRunGate, "stage">): boolean {
  return gate.stage === `${AFTER_GATE_PREFIX}generate_storyboard`;
}

export function isInsufficientCreditsFailure(action: RunActionSummary | undefined): boolean {
  return action?.status === "failed" && action.error?.kind === INSUFFICIENT_CREDITS_ERROR_KIND;
}

export function runFailedForInsufficientCredits(run: OrchestratorRun): boolean {
  return run.status === "failed" && run.error?.kind === INSUFFICIENT_CREDITS_ERROR_KIND;
}

// Actions/gates at or downstream of `fromOrder` (by their tool's stage). These
// are what a restart-from-stage supersedes/resets so the agent re-runs them.
export function downstreamActionIds(actions: RunActionSummary[], fromOrder: number): string[] {
  return actions
    .filter((action) => (GENERATION_STAGE_ORDER[toolStage(action.tool)] ?? 0) >= fromOrder)
    .map((action) => action.id);
}

export function downstreamGateIds(gates: OrchestratorRunGate[], fromOrder: number): string[] {
  return gates
    .filter((gate) => (GENERATION_STAGE_ORDER[toolStage(gate.stage)] ?? 0) >= fromOrder)
    .map((gate) => gate.id);
}

// Active-selection slots produced by each stage. Restarting from a stage clears
// these and downstream so the asset tools regenerate instead of reusing the
// superseded selection. Beat selections (beat_keyframe:*, beat_clip:*) carry no
// producing-action link, so they must be cleared by slot role, not action id.
// (Poster is intentionally excluded — it's the project thumbnail, not a run
// output the tools skip on.)
const SELECTION_SLOTS: { order: number; exact: string[]; prefixes: string[] }[] = [
  { order: GENERATION_STAGE_ORDER.brief_intake, exact: ["brief"], prefixes: [] },
  { order: GENERATION_STAGE_ORDER.creative_plan, exact: ["plan"], prefixes: [] },
  {
    order: GENERATION_STAGE_ORDER.asset_generation,
    exact: ["visual_anchors"],
    prefixes: ["anchor:", "beat_keyframe:", "beat_clip:"],
  },
  {
    order: GENERATION_STAGE_ORDER.audio_generation,
    exact: [],
    prefixes: ["soundtrack:", "voiceover:", "audio_fit:"],
  },
  { order: GENERATION_STAGE_ORDER.timeline_assembly, exact: ["cut"], prefixes: [] },
];

export function restartSelectionScope(fromOrder: number): {
  exactRoles: string[];
  rolePrefixes: string[];
} {
  const exactRoles: string[] = [];
  const rolePrefixes: string[] = [];
  for (const slot of SELECTION_SLOTS) {
    if (slot.order < fromOrder) continue;
    exactRoles.push(...slot.exact);
    rolePrefixes.push(...slot.prefixes);
  }
  return { exactRoles, rolePrefixes };
}

export function parseRestartStageType(body: unknown): GenerationStageType {
  const value = (body as { stageType?: unknown } | null)?.stageType;
  if (typeof value !== "string" || !(value in GENERATION_STAGE_ORDER) || value === "ready") {
    throw new ApiError(
      "validation_failed",
      "A valid stageType to restart from is required."
    );
  }
  return value as GenerationStageType;
}
