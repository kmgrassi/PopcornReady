import { Router } from "express";
import { route } from "@/core/adapter";
import { getWorkspaceRole, isWorkspaceAdminRole } from "@/lib/api/v1/store";

export const meRouter = Router();

meRouter.get(
  "/me",
  route(async ({ auth }) => {
    const workspaceRole = auth.isLocal
      ? "owner"
      : await getWorkspaceRole(auth.workspaceId, auth.actor.id);
    return {
      status: 200,
      body: {
        actor: auth.actor,
        workspaceId: auth.workspaceId,
        workspaceRole,
        isWorkspaceAdmin: auth.isLocal || isWorkspaceAdminRole(workspaceRole),
        authMode: auth.mode,
        isLocal: auth.isLocal,
      },
    };
  })
);
