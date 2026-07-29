import { ApiError } from "@/core/errors";
import type {
  OrchestratorRunGate,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import {
  GENERATION_STAGE_ORDER,
  type GenerationStageType,
} from "@popcorn/shared/v1/types";
import { toolStage } from "./orchestrator-run-projections.js";

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
