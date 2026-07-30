import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { createRerunProposal } from "@/lib/orchestrator/rerun-proposal-service";
import { createRerunProposalV2 } from "@/lib/orchestrator/rerun-proposal-v2-service";
import {
  approveRerunProposal,
  cancelRerunProposal,
  executeRerunProposal,
  refreshRerunProposal,
  rejectRerunProposal,
} from "@/lib/orchestrator/rerun-lifecycle-service";
import { parseRerunTarget } from "@/lib/orchestrator/rerun-decision";
import {
  getLatestRerunExecution,
  getRerunProposalAction,
  getRerunProposalApproval,
} from "@/lib/api/v1/rerun-lifecycle-store";
import { getProject } from "@/lib/api/v1/store";

export const rerunProposalsRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(params: Record<string, string | undefined>, name: string) {
  const value = params[name];
  if (!value) throw new ApiError("validation_failed", `${name} is required.`);
  return value;
}

export function parseRerunProposalActionId(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ApiError("validation_failed", "actionId must be a UUID.");
  }
  return value;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new ApiError("validation_failed", `${key} is unsupported.`);
    }
  }
}

function idempotencyKey(input: Record<string, unknown>): string {
  const key = typeof input.idempotencyKey === "string"
    ? input.idempotencyKey.trim()
    : "";
  if (!key || key.length > 200) {
    throw new ApiError(
      "validation_failed",
      "idempotencyKey must be between 1 and 200 characters."
    );
  }
  return key;
}

export function parseApproveRerunProposalRequest(body: unknown) {
  const input = objectBody(body);
  exactKeys(input, ["approvedMaxCostUsd"]);
  if (
    typeof input.approvedMaxCostUsd !== "number" ||
    !Number.isFinite(input.approvedMaxCostUsd) ||
    input.approvedMaxCostUsd < 0
  ) {
    throw new ApiError("validation_failed", "approvedMaxCostUsd must be non-negative.");
  }
  return { approvedMaxCostUsd: input.approvedMaxCostUsd };
}

export function parseExecuteRerunProposalRequest(body: unknown) {
  const input = objectBody(body);
  exactKeys(input, ["idempotencyKey"]);
  return { idempotencyKey: idempotencyKey(input) };
}

export function parseRefreshRerunProposalRequest(body: unknown) {
  const input = objectBody(body);
  exactKeys(input, ["idempotencyKey", "message", "targets", "clarificationAnswer"]);
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message || message.length > 4_000) {
    throw new ApiError("validation_failed", "message must be between 1 and 4000 characters.");
  }
  let targets;
  if (input.targets !== undefined) {
    if (!Array.isArray(input.targets) || input.targets.length === 0 || input.targets.length > 20) {
      throw new ApiError("validation_failed", "targets must contain between 1 and 20 entries.");
    }
    targets = input.targets.map((target, index) =>
      parseRerunTarget(target, `targets[${index}]`)
    );
  }
  let clarificationAnswer;
  if (input.clarificationAnswer !== undefined) {
    const answer = objectBody(input.clarificationAnswer);
    exactKeys(answer, ["answerFingerprint", "optionId"]);
    if (
      typeof answer.answerFingerprint !== "string" ||
      typeof answer.optionId !== "string" ||
      !answer.answerFingerprint.trim() ||
      !answer.optionId.trim()
    ) {
      throw new ApiError("validation_failed", "clarificationAnswer is invalid.");
    }
    clarificationAnswer = {
      answerFingerprint: answer.answerFingerprint.trim(),
      optionId: answer.optionId.trim(),
    };
  }
  return {
    idempotencyKey: idempotencyKey(input),
    message,
    ...(targets ? { targets } : {}),
    ...(clarificationAnswer ? { clarificationAnswer } : {}),
  };
}

export function parseCreateRerunProposalV2Request(
  body: unknown,
  projectId: string
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!["message", "targets", "rootRunId"].includes(key)) {
      throw new ApiError("validation_failed", `${key} is server-derived or unsupported.`);
    }
  }
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message || message.length > 4_000) {
    throw new ApiError("validation_failed", "message must be between 1 and 4000 characters.");
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0 || input.targets.length > 20) {
    throw new ApiError("validation_failed", "targets must contain between 1 and 20 entries.");
  }
  if (input.rootRunId !== undefined && typeof input.rootRunId !== "string") {
    throw new ApiError("validation_failed", "rootRunId must be a string.");
  }
  const rootRunId = typeof input.rootRunId === "string" ? input.rootRunId.trim() : undefined;
  if (rootRunId && !UUID_PATTERN.test(rootRunId)) {
    throw new ApiError("validation_failed", "rootRunId must be a UUID.");
  }
  const targets = input.targets.map((target, index) =>
    parseRerunTarget(target, `targets[${index}]`)
  );
  return {
    projectId,
    source: "request_changes" as const,
    message,
    targets,
    ...(rootRunId ? { rootRunId } : {}),
  };
}

rerunProposalsRouter.post("/projects/:projectId/rerun-proposals/v2", mutation(async ({ auth, body }, params) => {
  const parsed = parseCreateRerunProposalV2Request(body, required(params, "projectId"));
  const result = await createRerunProposalV2({
    workspaceId: auth.workspaceId,
    ...parsed,
  });
  return { status: 201, body: result };
}));

rerunProposalsRouter.get(
  "/projects/:projectId/rerun-proposals/v2/:actionId",
  route(async ({ auth }, params) => {
    const projectId = required(params, "projectId");
    const actionId = parseRerunProposalActionId(required(params, "actionId"));
    await getProject(auth.workspaceId, projectId);
    const [action, approval, execution] = await Promise.all([
      getRerunProposalAction({ projectId, actionId }),
      getRerunProposalApproval({ projectId, proposalActionId: actionId }),
      getLatestRerunExecution({ projectId, proposalActionId: actionId }),
    ]);
    return {
      status: 200,
      body: {
        actionId: action.id,
        status: action.status,
        proposal: action.proposal,
        approval: approval
          ? {
              approvalActionId: approval.approvalActionId,
              approvedMaxCostUsd: approval.approvedMaxCostUsd,
            }
          : null,
        execution,
        failure: action.failure,
      },
    };
  })
);

rerunProposalsRouter.post(
  "/projects/:projectId/rerun-proposals/v2/:actionId/approve",
  mutation(async ({ auth, body }, params) => {
    const input = parseApproveRerunProposalRequest(body);
    const result = await approveRerunProposal({
      workspaceId: auth.workspaceId,
      actorId: auth.actor.id,
      projectId: required(params, "projectId"),
      actionId: required(params, "actionId"),
      approvedMaxCostUsd: input.approvedMaxCostUsd,
    });
    return { status: 200, body: result };
  })
);

rerunProposalsRouter.post(
  "/projects/:projectId/rerun-proposals/v2/:actionId/cancel",
  mutation(async ({ auth, body }, params) => {
    const input = body === undefined ? {} : objectBody(body);
    exactKeys(input, ["reason"]);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length > 1_000) {
      throw new ApiError("validation_failed", "reason must be at most 1000 characters.");
    }
    const result = await cancelRerunProposal({
      workspaceId: auth.workspaceId,
      projectId: required(params, "projectId"),
      actionId: required(params, "actionId"),
      reason: reason || "creator_canceled",
    });
    return { status: 200, body: result };
  })
);

rerunProposalsRouter.post(
  "/projects/:projectId/rerun-proposals/v2/:actionId/reject",
  mutation(async ({ auth, body }, params) => {
    const input = body === undefined ? {} : objectBody(body);
    exactKeys(input, []);
    const result = await rejectRerunProposal({
      workspaceId: auth.workspaceId,
      projectId: required(params, "projectId"),
      actionId: required(params, "actionId"),
    });
    return { status: 200, body: result };
  })
);

rerunProposalsRouter.post(
  "/projects/:projectId/rerun-proposals/v2/:actionId/refresh",
  mutation(async ({ auth, body }, params) => {
    const input = parseRefreshRerunProposalRequest(body);
    const result = await refreshRerunProposal({
      workspaceId: auth.workspaceId,
      projectId: required(params, "projectId"),
      actionId: required(params, "actionId"),
      ...input,
    });
    return { status: 201, body: result };
  })
);

rerunProposalsRouter.post(
  "/projects/:projectId/rerun-proposals/v2/:actionId/execute",
  mutation(async ({ auth, body }, params) => {
    const input = parseExecuteRerunProposalRequest(body);
    const result = await executeRerunProposal({
      workspaceId: auth.workspaceId,
      actorId: auth.actor.id,
      projectId: required(params, "projectId"),
      actionId: required(params, "actionId"),
      idempotencyKey: input.idempotencyKey,
    });
    return { status: result.status === "applied" ? 200 : 202, body: result };
  })
);

rerunProposalsRouter.post("/projects/:projectId/rerun-proposals", mutation(async ({ auth, body }, params) => {
  const input = objectBody(body);
  const assetId = typeof input.assetId === "string" ? input.assetId.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (input.rootRunId !== undefined && typeof input.rootRunId !== "string") {
    throw new ApiError("validation_failed", "rootRunId must be a string.");
  }
  const rootRunId = typeof input.rootRunId === "string" ? input.rootRunId.trim() : undefined;
  if (!UUID_PATTERN.test(assetId)) throw new ApiError("validation_failed", "assetId must be a UUID.");
  if (rootRunId && !UUID_PATTERN.test(rootRunId)) throw new ApiError("validation_failed", "rootRunId must be a UUID.");
  if (!message || message.length > 4_000) throw new ApiError("validation_failed", "message must be between 1 and 4000 characters.");
  const result = await createRerunProposal({
    workspaceId: auth.workspaceId,
    projectId: required(params, "projectId"),
    assetId,
    message,
    ...(rootRunId ? { rootRunId } : {}),
  });
  return { status: 201, body: result };
}));
