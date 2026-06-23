import {
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryFunctionContext,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { DashboardSummaryResponse } from "@popcorn/shared/v1/dashboard";
import type { AssetKind, GenerationRun, GenerationStageType } from "@popcorn/shared/v1/types";
import {
  ApiClientError,
  v1Api,
  type CreateTimelineRevisionInput,
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
  type WorkspaceAssetSource,
} from "./api-client";
import { projectQueryKeys } from "./project-queries";
import { showErrorToast, showSuccessToast } from "./toast";
import { dashboardApi } from "./v1/dashboard/client";
import type { GenerationRunDetail } from "./v1/generation-runs/status";
import { storyboardProgress } from "./v1/storyboard/progress";
import type { ProjectStoryboardResponse } from "./api-client";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: QueryToastMeta;
    mutationMeta: QueryToastMeta;
  }
}

const DEFAULT_STALE_TIME_MS = 15_000;
const POLL_INTERVAL_MS = 2_000;
const REVIEW_POLL_INTERVAL_MS = 15_000;
const DASHBOARD_POLL_INTERVAL_MS = 5_000;
const DASHBOARD_HIDDEN_POLL_INTERVAL_MS = 30_000;

interface QueryToastMeta extends Record<string, unknown> {
  errorMessage?: string;
  successMessage?: string;
  suppressErrorToast?: boolean;
}

function retryApiFailure(failureCount: number, error: Error): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

function errorToastMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong. Try again.";
}

const recentToastKeys = new Map<string, number>();

function showDedupedErrorToast(title: string, message: string) {
  const key = `${title}:${message}`;
  const now = Date.now();
  const lastShownAt = recentToastKeys.get(key) ?? 0;
  if (now - lastShownAt < 8_000) return;

  recentToastKeys.set(key, now);
  showErrorToast(title, message);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const meta = query.meta;
      if (meta?.suppressErrorToast) return;
      if (query.state.data !== undefined) return;

      showDedupedErrorToast(
        meta?.errorMessage ?? "Could not load data",
        errorToastMessage(error),
      );
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const meta = mutation.meta;
      if (meta?.suppressErrorToast) return;

      showDedupedErrorToast(
        meta?.errorMessage ?? "Action failed",
        errorToastMessage(error),
      );
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      const message = mutation.meta?.successMessage;
      if (message) {
        showSuccessToast(message);
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      retry: retryApiFailure,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});

export const queryKeys = {
  me: (authScope: string) => ["me", authScope] as const,
  credits: (authScope: string) => ["credits", authScope] as const,
  creditTransactions: (authScope: string) =>
    ["credits", authScope, "transactions"] as const,
  creditPacks: () => ["credits", "packs"] as const,
  providerApiKeys: (authScope: string) => ["provider-api-keys", authScope] as const,
  workspaceModelSettings: (workspaceId: string) =>
    ["workspaces", workspaceId, "model-settings"] as const,
  projects: (params: { limit?: number; cursor?: string | null } = {}) =>
    ["projects", params] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  projectStoryboard: (projectId: string) =>
    ["projects", projectId, "storyboard"] as const,
  projectStoryboardJob: (projectId: string) =>
    ["projects", projectId, "storyboards", "generate", "latest"] as const,
  dashboardSummary: (workspaceId: string) =>
    ["dashboard", "summary", workspaceId] as const,
  workspaceGenerationRuns: (
    workspaceId: string,
    params: {
      status?: GenerationRun["status"] | "all";
      projectId?: string;
      limit?: number;
      cursor?: string | null;
    } = {},
  ) => ["workspaces", workspaceId, "generation-runs", params] as const,
  workspaceAssets: (
    workspaceId: string,
    params: {
      kind?: AssetKind | "all";
      source?: WorkspaceAssetSource | "all";
      projectId?: string;
      limit?: number;
      cursor?: string | null;
    } = {},
  ) => ["workspaces", workspaceId, "assets", params] as const,
  workspaceOutputs: (
    workspaceId: string,
    params: { projectId?: string; limit?: number; cursor?: string | null } = {},
  ) => ["workspaces", workspaceId, "outputs", params] as const,
  assetMedia: (assetId: string) => ["assets", assetId, "media"] as const,
  generationRun: (projectId: string, runId: string) =>
    ["projects", projectId, "generation-runs", runId] as const,
  generationRunArtifact: (projectId: string, runId: string, artifactId: string) =>
    ["projects", projectId, "generation-runs", runId, "artifacts", artifactId] as const,
  latestProjectTimeline: (projectId: string) =>
    ["projects", projectId, "timelines", "latest"] as const,
  timelineExport: (projectId: string, jobId: string) =>
    ["projects", projectId, "exports", jobId] as const,
  exportArtifact: (projectId: string, artifactId: string) =>
    ["projects", projectId, "artifacts", artifactId] as const,
  studioProject: ["studio", "project"] as const,
  studioProjectById: (
    projectId: string,
    timeline: StudioProjectTimelineKey | null = null,
  ) => ["studio", "project", projectId, timeline] as const,
};

type MeQueryKey = ReturnType<typeof queryKeys.me>;
type ProviderApiKeysQueryKey = ReturnType<typeof queryKeys.providerApiKeys>;
type WorkspaceModelSettingsQueryKey = ReturnType<typeof queryKeys.workspaceModelSettings>;
type QuerySignal = QueryFunctionContext["signal"];
type StudioProjectTimeline = NonNullable<
  Parameters<typeof v1Api.getStudioProjectById>[1]
>;
type StudioProjectTimelineKey = {
  aspectRatio: StudioProjectTimeline["aspectRatio"];
  fps: StudioProjectTimeline["fps"];
  showCaptions: StudioProjectTimeline["showCaptions"];
  segments: Array<{
    id: string;
    clipId: string;
    sourceInSec: number;
    sourceOutSec: number;
    beatId?: string;
    caption?: string;
  }>;
};

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

function studioProjectTimelineKey(
  timeline: Parameters<typeof v1Api.getStudioProjectById>[1] | undefined,
): StudioProjectTimelineKey | null {
  if (!timeline) return null;
  return {
    aspectRatio: timeline.aspectRatio,
    fps: timeline.fps,
    showCaptions: timeline.showCaptions,
    segments: timeline.segments.map((segment) => ({
      id: segment.id,
      clipId: segment.clipId,
      sourceInSec: segment.sourceInSec,
      sourceOutSec: segment.sourceOutSec,
      beatId: segment.beatId,
      caption: segment.caption,
    })),
  };
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

export function useDashboardSummaryQuery(authScope: string) {
  const meQuery = useMeQuery(authScope);

  const summaryQuery = useQuery({
    queryKey: meQuery.data
      ? queryKeys.dashboardSummary(meQuery.data.workspaceId)
      : ["dashboard", "summary", "pending"],
    queryFn: ({ signal }: { signal: QuerySignal }) =>
      dashboardApi.getSummary(meQuery.data!.workspaceId, signal),
    enabled: Boolean(meQuery.data),
    refetchInterval: (query) => {
      const data = query.state.data as DashboardSummaryResponse | undefined;
      if (!data?.summary.activeRuns.length) return false;
      return document.visibilityState === "hidden"
        ? DASHBOARD_HIDDEN_POLL_INTERVAL_MS
        : DASHBOARD_POLL_INTERVAL_MS;
    },
  });

  return {
    data: summaryQuery.data ?? null,
    error: meQuery.error ?? summaryQuery.error ?? null,
    loading: meQuery.isLoading || summaryQuery.isLoading,
    refresh: () => {
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      void client.invalidateQueries({ queryKey: ["studio", "project"] });
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
      if (document.visibilityState === "hidden") return false;
      return POLL_INTERVAL_MS;
    },
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
      if (document.visibilityState === "hidden") return false;
      return POLL_INTERVAL_MS;
    },
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
      if (document.visibilityState === "hidden") return false;
      return data?.run.reviewGate ? REVIEW_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    },
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

export function useCreateTimelineRevisionMutation(projectId: string, timelineId: string) {
  return useMutation({
    mutationFn: (input: CreateTimelineRevisionInput) =>
      v1Api.createTimelineRevision(projectId, timelineId, input),
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
