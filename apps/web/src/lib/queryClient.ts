import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryFunctionContext,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { DashboardSummaryResponse } from "@popcorn/shared/v1/dashboard";
import type {
  GenerationRun,
  GenerationStageType,
  ProjectVisibility,
  V1Asset,
} from "@popcorn/shared/v1/types";
import {
  v1Api,
  type CreateProviderSmokeAssetInput,
  type CreateProjectInput,
  type MeResponse,
  type ModelSettingPurpose,
  type ModelProvider,
  type ProviderApiKey,
  type RejectGenerationRunInput,
  type RegisterProjectUploadInput,
  type SaveProjectStoryboardInput,
  type StartGenerationRunInput,
  type StartTimelineExportInput,
  type StartUploadedFootageRunInput,
  type ProjectStoryboardJobResponse,
} from "./api-client";
import { queryClient } from "./queryClientCore";
import { queryKeys, studioProjectTimelineKey } from "./queryKeys";
import { projectQueryKeys } from "./project-queries";
import { dashboardApi } from "./v1/dashboard/client";
import { isRunActive, type GenerationRunDetail } from "./v1/generation-runs/status";
import { storyboardProgress } from "./v1/storyboard/progress";
import type { ProjectStoryboardResponse } from "./api-client";

const POLL_INTERVAL_MS = 2_000;
const REVIEW_POLL_INTERVAL_MS = 15_000;
const DASHBOARD_POLL_INTERVAL_MS = 5_000;
const DASHBOARD_HIDDEN_POLL_INTERVAL_MS = 30_000;
// Hidden documents must keep a slow poll alive (with refetchIntervalInBackground)
// rather than return false: returning false cancels the interval, and embedded
// webviews never emit the focus/visibility events that would restart it.
const HIDDEN_POLL_INTERVAL_MS = 30_000;

export { queryClient, queryKeys };

type MeQueryKey = ReturnType<typeof queryKeys.me>;
type ProviderApiKeysQueryKey = ReturnType<typeof queryKeys.providerApiKeys>;
type WorkspaceModelSettingsQueryKey = ReturnType<typeof queryKeys.workspaceModelSettings>;
type QuerySignal = QueryFunctionContext["signal"];

function isTerminal(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function shouldPollRun(run: GenerationRunDetail | undefined): boolean {
  return Boolean(run && !isTerminal(run.run.status));
}

function shouldPollStoryboardJob(
  response: ProjectStoryboardJobResponse | undefined,
): boolean {
  return Boolean(response?.job && !isTerminal(response.job.status));
}

function shouldPollProjectAssets(assets: V1Asset[] | undefined): boolean {
  return Boolean(
    assets?.some((asset) => asset.status === "pending" || asset.status === "processing"),
  );
}

export function useMeQuery(
  authScope: string,
  options: Omit<
    UseQueryOptions<MeResponse, Error, MeResponse, MeQueryKey>,
    "queryKey" | "queryFn"
  > = {},
) {
  return useQuery({
    queryKey: queryKeys.me(authScope),
    queryFn: () => v1Api.me(),
    ...options,
  });
}

export function useCreditsQuery(
  authScope: string,
  options: Omit<
    UseQueryOptions<
      Awaited<ReturnType<typeof v1Api.getCredits>>,
      Error,
      Awaited<ReturnType<typeof v1Api.getCredits>>,
      ReturnType<typeof queryKeys.credits>
    >,
    "queryKey" | "queryFn"
  > = {},
) {
  return useQuery({
    queryKey: queryKeys.credits(authScope),
    queryFn: () => v1Api.getCredits(),
    ...options,
  });
}

export function useCreditTransactionsQuery(
  authScope: string,
  options: Omit<
    UseQueryOptions<
      Awaited<ReturnType<typeof v1Api.getCreditTransactions>>,
      Error,
      Awaited<ReturnType<typeof v1Api.getCreditTransactions>>,
      ReturnType<typeof queryKeys.creditTransactions>
    >,
    "queryKey" | "queryFn"
  > = {},
) {
  return useQuery({
    queryKey: queryKeys.creditTransactions(authScope),
    queryFn: () => v1Api.getCreditTransactions(),
    ...options,
  });
}

export function useCreditPacksQuery() {
  return useQuery({
    queryKey: queryKeys.creditPacks(),
    queryFn: () => v1Api.getCreditPacks(),
    staleTime: 60 * 60 * 1000,
  });
}

// Starts Stripe Checkout and redirects the browser to the hosted page.
export function useBuyCreditsMutation() {
  return useMutation({
    mutationFn: async (pack: string) => {
      const { url } = await v1Api.createCreditCheckout(pack);
      if (!url) throw new Error("Checkout is not available.");
      window.location.assign(url);
      return url;
    },
    meta: { errorMessage: "Could not start checkout" },
  });
}

export function useProviderApiKeysQuery(
  authScope: string,
  options: Omit<
    UseQueryOptions<ProviderApiKey[], Error, ProviderApiKey[], ProviderApiKeysQueryKey>,
    "queryKey" | "queryFn"
  > = {},
) {
  return useQuery({
    queryKey: queryKeys.providerApiKeys(authScope),
    queryFn: async () => {
      const response = await v1Api.listProviderApiKeys();
      return response.keys;
    },
    ...options,
  });
}

export function useSaveProviderApiKeyMutation(authScope: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: { provider: ModelProvider; apiKey: string }) =>
      v1Api.saveProviderApiKey(input.provider, input.apiKey),
    meta: {
      successMessage: "Provider key saved",
      errorMessage: "Could not save provider key",
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: queryKeys.providerApiKeys(authScope),
      });
    },
  });
}

export function useDeleteProviderApiKeyMutation(authScope: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (provider: ModelProvider) => v1Api.deleteProviderApiKey(provider),
    meta: {
      successMessage: "Provider key removed",
      errorMessage: "Could not remove provider key",
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: queryKeys.providerApiKeys(authScope),
      });
    },
  });
}

export function useWorkspaceModelSettingsQuery(
  workspaceId: string | null | undefined,
  options: Omit<
    UseQueryOptions<
      Awaited<ReturnType<typeof v1Api.listWorkspaceModelSettings>>,
      Error,
      Awaited<ReturnType<typeof v1Api.listWorkspaceModelSettings>>,
      WorkspaceModelSettingsQueryKey
    >,
    "queryKey" | "queryFn"
  > = {},
) {
  return useQuery({
    queryKey: queryKeys.workspaceModelSettings(workspaceId ?? "pending"),
    queryFn: () => v1Api.listWorkspaceModelSettings(workspaceId!),
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    ...options,
  });
}

export function useSaveWorkspaceModelSettingMutation(workspaceId: string | null | undefined) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      purpose: ModelSettingPurpose;
      provider: string;
      model: string;
    }) => {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return v1Api.saveWorkspaceModelSetting(workspaceId, input.purpose, {
        provider: input.provider,
        model: input.model,
      });
    },
    meta: {
      successMessage: "Model setting saved",
      errorMessage: "Could not save model setting",
    },
    onSuccess: () => {
      if (workspaceId) {
        void client.invalidateQueries({
          queryKey: queryKeys.workspaceModelSettings(workspaceId),
        });
      }
    },
  });
}

export function useCreateProviderSmokeAssetMutation() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProviderSmokeAssetInput) =>
      v1Api.createProviderSmokeAsset(input),
    meta: {
      successMessage: "Provider test asset created",
      errorMessage: "Could not create provider test asset",
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
      void client.invalidateQueries({ queryKey: ["studio", "project"] });
    },
  });
}

export function useDashboardSummaryQuery(
  authScope: string,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const meQuery = useMeQuery(authScope, { enabled });

  const summaryQuery = useQuery({
    queryKey: meQuery.data
      ? queryKeys.dashboardSummary(meQuery.data.workspaceId)
      : ["dashboard", "summary", "pending"],
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      dashboardApi.getSummary(meQuery.data!.workspaceId, signal),
    enabled: enabled && Boolean(meQuery.data),
    refetchInterval: (query) => {
      const data = query.state.data as DashboardSummaryResponse | undefined;
      if (!data?.summary.activeRuns.some((run) => isRunActive(run.status))) return false;
      return document.visibilityState === "hidden"
        ? DASHBOARD_HIDDEN_POLL_INTERVAL_MS
        : DASHBOARD_POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: true,
  });

  return {
    data: summaryQuery.data ?? null,
    error: enabled ? meQuery.error ?? summaryQuery.error ?? null : null,
    loading: enabled && (meQuery.isLoading || summaryQuery.isLoading),
    refresh: () => {
      if (!enabled) return;
      void meQuery.refetch();
      void summaryQuery.refetch();
    },
  };
}

export function useProjectsQuery(
  params: { limit?: number; cursor?: string | null } = {},
) {
  return useQuery({
    queryKey: queryKeys.projects(params),
    queryFn: () => v1Api.listProjects(params),
  });
}

export function useProjectQuery(projectId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => v1Api.getProject(projectId),
    enabled: enabled && Boolean(projectId),
  });
}

export function useCreateProjectMutation() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) => v1Api.createProject(input),
    meta: {
      successMessage: "Project created",
      errorMessage: "Could not create project",
    },
    onSuccess: (response) => {
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: queryKeys.assetStudioProjects() });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["studio", "project"] });
      client.setQueryData(queryKeys.project(response.project.id), response);
    },
  });
}

export function useDeleteProjectMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => v1Api.deleteProject(projectId),
    meta: {
      successMessage: "Project deleted",
      errorMessage: "Could not delete project",
    },
    onSuccess: () => {
      client.removeQueries({ queryKey: queryKeys.project(projectId) });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
      void client.invalidateQueries({ queryKey: ["studio", "project"] });
    },
  });
}

export function useSetProjectVisibilityMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (visibility: ProjectVisibility) =>
      v1Api.setProjectVisibility(projectId, visibility),
    meta: {
      successMessage: "Project visibility updated",
      errorMessage: "Could not update project visibility",
    },
    onMutate: async (visibility) => {
      await client.cancelQueries({ queryKey: queryKeys.project(projectId) });
      const previousProject = client.getQueryData<Awaited<ReturnType<typeof v1Api.getProject>>>(
        queryKeys.project(projectId),
      );

      if (previousProject?.project) {
        client.setQueryData(queryKeys.project(projectId), {
          ...previousProject,
          project: {
            ...previousProject.project,
            visibility,
          },
        });
      }

      return { previousProject };
    },
    onError: (_error, _visibility, context) => {
      if (context?.previousProject) {
        client.setQueryData(queryKeys.project(projectId), context.previousProject);
      }
    },
    onSuccess: (data) => {
      client.setQueryData(queryKeys.project(projectId), data);
      client.removeQueries({ queryKey: projectQueryKeys.publicProject(projectId) });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
      void client.invalidateQueries({ queryKey: ["studio", "project"] });
    },
  });
}

export function useAdminDeletePublicProjectMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => v1Api.deletePublicProjectAsAdmin(projectId),
    meta: {
      successMessage: "Project deleted",
      errorMessage: "Could not delete project",
    },
    onSuccess: () => {
      client.removeQueries({ queryKey: ["public-project", projectId] });
      client.removeQueries({ queryKey: queryKeys.project(projectId) });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useForkPublicProjectMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => v1Api.forkPublicProject(projectId),
    meta: {
      successMessage: "Project copied to your library",
      errorMessage: "Could not copy project",
    },
    onSuccess: (data) => {
      client.setQueryData(queryKeys.project(data.project.id), data);
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useSetProjectPosterMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (assetId: string) => v1Api.setProjectPoster(projectId, assetId),
    meta: {
      successMessage: "Project poster updated",
      errorMessage: "Could not update project poster",
    },
    onSuccess: (data) => {
      client.setQueryData(queryKeys.project(projectId), data);
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useProjectStoryboardQuery(
  projectId: string,
  enabled = true,
  // Keep polling even when the storyboard itself does not yet report progress —
  // e.g. while the generation job is queued/running and the storyboard row has
  // not been created or flipped to `generating` yet.
  pollWhileActive = false,
) {
  return useQuery({
    queryKey: queryKeys.projectStoryboard(projectId),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.getProjectStoryboard(projectId, signal),
    enabled: enabled && Boolean(projectId),
    refetchInterval: (query) => {
      const data = query.state.data as ProjectStoryboardResponse | undefined;
      const active =
        pollWhileActive || storyboardProgress(data?.storyboard ?? null).isGenerating;
      if (!active) return false;
      if (document.visibilityState === "hidden") return HIDDEN_POLL_INTERVAL_MS;
      return POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: true,
  });
}

export function useGenerateProjectStoryboardMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => v1Api.generateProjectStoryboard(projectId),
    onSuccess: ({ job }) => {
      // Seed the latest-job cache so polling + the loading banner start
      // immediately, without waiting for the next poll of the list endpoint.
      client.setQueryData(queryKeys.projectStoryboardJob(projectId), { job });
      void client.invalidateQueries({ queryKey: queryKeys.projectStoryboard(projectId) });
      void client.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// Latest storyboard generation job for the project. Polls while the job is
// queued/running and — because it reads server state rather than a client-held
// job id — keeps polling correctly after a page reload mid-generation.
export function useProjectStoryboardJobQuery(projectId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectStoryboardJob(projectId),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.getProjectStoryboardJob(projectId, signal),
    enabled: enabled && Boolean(projectId),
    refetchInterval: (query) => {
      const data = query.state.data as ProjectStoryboardJobResponse | undefined;
      if (!shouldPollStoryboardJob(data)) return false;
      if (document.visibilityState === "hidden") return HIDDEN_POLL_INTERVAL_MS;
      return POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: true,
  });
}

export function useProjectAssetsQuery(
  projectId: string,
  params: { limit?: number; cursor?: string | null } = { limit: 100 },
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.projectAssets(projectId, params),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.listProjectAssets(projectId, params, signal),
    enabled: enabled && Boolean(projectId),
    refetchInterval: (query) => {
      const data = query.state.data as Awaited<
        ReturnType<typeof v1Api.listProjectAssets>
      > | undefined;
      if (!shouldPollProjectAssets(data?.assets)) return false;
      if (document.visibilityState === "hidden") return HIDDEN_POLL_INTERVAL_MS;
      return POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: true,
  });
}

export function useSaveProjectStoryboardMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (storyboard: SaveProjectStoryboardInput) =>
      v1Api.saveProjectStoryboard(projectId, storyboard),
    meta: {
      successMessage: "Storyboard saved",
      errorMessage: "Could not save storyboard",
    },
    onSuccess: (data) => {
      client.setQueryData(queryKeys.projectStoryboard(projectId), {
        storyboard: data.storyboard,
      });
      void client.invalidateQueries({
        queryKey: projectQueryKeys.storyboardPage(projectId),
      });
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useWorkspaceGenerationRunsQuery(
  workspaceId: string,
  params: {
    status?: GenerationRun["status"] | "all";
    projectId?: string;
    limit?: number;
    cursor?: string | null;
  } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.workspaceGenerationRuns(workspaceId, params),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.listWorkspaceGenerationRuns(workspaceId, params, signal),
    enabled: enabled && Boolean(workspaceId),
  });
}

export function useWorkspaceAssetsQuery(
  workspaceId: string,
  params: Parameters<typeof queryKeys.workspaceAssets>[1] = {},
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.workspaceAssets(workspaceId, params),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.listWorkspaceAssets(workspaceId, params, signal),
    enabled: enabled && Boolean(workspaceId),
  });
}

export function useWorkspaceOutputsQuery(
  workspaceId: string,
  params: { projectId?: string; limit?: number; cursor?: string | null } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.workspaceOutputs(workspaceId, params),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.listWorkspaceOutputs(workspaceId, params, signal),
    enabled: enabled && Boolean(workspaceId),
  });
}

export function useRefreshAssetMediaMutation() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (assetId: string) => v1Api.refreshAssetMedia(assetId),
    meta: {
      successMessage: "Media refreshed",
      errorMessage: "Could not refresh media",
    },
    onSuccess: (data, assetId) => {
      client.setQueryData(queryKeys.assetMedia(assetId), data);
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useSetAssetVisibilityMutation() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      assetId,
      visibility,
    }: {
      projectId: string;
      assetId: string;
      visibility: "public" | "private";
    }) => v1Api.setAssetVisibility(projectId, assetId, visibility),
    meta: {
      successMessage: "Visibility updated",
      errorMessage: "Could not update visibility",
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useRegisterProjectUploadMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: RegisterProjectUploadInput) =>
      v1Api.registerProjectUpload(projectId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["workspaces"] });
      void client.invalidateQueries({ queryKey: ["projects", projectId, "assets"] });
      void client.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
  });
}

export function useGenerationRunQuery(projectId: string, runId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.generationRun(projectId, runId),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.getGenerationRun(projectId, runId, signal),
    enabled: enabled && Boolean(projectId && runId),
    refetchInterval: (query) => {
      const data = query.state.data as GenerationRunDetail | undefined;
      if (!shouldPollRun(data)) return false;
      if (document.visibilityState === "hidden") return HIDDEN_POLL_INTERVAL_MS;
      return data?.run.reviewGate ? REVIEW_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: true,
  });
}

export function useProjectGenerationRunsQuery(projectId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectGenerationRuns(projectId),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.listProjectGenerationRuns(projectId, signal),
    enabled: enabled && Boolean(projectId),
    refetchInterval: (query) => {
      const data = query.state.data as { runs: GenerationRun[] } | undefined;
      const awaitingReview = data?.runs.some((run) => Boolean(run.reviewGate));
      const active = data?.runs.some((run) => !isTerminal(run.status));
      if (!awaitingReview && !active) return false;
      if (document.visibilityState === "hidden") return HIDDEN_POLL_INTERVAL_MS;
      return awaitingReview ? REVIEW_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: true,
  });
}

export function useGenerationRunArtifactQuery(
  projectId: string,
  runId: string,
  artifactId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.generationRunArtifact(projectId, runId, artifactId),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.getGenerationRunArtifact(projectId, runId, artifactId, signal),
    enabled: enabled && Boolean(projectId && runId && artifactId),
  });
}

export function useUpdateGenerationRunMutation(projectId: string, runId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({
      action,
      body,
    }: {
      action: "approve" | "reject" | "cancel";
      body?: RejectGenerationRunInput;
    }) => v1Api.updateGenerationRun(projectId, runId, action, body),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.generationRun(projectId, runId), data);
      void client.invalidateQueries({ queryKey: queryKeys.projectGenerationRuns(projectId) });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useRestartGenerationRunFromStageMutation(projectId: string, runId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (stageType: GenerationStageType) =>
      v1Api.restartGenerationRunFromStage(projectId, runId, stageType),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.generationRun(projectId, runId), data);
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useRetryGenerationRunAfterCreditUpdateMutation(projectId: string, runId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => v1Api.retryGenerationRunAfterCreditUpdate(projectId, runId),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.generationRun(projectId, runId), data);
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useStartPromptGenerationRunMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: StartGenerationRunInput) =>
      v1Api.startPromptGenerationRun(projectId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useStartUploadedFootageGenerationRunMutation(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: StartUploadedFootageRunInput) =>
      v1Api.startUploadedFootageGenerationRun(projectId, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useLatestProjectTimelineQuery(projectId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.latestProjectTimeline(projectId),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.getLatestProjectTimeline(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

export function useStartTimelineExportMutation(projectId: string, timelineId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: StartTimelineExportInput) =>
      v1Api.startTimelineExport(projectId, timelineId, input),
    onSuccess: ({ job }) => {
      client.setQueryData(queryKeys.timelineExport(projectId, job.id), { job });
      void client.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useTimelineExportQuery(
  projectId: string,
  jobId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.timelineExport(projectId, jobId),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.getTimelineExport(projectId, jobId, signal),
    enabled: enabled && Boolean(projectId && jobId),
  });
}

export function useExportArtifactQuery(
  projectId: string,
  artifactId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.exportArtifact(projectId, artifactId),
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      v1Api.getExportArtifact(projectId, artifactId, signal),
    enabled: enabled && Boolean(projectId && artifactId),
  });
}

export function useStudioProjectQuery() {
  return useQuery({
    queryKey: queryKeys.studioProject,
    queryFn: () => v1Api.getStudioProject(),
  });
}

export function useStudioProjectByIdQuery(
  projectId: string,
  timeline?: Parameters<typeof v1Api.getStudioProjectById>[1],
  enabled = true,
) {
  const timelineKey = studioProjectTimelineKey(timeline);

  return useQuery({
    queryKey: queryKeys.studioProjectById(projectId, timelineKey),
    queryFn: () => v1Api.getStudioProjectById(projectId, timeline),
    enabled: enabled && Boolean(projectId),
  });
}
