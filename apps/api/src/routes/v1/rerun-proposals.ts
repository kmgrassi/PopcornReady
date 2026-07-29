import { Router } from "express";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { createRerunProposal } from "@/lib/orchestrator/rerun-proposal-service";
import { createRerunProposalV2 } from "@/lib/orchestrator/rerun-proposal-v2-service";
import { parseRerunTarget } from "@/lib/orchestrator/rerun-decision";

export const rerunProposalsRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(params: Record<string, string | undefined>, name: string) {
  const value = params[name];
  if (!value) throw new ApiError("validation_failed", `${name} is required.`);
  return value;
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

rerunProposalsRouter.post("/projects/:projectId/rerun-proposals", mutation(async ({ auth, body }, params) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const input = body as Record<string, unknown>;
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
