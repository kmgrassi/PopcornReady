import type {
  StudioPlanningPreviewRequest,
  StudioPlanningPreviewResponse,
} from "@popcorn/shared/v1/studio-planning";
import type { BriefDraft } from "../components/studio/useStudioFlow";
import { apiRequest, v1Api } from "./api-client";

export async function requestStudioPlanningDecisions(
  draft: BriefDraft,
  signal?: AbortSignal,
): Promise<StudioPlanningPreviewResponse> {
  const workspaceId = (await v1Api.me()).workspaceId;
  const body: StudioPlanningPreviewRequest = {
    workspaceId,
    briefDraft: {
      ...draft,
      selectedFootage: draft.selectedFootage.map((footage) => ({
        name: footage.name,
        sizeBytes: footage.sizeBytes,
        type: footage.file.type,
        durationSec: footage.durationSec,
      })),
    },
  };

  return apiRequest<StudioPlanningPreviewResponse>("/api/v1/studio-planning/preview", {
    method: "POST",
    signal,
    body,
  });
}
