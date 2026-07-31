import type { CreationGoal } from "./agent-creations";

export type CreationDraft = {
  goal: CreationGoal;
  projectId: string;
  prompt: string;
  improvePrompt: boolean;
};

export type CreationReviewRequest = CreationDraft & {
  maximumUsd: number;
  idempotencyKey: string;
};

type CreationNavigationState = {
  assetCreationDraft?: CreationDraft;
  assetCreationReview?: CreationReviewRequest;
};

const goals = new Set<CreationGoal>(["image", "video", "soundtrack"]);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readDraft(value: unknown): CreationDraft | null {
  const candidate = object(value);
  if (
    !candidate ||
    typeof candidate.goal !== "string" ||
    !goals.has(candidate.goal as CreationGoal) ||
    typeof candidate.projectId !== "string" ||
    !candidate.projectId ||
    typeof candidate.prompt !== "string" ||
    !candidate.prompt.trim() ||
    typeof candidate.improvePrompt !== "boolean"
  ) {
    return null;
  }
  return {
    goal: candidate.goal as CreationGoal,
    projectId: candidate.projectId,
    prompt: candidate.prompt,
    improvePrompt: candidate.improvePrompt,
  };
}

export function creationReviewNavigationState(
  request: CreationReviewRequest,
): CreationNavigationState {
  return { assetCreationReview: request };
}

export function creationDraftNavigationState(
  request: CreationDraft,
): CreationNavigationState {
  return { assetCreationDraft: request };
}

export function readCreationReviewRequest(
  state: unknown,
): CreationReviewRequest | null {
  const candidate = object(object(state)?.assetCreationReview);
  const draft = readDraft(candidate);
  if (
    !candidate ||
    !draft ||
    typeof candidate.maximumUsd !== "number" ||
    !Number.isFinite(candidate.maximumUsd) ||
    candidate.maximumUsd !== 10 ||
    typeof candidate.idempotencyKey !== "string" ||
    !candidate.idempotencyKey.startsWith("asset-studio:proposal:") ||
    candidate.idempotencyKey.length > 128
  ) {
    return null;
  }
  return {
    ...draft,
    maximumUsd: candidate.maximumUsd,
    idempotencyKey: candidate.idempotencyKey,
  };
}

export function readCreationDraft(state: unknown): CreationDraft | null {
  return readDraft(object(state)?.assetCreationDraft);
}
