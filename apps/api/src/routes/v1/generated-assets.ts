import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import {
  getGeneratedAssetJob,
  startGeneratedAssetJob,
} from "@/lib/api/v1/generated-assets";

export const generatedAssetsRouter = Router();

function requiredParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (!value) {
    throw new ApiError("validation_failed", `${name} is required.`);
  }
  return value;
}

generatedAssetsRouter.post(
  "/projects/:projectId/generated-assets",
  mutation(async ({ auth, body }, params) => {
    const projectId = requiredParam(params, "projectId");
    return startGeneratedAssetJob({ auth, projectId, body });
  })
);

generatedAssetsRouter.get(
  "/projects/:projectId/generated-assets/:jobId",
  route(async ({ auth }, params) => {
    const projectId = requiredParam(params, "projectId");
    const jobId = requiredParam(params, "jobId");
    return getGeneratedAssetJob({ auth, projectId, jobId });
  })
);
