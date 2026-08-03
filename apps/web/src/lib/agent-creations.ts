import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatorDirectTaskKind, DomainReportV1 } from "@popcorn/shared/domain-agent-contract";
import { apiRequest } from "./api-client/transport";
import { queryKeys } from "./queryKeys";

export type CreationGoal = "image" | "video" | "soundtrack";
export type CreationProposal = { sessionId: string; runId: string; gateId: string; requestDigest: string; maximumUsd: number; approvalToken: string; expiresAt: string; effectivePrompt: string; enhancementApplied: boolean };
export type CreationStatusOutput = {
  assetId: string;
  intrinsicRole: string;
  kind: "image" | "video" | "audio";
  url?: string;
  thumbnailUrl?: string;
  expiresAt: string | null;
  name?: string;
};
export type CreationStatus = { sessionId: string | null; run: { id: string; status: string; inputSummary?: string; spentUsd?: number | null }; report: DomainReportV1 | null; outputs: CreationStatusOutput[] };
export const creationKindFor = (goal: CreationGoal): CreatorDirectTaskKind =>
  goal === "image"
    ? "image_create"
    : goal === "video"
      ? "video_create"
      : "soundtrack_create";
export function creationProposalBodyFor(input: {
  goal: CreationGoal;
  prompt: string;
  improvePrompt: boolean;
  maximumUsd: number;
}) {
  return {
    kind: creationKindFor(input.goal),
    prompt: input.prompt,
    maximumUsd: input.maximumUsd,
    referenceAssetIds: [],
    ...(input.goal === "image" || input.goal === "video"
      ? { improvePrompt: input.improvePrompt }
      : {}),
  };
}
const route = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/agent-creations`;
export async function proposeCreation(input: { projectId: string; goal: CreationGoal; prompt: string; improvePrompt: boolean; maximumUsd: number; idempotencyKey: string }) {
  const response = await apiRequest<{ proposal: CreationProposal }>(`${route(input.projectId)}/proposals`, { method: "POST", headers: { "Idempotency-Key": input.idempotencyKey }, body: creationProposalBodyFor(input) });
  return response.proposal;
}
export async function confirmCreation(projectId: string, proposal: CreationProposal) {
  return apiRequest<{ sessionId: string; runId: string; enqueued: boolean }>(`${route(projectId)}/proposals/${encodeURIComponent(proposal.gateId)}/confirm`, { method: "POST", headers: { "Idempotency-Key": `asset-studio:${proposal.gateId}` }, body: { requestDigest: proposal.requestDigest, approvalToken: proposal.approvalToken, maximumUsd: proposal.maximumUsd } });
}
export function useCreationStatus(projectId: string, runId: string | null) { return useQuery({ queryKey: ["agent-creations", projectId, runId], queryFn: () => apiRequest<CreationStatus>(`${route(projectId)}/${encodeURIComponent(runId!)}`), enabled: Boolean(projectId && runId), refetchInterval: q => ["queued", "running", "waiting"].includes(q.state.data?.run.status ?? "") ? 2_000 : false }); }
export function useCreationProposal() { return useMutation({ mutationFn: proposeCreation, meta: { suppressErrorToast: true } }); }
export function useCreationConfirmation() { const client = useQueryClient(); return useMutation({ mutationFn: ({ projectId, proposal }: { projectId: string; proposal: CreationProposal }) => confirmCreation(projectId, proposal), onSuccess: (_, variables) => { void client.invalidateQueries({ queryKey: queryKeys.projectAssets(variables.projectId) }); } }); }
