import type {
  DashboardActiveRunSummary,
  DashboardRecentOutput,
  DashboardSummaryResponse,
} from "@popcorn/shared/v1/dashboard";
import {
  GATEABLE_GENERATION_STAGE_TYPES,
  type GenerationStageType,
  type RunReviewGate,
} from "@popcorn/shared/v1/types";

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_SNAPSHOT_ITEMS = 50;
const FUTURE_CLOCK_SKEW_MS = 60 * 1000;
const DASHBOARD_GENERATION_STAGE_TYPES = [
  ...GATEABLE_GENERATION_STAGE_TYPES,
  "ready",
] as const satisfies readonly GenerationStageType[];
const STORAGE_PREFIX = "popcorn.dashboard-summary";

interface DashboardSnapshotRecord {
  version: typeof SNAPSHOT_VERSION;
  actorId: string;
  workspaceId: string;
  savedAt: number;
  data: DashboardSummaryResponse;
}

export interface DashboardSnapshot {
  data: DashboardSummaryResponse;
  savedAt: number;
}

interface SnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserSessionStorage(): SnapshotStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function snapshotKey(actorId: string, workspaceId: string) {
  return `${STORAGE_PREFIX}.${encodeURIComponent(actorId)}.${encodeURIComponent(workspaceId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteCount(value: unknown): value is number {
  return Number.isInteger(value) && Number.isFinite(value) && Number(value) >= 0;
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isRunStatus(value: unknown): value is DashboardActiveRunSummary["status"] {
  return value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "canceled";
}

function isGenerationStageType(value: unknown): value is GenerationStageType {
  return DASHBOARD_GENERATION_STAGE_TYPES.includes(value as GenerationStageType);
}

function isActiveRun(value: unknown): value is DashboardActiveRunSummary {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.runId) &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.projectName) &&
    isRunStatus(value.status) &&
    isIsoDate(value.updatedAt) &&
    (value.currentStageType === undefined || isGenerationStageType(value.currentStageType)) &&
    (value.progressPercent === undefined ||
      (typeof value.progressPercent === "number" &&
        Number.isFinite(value.progressPercent) &&
        value.progressPercent >= 0 &&
        value.progressPercent <= 100));
}

function isRecentOutput(value: unknown): value is DashboardRecentOutput {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.artifactId) &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.projectName) &&
    isIsoDate(value.createdAt) &&
    (value.timelineId === undefined || isNonEmptyString(value.timelineId)) &&
    (value.durationSec === undefined ||
      (typeof value.durationSec === "number" &&
        Number.isFinite(value.durationSec) &&
        value.durationSec >= 0)) &&
    (value.format === undefined || isNonEmptyString(value.format));
}

function snapshotReviewGate(value: unknown): RunReviewGate | null {
  if (!isRecord(value) ||
    !GATEABLE_GENERATION_STAGE_TYPES.includes(value.stageType as RunReviewGate["stageType"]) ||
    !isNonEmptyString(value.stageId) ||
    value.state !== "awaiting_review" ||
    !isIsoDate(value.enteredAt)) return null;
  return {
    stageType: value.stageType as RunReviewGate["stageType"],
    stageId: value.stageId,
    state: "awaiting_review",
    enteredAt: value.enteredAt,
  };
}

function isDashboardResponse(value: unknown): value is DashboardSummaryResponse {
  if (!isRecord(value) || !isRecord(value.summary)) return false;
  const { summary } = value;
  if (summary.schemaVersion !== "dashboard.v1" || !isRecord(summary.counts)) return false;
  if (!isFiniteCount(summary.counts.projects) ||
    !isFiniteCount(summary.counts.activeRuns) ||
    !isFiniteCount(summary.counts.outputs)) return false;
  if (!Array.isArray(summary.activeRuns) ||
    summary.activeRuns.length > MAX_SNAPSHOT_ITEMS ||
    !summary.activeRuns.every(isActiveRun)) return false;
  return Array.isArray(summary.recentOutputs) &&
    summary.recentOutputs.length <= MAX_SNAPSHOT_ITEMS &&
    summary.recentOutputs.every(isRecentOutput);
}

function removeQuietly(storage: SnapshotStorage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // Storage is an optional perceived-performance layer.
  }
}

export function readDashboardSnapshot({
  actorId,
  workspaceId,
  now = Date.now(),
  storage = browserSessionStorage(),
}: {
  actorId: string;
  workspaceId: string;
  now?: number;
  storage?: SnapshotStorage | null;
}): DashboardSnapshot | null {
  if (!storage || !actorId || !workspaceId || !Number.isFinite(now)) return null;
  const key = snapshotKey(actorId, workspaceId);

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) ||
      value.version !== SNAPSHOT_VERSION ||
      value.actorId !== actorId ||
      value.workspaceId !== workspaceId ||
      typeof value.savedAt !== "number" ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > now + FUTURE_CLOCK_SKEW_MS ||
      now - value.savedAt > SNAPSHOT_MAX_AGE_MS ||
      !isDashboardResponse(value.data)) {
      removeQuietly(storage, key);
      return null;
    }
    return { data: snapshotSafeResponse(value.data), savedAt: value.savedAt };
  } catch {
    removeQuietly(storage, key);
    return null;
  }
}

function snapshotSafeResponse(data: DashboardSummaryResponse): DashboardSummaryResponse {
  return {
    summary: {
      schemaVersion: "dashboard.v1",
      counts: {
        projects: data.summary.counts.projects,
        activeRuns: data.summary.counts.activeRuns,
        outputs: data.summary.counts.outputs,
      },
      activeRuns: data.summary.activeRuns.slice(0, MAX_SNAPSHOT_ITEMS).map((run) => {
        const reviewGate = snapshotReviewGate(run.reviewGate);
        return {
          runId: run.runId,
          projectId: run.projectId,
          projectName: run.projectName,
          status: run.status,
          ...(isGenerationStageType(run.currentStageType)
            ? { currentStageType: run.currentStageType }
            : {}),
          ...(typeof run.progressPercent === "number" &&
          Number.isFinite(run.progressPercent) &&
          run.progressPercent >= 0 &&
          run.progressPercent <= 100
            ? { progressPercent: run.progressPercent }
            : {}),
          ...(reviewGate ? { reviewGate } : {}),
          updatedAt: run.updatedAt,
        };
      }),
      recentOutputs: data.summary.recentOutputs
        .slice(0, MAX_SNAPSHOT_ITEMS)
        .map((output) => ({
          artifactId: output.artifactId,
          projectId: output.projectId,
          projectName: output.projectName,
          ...(isNonEmptyString(output.timelineId) ? { timelineId: output.timelineId } : {}),
          ...(typeof output.durationSec === "number" &&
          Number.isFinite(output.durationSec) &&
          output.durationSec >= 0
            ? { durationSec: output.durationSec }
            : {}),
          ...(isNonEmptyString(output.format) ? { format: output.format } : {}),
          createdAt: output.createdAt,
        })),
    },
  };
}

export function writeDashboardSnapshot({
  actorId,
  workspaceId,
  data,
  now = Date.now(),
  storage = browserSessionStorage(),
}: {
  actorId: string;
  workspaceId: string;
  data: DashboardSummaryResponse;
  now?: number;
  storage?: SnapshotStorage | null;
}): void {
  if (!storage || !actorId || !workspaceId || !Number.isFinite(now)) return;
  const safeData = snapshotSafeResponse(data);
  if (!isDashboardResponse(safeData)) return;

  const record: DashboardSnapshotRecord = {
    version: SNAPSHOT_VERSION,
    actorId,
    workspaceId,
    savedAt: now,
    data: safeData,
  };
  try {
    storage.setItem(snapshotKey(actorId, workspaceId), JSON.stringify(record));
  } catch {
    // Quota or privacy-mode failures should never block the dashboard.
  }
}

export const dashboardSnapshotTestConstants = {
  maxAgeMs: SNAPSHOT_MAX_AGE_MS,
  storagePrefix: STORAGE_PREFIX,
};
