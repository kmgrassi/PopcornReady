import { Router } from "express";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { createRerunProposal } from "@/lib/orchestrator/rerun-proposal-service";

export const rerunProposalsRouter = Router();

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
  if (!assetId || !message || message.length > 4_000) throw new ApiError("validation_failed", "assetId and a message of at most 4000 characters are required.");
  const result = await createRerunProposal({
    workspaceId: auth.workspaceId,
    projectId: required(params, "projectId"),
    assetId,
    message,
    ...(rootRunId ? { rootRunId } : {}),
  });
  return { status: 201, body: result };
}));
