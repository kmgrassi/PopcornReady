import { Router } from "express";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { parseStudioPlanningPreviewRequest } from "@/lib/api/v1/schemas";
import {
  createStudioPlanningPreview,
  createStudioPlanningStory,
} from "@/lib/api/v1/studio-planning";

export const studioPlanningRouter = Router();

studioPlanningRouter.post(
  "/studio-planning/preview",
  mutation(async ({ auth, body }) => {
    const request = parseStudioPlanningPreviewRequest(body);
    if (request.workspaceId && request.workspaceId !== auth.workspaceId) {
      throw new ApiError(
        "forbidden",
        "You can only preview planning for your own workspace."
      );
    }

    return {
      status: 200,
      body: { preview: createStudioPlanningPreview(request) },
      headers: { "Cache-Control": "no-store" },
    };
  })
);

studioPlanningRouter.post(
  "/studio-planning/story",
  mutation(async ({ auth, body }) => {
    const request = parseStudioPlanningPreviewRequest(body);
    if (request.workspaceId && request.workspaceId !== auth.workspaceId) {
      throw new ApiError(
        "forbidden",
        "You can only generate planning stories for your own workspace."
      );
    }

    return {
      status: 200,
      body: await createStudioPlanningStory(request),
      headers: { "Cache-Control": "no-store" },
    };
  })
);
