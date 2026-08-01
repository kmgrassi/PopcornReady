import type { CreationGoal, CreationProposal } from "./agent-creations";

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

export type CreationReviewHistoryState = {
  request: CreationReviewRequest;
  proposal: CreationProposal | null;
  autoApprovalAllowed: boolean;
};

type StoredCreationReviewState = CreationReviewRequest | CreationReviewHistoryState;

type CreationNavigationState = {
  assetCreationDraft?: CreationDraft;
  assetCreationReview?: StoredCreationReviewState;
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
  options: {
    proposal?: CreationProposal | null;
    autoApprovalAllowed?: boolean;
  } = {},
): CreationNavigationState {
  return {
    assetCreationReview: {
      request,
      proposal: options.proposal ?? null,
      autoApprovalAllowed: options.autoApprovalAllowed ?? true,
    },
  };
}

export function creationDraftNavigationState(
  request: CreationDraft,
): CreationNavigationState {
  return { assetCreationDraft: request };
}

function readReviewRequest(
  value: unknown,
): CreationReviewRequest | null {
  const candidate = object(value);
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

function readProposal(
  value: unknown,
  maximumUsd: number,
): CreationProposal | null {
  const candidate = object(value);
  if (
    !candidate ||
    typeof candidate.sessionId !== "string" ||
    !candidate.sessionId ||
    typeof candidate.runId !== "string" ||
    !candidate.runId ||
    typeof candidate.gateId !== "string" ||
    !candidate.gateId ||
    typeof candidate.requestDigest !== "string" ||
    !candidate.requestDigest ||
    typeof candidate.maximumUsd !== "number" ||
    !Number.isFinite(candidate.maximumUsd) ||
    candidate.maximumUsd !== maximumUsd ||
    typeof candidate.approvalToken !== "string" ||
    !candidate.approvalToken ||
    typeof candidate.expiresAt !== "string" ||
    !candidate.expiresAt ||
    !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    typeof candidate.effectivePrompt !== "string" ||
    !candidate.effectivePrompt.trim() ||
    typeof candidate.enhancementApplied !== "boolean"
  ) {
    return null;
  }
  return candidate as CreationProposal;
}

export function readCreationReviewState(
  state: unknown,
): CreationReviewHistoryState | null {
  const stored = object(object(state)?.assetCreationReview);
  if (!stored) {
    return null;
  }

  // Preserve compatibility with request-only history entries created before
  // proposal restoration was introduced.
  const legacyRequest = readReviewRequest(stored);
  if (legacyRequest) {
    return {
      request: legacyRequest,
      proposal: null,
      autoApprovalAllowed: true,
    };
  }

  const request = readReviewRequest(stored.request);
  if (!request || typeof stored.autoApprovalAllowed !== "boolean") {
    return null;
  }
  if (stored.proposal === null) {
    return {
      request,
      proposal: null,
      autoApprovalAllowed: stored.autoApprovalAllowed,
    };
  }
  const proposal = readProposal(stored.proposal, request.maximumUsd);
  if (!proposal) return null;
  return {
    request,
    proposal,
    autoApprovalAllowed: stored.autoApprovalAllowed,
  };
}

export function readCreationReviewRequest(
  state: unknown,
): CreationReviewRequest | null {
  return readCreationReviewState(state)?.request ?? null;
}

export function readCreationDraft(state: unknown): CreationDraft | null {
  return readDraft(object(state)?.assetCreationDraft);
}
