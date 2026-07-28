import { Router } from "express";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { createRerunProposal } from "@/lib/orchestrator/rerun-proposal-service";

export const rerunProposalsRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(params: Record<string, string | undefined>, name: string) {
  const value = params[name];
  if (!value) throw new ApiError("validation_failed", `${name} is required.`);
  return value;
}

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
