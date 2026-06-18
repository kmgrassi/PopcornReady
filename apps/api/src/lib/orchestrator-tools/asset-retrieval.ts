import { ApiError } from "@/core/errors";
import {
  retrieveAssetsForAgent,
  type AgentAssetRetrievalInput,
} from "@/lib/api/v1/asset-embedding-search";
import type { ToolExecutionContext } from "./types";

export type OrchestratorAssetRetrievalInput = Omit<
  AgentAssetRetrievalInput,
  "workspaceId" | "projectId"
>;

export async function retrieveProjectAssetsForTool(
  context: ToolExecutionContext,
  input: OrchestratorAssetRetrievalInput
) {
  if (!context.projectId) {
    throw new ApiError(
      "validation_failed",
      "projectId is required for agent asset retrieval."
    );
  }

  return retrieveAssetsForAgent({
    ...input,
    workspaceId: context.auth.workspaceId,
    projectId: context.projectId,
  });
}
