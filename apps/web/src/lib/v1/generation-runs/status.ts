// Status helpers and the composite response shape used by PR #8 (retry,
// cancel, recovery). The shared GenerationRun/Stage/StageItem types live in
// src/lib/v1/types.ts and are owned by PR #1; this file adds the small
// active/terminal predicates the progress UI needs without expanding that
// contract.
//
// GenerationRunDetail is the response shape the polling endpoint
// (GET /api/v1/projects/:projectId/generation-runs/:runId) returns. The
// endpoint itself is PR #4; defining the shape here lets PR #8's client and
// hooks type their results today.

import {
  GenerationRun,
  GenerationRunStatus,
  GenerationJobDiagnostics,
  GenerationStage,
  GenerationStageItem,
} from "@popcorn/shared/v1/types";

export type CreatorWorkState = "queued" | "active" | "waiting" | "blocked" | "failed" | "complete" | "canceled";
export interface CreatorRunHierarchy {
  root: { runId: string; state: CreatorWorkState; message: string; needsDirectorDecision: boolean };
  sessions: Array<{ sessionId: string; domain: "visuals" | "audio"; state: CreatorWorkState; runs: Array<{ runId: string; state: CreatorWorkState; taskKind: string | null; report: { actionId: string; outcome: "done" | "blocked" | "question"; outputAssetIds: string[] } | null; actions: Array<{ actionId: string; label: string; state: CreatorWorkState; outputAssetIds: string[]; jobs: Array<{ state: CreatorWorkState; completedItems?: number; totalItems?: number }> }> }> }>;
}

export const ACTIVE_RUN_STATUSES: ReadonlySet<GenerationRunStatus> = new Set([
  "queued",
  "running",
]);

export const TERMINAL_RUN_STATUSES: ReadonlySet<GenerationRunStatus> = new Set([
  "succeeded",
  "failed",
  "canceled",
]);

export function isRunActive(status: GenerationRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}

export function isRunTerminal(status: GenerationRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export interface GenerationRunDetail {
  run: GenerationRun;
  stages: GenerationStage[];
  stageItems: GenerationStageItem[];
  resultArtifacts?: GenerationRunResultArtifact[];
  operatorDiagnostics?: GenerationJobDiagnostics[];
  hierarchy?: CreatorRunHierarchy;
}

export interface GenerationRunResultArtifact {
  kind: GenerationStageItem["kind"];
  purpose: GenerationStageItem["purpose"];
  artifactId: string;
  assetId?: string;
  stageId: string;
  itemId?: string;
}
