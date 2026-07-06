import { Router } from "express";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { fitProjectAudioToPictureResult } from "@/lib/api/v1/audio-fit";

export const audioFitRouter = Router();

function requiredParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (!value) {
    throw new ApiError("validation_failed", `${name} is required.`);
  }
  return value;
}

audioFitRouter.post(
  "/projects/:projectId/audio-fit",
  mutation(async ({ auth, body }, params) =>
    fitProjectAudioToPictureResult({
      auth,
      projectId: requiredParam(params, "projectId"),
      body,
    })
  )
);
