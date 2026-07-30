import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateRerunProposalV2Request,
  RerunProposalLifecycleView,
} from "@popcorn/shared/rerun-proposal";
import { v1Api } from "./api-client";

export const rerunProposalQueryKey = (projectId: string, actionId: string) =>
  ["projects", projectId, "rerun-proposals", actionId] as const;

function isActive(view: RerunProposalLifecycleView | undefined) {
  return Boolean(
    view &&
      (view.status === "running" ||
        view.execution?.status === "reserved" ||
        view.execution?.status === "running" ||
        view.execution?.status === "waiting")
  );
}

export function useRerunProposalQuery(
  projectId: string,
  actionId: string | null
) {
  return useQuery({
    queryKey: rerunProposalQueryKey(projectId, actionId ?? "none"),
    queryFn: () => v1Api.getRerunProposal(projectId, actionId!),
    enabled: Boolean(projectId && actionId),
    refetchInterval: (query) =>
      isActive(query.state.data) ? 2_000 : false,
    refetchIntervalInBackground: true,
  });
}

export function useCreateRerunProposalMutation(projectId: string) {
  return useMutation({
    mutationFn: (input: CreateRerunProposalV2Request) =>
      v1Api.createRerunProposal(projectId, input),
  });
}

export function useApproveRerunProposalMutation(
  projectId: string,
  actionId: string | null
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (approvedMaxCostUsd: number) =>
      v1Api.approveRerunProposal(projectId, actionId!, approvedMaxCostUsd),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: rerunProposalQueryKey(projectId, actionId!),
      }),
  });
}

export function useRejectRerunProposalMutation(
  projectId: string,
  actionId: string | null
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => v1Api.rejectRerunProposal(projectId, actionId!),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: rerunProposalQueryKey(projectId, actionId!),
      }),
  });
}

export function useRefreshRerunProposalMutation(
  projectId: string,
  actionId: string | null
) {
  return useMutation({
    mutationFn: (input: {
      idempotencyKey: string;
      message: string;
      clarificationAnswer?: {
        answerFingerprint: string;
        optionId: string;
      };
    }) =>
      v1Api.refreshRerunProposal(projectId, actionId!, {
        ...input,
      }),
  });
}

export function useExecuteRerunProposalMutation(
  projectId: string,
  actionId: string | null
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) =>
      v1Api.executeRerunProposal(projectId, actionId!, idempotencyKey),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: rerunProposalQueryKey(projectId, actionId!),
      }),
  });
}

export function useCancelRerunProposalMutation(
  projectId: string,
  actionId: string | null
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => v1Api.cancelRerunProposal(projectId, actionId!),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: rerunProposalQueryKey(projectId, actionId!),
      }),
  });
}
