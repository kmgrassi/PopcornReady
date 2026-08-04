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

export type CreatorWorkState =
  | "queued"
  | "active"
  | "waiting"
  | "blocked"
  | "failed"
  | "complete"
  | "canceled";

export interface CreatorRunHierarchyJob {
  state: CreatorWorkState;
  completedItems?: number;
  totalItems?: number;
}

export interface CreatorRunHierarchyAction {
  actionId: string;
  label: string;
  state: CreatorWorkState;
  outputAssetIds: string[];
  jobs: CreatorRunHierarchyJob[];
}

export interface CreatorRunHierarchyRun {
  runId: string;
  state: CreatorWorkState;
  taskKind: string | null;
  report: {
    outcome: "done" | "blocked" | "question";
    outputAssetIds: string[];
  } | null;
  actions: CreatorRunHierarchyAction[];
}

export interface CreatorRunHierarchySession {
  sessionId: string;
  domain: "visuals" | "audio";
  state: CreatorWorkState;
  runs: CreatorRunHierarchyRun[];
}

export interface CreatorRunHierarchy {
  root: {
    runId: string;
    state: CreatorWorkState;
    message: string;
    needsDirectorDecision: boolean;
  };
  sessions: CreatorRunHierarchySession[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCreatorWorkState(value: unknown): value is CreatorWorkState {
  return ["queued", "active", "waiting", "blocked", "failed", "complete", "canceled"].includes(
    String(value),
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isHierarchyJob(value: unknown): value is CreatorRunHierarchyJob {
  if (!isRecord(value) || !isCreatorWorkState(value.state)) return false;
  const completed = value.completedItems;
  const total = value.totalItems;
  if (
    completed !== undefined &&
    (typeof completed !== "number" || !Number.isInteger(completed) || completed < 0)
  ) return false;
  if (
    total !== undefined &&
    (typeof total !== "number" || !Number.isInteger(total) || total < 0)
  ) return false;
  return completed === undefined || total === undefined || completed <= total;
}

function isHierarchyAction(value: unknown): value is CreatorRunHierarchyAction {
  return (
    isRecord(value) &&
    typeof value.actionId === "string" &&
    typeof value.label === "string" &&
    isCreatorWorkState(value.state) &&
    isStringArray(value.outputAssetIds) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(isHierarchyJob)
  );
}

function isHierarchyReport(value: unknown): value is CreatorRunHierarchyRun["report"] {
  return (
    value === null ||
    (isRecord(value) &&
      ["done", "blocked", "question"].includes(String(value.outcome)) &&
      isStringArray(value.outputAssetIds))
  );
}

function isHierarchyRun(value: unknown): value is CreatorRunHierarchyRun {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    isCreatorWorkState(value.state) &&
    (value.taskKind === null || typeof value.taskKind === "string") &&
    isHierarchyReport(value.report) &&
    Array.isArray(value.actions) &&
    value.actions.every(isHierarchyAction)
  );
}

function isHierarchySession(value: unknown): value is CreatorRunHierarchySession {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    (value.domain === "visuals" || value.domain === "audio") &&
    isCreatorWorkState(value.state) &&
    Array.isArray(value.runs) &&
    value.runs.every(isHierarchyRun)
  );
}

export function isCreatorRunHierarchy(value: unknown): value is CreatorRunHierarchy {
  return (
    isRecord(value) &&
    isRecord(value.root) &&
    typeof value.root.runId === "string" &&
    isCreatorWorkState(value.root.state) &&
    typeof value.root.message === "string" &&
    typeof value.root.needsDirectorDecision === "boolean" &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isHierarchySession)
  );
}

export function isGenerationRunDetail(value: unknown): value is GenerationRunDetail {
  return (
    isRecord(value) &&
    isRecord(value.run) &&
    typeof value.run.runId === "string" &&
    typeof value.run.projectId === "string" &&
    ["queued", "running", "succeeded", "failed", "canceled"].includes(
      String(value.run.status),
    ) &&
    Array.isArray(value.stages) &&
    Array.isArray(value.stageItems) &&
    (value.resultArtifacts === undefined || Array.isArray(value.resultArtifacts)) &&
    (value.hierarchy === undefined || isCreatorRunHierarchy(value.hierarchy))
  );
}
