import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import {
  defaultModelSettings,
  listWorkspaceModelSettings,
  readModelSettingPurpose,
  readModelSettingsBody,
  upsertWorkspaceModelSetting,
} from "@/lib/api/v1/model-settings";

export const workspaceModelSettingsRouter = Router();

function requireOwnWorkspace(
  workspaceId: string | undefined,
  authWorkspaceId: string
): string {
  if (!workspaceId) {
    throw new ApiError("validation_failed", "workspaceId is required.");
  }
  if (workspaceId !== authWorkspaceId) {
    throw new ApiError("forbidden", "You can only manage your own workspace settings.");
  }
  return workspaceId;
}

workspaceModelSettingsRouter.get(
  "/workspaces/:workspaceId/model-settings",
  route(async ({ auth }, params) => {
    const workspaceId = requireOwnWorkspace(params.workspaceId, auth.workspaceId);
    const settings = await listWorkspaceModelSettings(workspaceId);
    return {
      status: 200,
      body: {
        defaults: defaultModelSettings(),
        settings,
      },
      headers: { "Cache-Control": "no-store" },
    };
  })
);

workspaceModelSettingsRouter.put(
  "/workspaces/:workspaceId/model-settings/:purpose",
  mutation(async ({ auth, body }, params) => {
    const workspaceId = requireOwnWorkspace(params.workspaceId, auth.workspaceId);
    const purpose = readModelSettingPurpose(params.purpose);
    const input = readModelSettingsBody(purpose, body);
    const setting = await upsertWorkspaceModelSetting({
      workspaceId,
      purpose,
      ...input,
    });
    return {
      status: 200,
      body: { setting },
    };
  })
);
