import { createHash } from "node:crypto";
import type { AudioProductionTaskKind } from "@popcorn/shared/domain-agent-contract";

export const AUDIO_PRODUCTION_RERUN_EXECUTOR_ID =
  "rerun:audio-production:v1";
export const AUDIO_REVISION_RERUN_EXECUTOR_ID =
  "rerun:audio-revision:v1";
export const AUDIO_FIT_RERUN_EXECUTOR_ID =
  "rerun:audio-fit:v1";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function rerunExecutorCallbackToken(input: {
  executionReservationId: string;
  workItemId: string;
  executorId: string;
}): string {
  return digest({
    kind: "rerun-executor-callback",
    executionReservationId: input.executionReservationId,
    workItemId: input.workItemId,
    executorId: input.executorId,
  });
}

export function rerunExecutorCallbackTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function rerunChildBudgetReservationKey(input: {
  executionReservationId: string;
  workItemId: string;
  executorId: string;
}): string {
  return [
    "rerun-child",
    input.executionReservationId,
    input.workItemId,
    input.executorId,
  ].join(":");
}

export function audioRerunExecutorIdForTask(
  taskKind: AudioProductionTaskKind
): string {
  if (taskKind === "audio_fit") return AUDIO_FIT_RERUN_EXECUTOR_ID;
  if (taskKind === "audio_revision") return AUDIO_REVISION_RERUN_EXECUTOR_ID;
  return AUDIO_PRODUCTION_RERUN_EXECUTOR_ID;
}
