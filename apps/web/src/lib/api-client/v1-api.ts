import type {
  AssetKind,
  AssetStatus,
  BoardRevisionRequest,
  GenerationRunStatus,
  GenerationStageType,
  ProjectVisibility,
  ProjectStoryboard,
  V1Project,
} from "@popcorn/shared/v1/types";
import type { Project } from "@popcorn/shared/types";
import type { GenerationRunDetail } from "../v1/generation-runs/status";
import { apiRequest } from "./transport";
import type {
  AccountMutationResponse,
  AssetMediaResponse,
  BoardRevisionResponse,
  CreateProjectInput,
  CreateProjectResponse,
  CreateTimelineRevisionInput,
  ExportArtifactResponse,
  ExportJobResponse,
  ForkProjectResponse,
  GenerationRunArtifactResponse,
  ListPagination,
  MeResponse,
  ModelProvider,
  ModelSettingPurpose,
  ProjectResponse,
  ProjectStoryboardJobResponse,
  ProjectStoryboardResponse,
  ProjectTimelineResponse,
  ProjectWatchResponse,
  CreateProviderSmokeAssetInput,
  ProviderApiKeyResponse,
  ProviderApiKeysResponse,
  ProviderSmokeAssetResponse,
  PublicProjectResponse,
  RegisterProjectUploadInput,
  RegisterProjectUploadResponse,
  RejectGenerationRunInput,
  SaveProjectStoryboardInput,
  StartGenerationRunInput,
  StartGenerationRunResponse,
  StartTimelineExportInput,
  StartUploadedFootageRunInput,
  StoryboardGenerationJobResponse,
  StudioProjectResponse,
  WorkspaceAssetsResponse,
  WorkspaceAsset,
  WorkspaceAssetSource,
  WorkspaceGenerationRunsResponse,
  WorkspaceModelSettingResponse,
  WorkspaceModelSettingsResponse,
  WorkspaceOutputsResponse,
  ProjectsResponse,
} from "./types";

function studioProjectFromV1(project: V1Project): Project {
  return {
    id: project.id,
    goal: project.name,
    plan: null,
    timeline: null,
    clips: [],
    critic: null,
    chat: [],
    updatedAt: project.updatedAt,
  };
}

function workspaceAssetToClip(asset: WorkspaceAsset): Project["clips"][number] {
  return {
    id: asset.assetId ?? asset.id,
    filename: asset.filename ?? asset.title ?? asset.id,
    url: asset.url ?? asset.thumbnailUrl ?? "",
    kind: asset.kind,
    durationSec: asset.durationSec ?? 4,
    description: asset.description ?? asset.title ?? "",
    source: asset.source === "generated" ? "generated" : "upload",
  };
}

// Shape returned by GET /api/v1/discover/assets. It's the API's richer asset
// row, not the lean shared V1Asset: the resolved CDN/media URL arrives as
// `remoteUrl` (the shared V1Asset's `url` is not populated on this path).
export interface DiscoverAsset {
  id: string;
  projectId: string;
  workspaceId: string;
  kind: AssetKind;
  status: AssetStatus;
  filename: string;
  url?: string;
  remoteUrl?: string;
  durationSec?: number;
  description?: string;
  role?: string;
  source?: { type?: string } | string | null;
  createdAt: string;
  updatedAt: string;
}

function discoverAssetUrl(asset: DiscoverAsset): string | undefined {
  return asset.url ?? asset.remoteUrl ?? undefined;
}

// Public discovery returns bare assets (no workspace-scoped joins like the
// owning project name). Normalize them into the WorkspaceAsset shape the
// Library grid renders, marking them public so owner-only actions stay hidden.
function publicAssetToWorkspaceAsset(asset: DiscoverAsset): WorkspaceAsset {
  const url = discoverAssetUrl(asset);
  const sourceType = typeof asset.source === "object" ? asset.source?.type : asset.source;
  return {
    id: asset.id,
    assetId: asset.id,
    projectId: asset.projectId,
    projectName: "",
    kind: asset.kind,
    status: asset.status,
    source: sourceType === "generated" ? "generated" : "upload",
    filename: asset.filename,
    title: asset.filename,
    description: asset.description,
    url,
    thumbnailUrl: asset.kind === "image" ? url : undefined,
    durationSec: asset.durationSec,
    visibility: "public",
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export interface CreditsBalance {
  balanceCredits: number | null;
  creditValueUsd: number;
  isLocal?: boolean;
}

export interface CreditTransaction {
  id: string;
  deltaCredits: number;
  reason: "signup_grant" | "purchase" | "generation_debit" | "refund" | "adjustment";
  balanceAfter: number;
  costUsd: number | null;
  createdAt: string;
}

export interface CreditTransactionsResponse {
  transactions: CreditTransaction[];
}

export interface CreditPack {
  id: string;
  usd: number;
  credits: number;
}

export interface CreditPacksResponse {
  packs: CreditPack[];
  creditValueUsd: number;
}

export interface CreditCheckoutResponse {
  url: string | null;
}

export const v1Api = {
  me: () => apiRequest<MeResponse>("/api/v1/me"),
  getCredits: () => apiRequest<CreditsBalance>("/api/v1/credits"),
  getCreditTransactions: (limit = 50) =>
    apiRequest<CreditTransactionsResponse>("/api/v1/credits/transactions", {
      searchParams: { limit },
    }),
  getCreditPacks: () => apiRequest<CreditPacksResponse>("/api/v1/credits/packs"),
  createCreditCheckout: (pack: string) =>
    apiRequest<CreditCheckoutResponse>("/api/v1/credits/checkout", {
      method: "POST",
      body: { pack },
    }),
  preflightAnonymousAccountUpgrade: (email: string) =>
    apiRequest<AccountMutationResponse>("/api/v1/account/anonymous-upgrade-preflight", {
      method: "POST",
      body: { email },
    }),
  completeAnonymousAccountUpgrade: (email: string) =>
    apiRequest<AccountMutationResponse>("/api/v1/account/anonymous-upgrade-complete", {
      method: "POST",
      body: { email },
    }),
  listProviderApiKeys: () =>
    apiRequest<ProviderApiKeysResponse>("/api/v1/provider-api-keys"),
  saveProviderApiKey: (provider: ModelProvider, apiKey: string) =>
    apiRequest<ProviderApiKeyResponse>(
      `/api/v1/provider-api-keys/${encodeURIComponent(provider)}`,
      {
        method: "PUT",
        body: { apiKey },
      }
    ),
  deleteProviderApiKey: (provider: ModelProvider) =>
    apiRequest<AccountMutationResponse>(
      `/api/v1/provider-api-keys/${encodeURIComponent(provider)}`,
      {
        method: "DELETE",
      }
    ),
  listWorkspaceModelSettings: (workspaceId: string) =>
    apiRequest<WorkspaceModelSettingsResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/model-settings`
    ),
  saveWorkspaceModelSetting: (
    workspaceId: string,
    purpose: ModelSettingPurpose,
    input: { provider: string; model: string }
  ) =>
    apiRequest<WorkspaceModelSettingResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/model-settings/${encodeURIComponent(purpose)}`,
      {
        method: "PUT",
        body: input,
      }
    ),
  createProviderSmokeAsset: (input: CreateProviderSmokeAssetInput) =>
    apiRequest<ProviderSmokeAssetResponse>("/api/v1/manual-tests/provider-asset", {
      method: "POST",
      body: input,
    }),
  listProjects: (params?: { limit?: number; cursor?: string | null }) =>
    apiRequest<ProjectsResponse>("/api/v1/projects", {
      searchParams: params,
    }),
  // Public discovery feed. Pass `excludeWorkspaceId` (the signed-in viewer's own
  // workspace) to omit the caller's own public projects — those open read-only
  // here and are edited from "My library" instead.
  listPublicProjects: (params?: {
    limit?: number;
    cursor?: string | null;
    excludeWorkspaceId?: string;
  }) =>
    apiRequest<ProjectsResponse>("/api/v1/discover/projects", {
      searchParams: params,
    }),
  // Public, no-auth read of a single public project + storyboard + watch media.
  getPublicProject: (projectId: string, signal?: AbortSignal) =>
    apiRequest<PublicProjectResponse>(
      `/api/v1/discover/projects/${encodeURIComponent(projectId)}`,
      { signal }
    ),
  listPublicAssets: async (
    params?: { kind?: AssetKind | "all"; limit?: number; cursor?: string | null },
    signal?: AbortSignal
  ): Promise<WorkspaceAssetsResponse> => {
    const response = await apiRequest<{
      assets: DiscoverAsset[];
      pagination: ListPagination;
    }>("/api/v1/discover/assets", {
      signal,
      searchParams: {
        ...params,
        kind: params?.kind === "all" ? undefined : params?.kind,
      },
    });
    return {
      // Drop assets with no resolvable media (e.g. legacy storyboard sketches
      // stored without a bucket) so the public gallery isn't full of blanks.
      assets: response.assets
        .filter((asset) => discoverAssetUrl(asset))
        .map(publicAssetToWorkspaceAsset),
      pagination: response.pagination,
    };
  },
  createProject: (input: CreateProjectInput) =>
    apiRequest<CreateProjectResponse>("/api/v1/projects", {
      method: "POST",
      body: input,
    }),
  registerProjectUpload: (projectId: string, input: RegisterProjectUploadInput) =>
    apiRequest<RegisterProjectUploadResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/uploads`,
      {
        method: "POST",
        body: input,
      }
    ),
  getProject: (projectId: string) =>
    apiRequest<ProjectResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}`
    ),
  setProjectVisibility: (projectId: string, visibility: ProjectVisibility) =>
    apiRequest<ProjectResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      {
        method: "PATCH",
        body: { visibility },
      }
    ),
  deleteProject: (projectId: string) =>
    apiRequest<AccountMutationResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      { method: "DELETE" }
    ),
  deletePublicProjectAsAdmin: (projectId: string) =>
    apiRequest<AccountMutationResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/admin-delete`,
      { method: "DELETE" }
    ),
  forkPublicProject: (projectId: string) =>
    apiRequest<ForkProjectResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/fork`,
      { method: "POST" }
    ),
  setProjectPoster: (projectId: string, assetId: string) =>
    apiRequest<ProjectResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/poster`,
      { method: "POST", body: { assetId } }
    ),
  getProjectStoryboard: (projectId: string, signal?: AbortSignal) =>
    apiRequest<ProjectStoryboardResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/storyboard`,
      { signal }
    ),
  generateProjectStoryboard: (projectId: string) =>
    apiRequest<StoryboardGenerationJobResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/storyboards/generate`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": `storyboard-generate:${projectId}:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
        },
      }
    ),
  // Generate (or regenerate) a scene's disposable cartoon wireframe. Synchronous
  // on the server; resolves once scene_asset_id points at the new sketch.
  generateSceneWireframe: (
    projectId: string,
    storyboardId: string,
    sceneId: string,
    input?: { prompt?: string }
  ) =>
    apiRequest<{ sceneId: string; assetId: string }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/storyboards/${encodeURIComponent(
        storyboardId
      )}/scenes/${encodeURIComponent(sceneId)}/wireframe`,
      { method: "POST", body: input ?? {} }
    ),
  // Latest storyboard generation job for the project (or null). Reload-safe —
  // does not depend on a client-held job id.
  getProjectStoryboardJob: (projectId: string, signal?: AbortSignal) =>
    apiRequest<ProjectStoryboardJobResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/storyboards/generate`,
      { signal }
    ),
  getProjectWatch: (projectId: string, signal?: AbortSignal) =>
    apiRequest<ProjectWatchResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/watch`,
      { signal }
    ),
  saveProjectStoryboard: (
    projectId: string,
    storyboard: SaveProjectStoryboardInput
  ) =>
    apiRequest<{ storyboard: ProjectStoryboard }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/storyboard`,
      { method: "PUT", body: storyboard }
    ),
  getGenerationRun: (
    projectId: string,
    runId: string,
    signal?: AbortSignal
  ) =>
    apiRequest<GenerationRunDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}`,
      { signal }
    ),
  getGenerationRunArtifact: (
    projectId: string,
    runId: string,
    artifactId: string,
    signal?: AbortSignal
  ) =>
    apiRequest<GenerationRunArtifactResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
      { signal }
    ),
  listWorkspaceGenerationRuns: (
    workspaceId: string,
    params?: {
      status?: GenerationRunStatus | "all";
      projectId?: string;
      limit?: number;
      cursor?: string | null;
    },
    signal?: AbortSignal
  ) =>
    apiRequest<WorkspaceGenerationRunsResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/generation-runs`,
      {
        signal,
        searchParams: {
          ...params,
          status: params?.status === "all" ? undefined : params?.status,
        },
      }
    ),
  listWorkspaceAssets: (
    workspaceId: string,
    params?: {
      kind?: AssetKind | "all";
      source?: WorkspaceAssetSource | "all";
      projectId?: string;
      limit?: number;
      cursor?: string | null;
    },
    signal?: AbortSignal
  ) =>
    apiRequest<WorkspaceAssetsResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/assets`,
      {
        signal,
        searchParams: {
          ...params,
          kind: params?.kind === "all" ? undefined : params?.kind,
          source: params?.source === "all" ? undefined : params?.source,
        },
      }
    ),
  listWorkspaceOutputs: (
    workspaceId: string,
    params?: { projectId?: string; limit?: number; cursor?: string | null },
    signal?: AbortSignal
  ) =>
    apiRequest<WorkspaceOutputsResponse>(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/outputs`,
      {
        signal,
        searchParams: params,
      }
    ),
  refreshAssetMedia: (assetId: string, signal?: AbortSignal) =>
    apiRequest<AssetMediaResponse>(
      `/api/v1/assets/${encodeURIComponent(assetId)}/media`,
      { signal }
    ),
  // Re-run image generation for an asset in place. Omit `prompt` to reuse the
  // asset's saved prompt; the API throws `prompt_required` (ApiClientError.code)
  // when none is stored, which the UI uses to prompt for one.
  regenerateAsset: (
    assetId: string,
    input?: string | { prompt?: string; provider?: string; model?: string }
  ) =>
    apiRequest<AssetMediaResponse>(
      `/api/v1/assets/${encodeURIComponent(assetId)}/regenerate`,
      {
        method: "POST",
        body: typeof input === "string" ? { prompt: input } : input ?? {},
      }
    ),
  setAssetVisibility: (
    projectId: string,
    assetId: string,
    visibility: "public" | "private"
  ) =>
    apiRequest<{ asset: { id: string; visibility?: "public" | "private" } }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/visibility`,
      {
        method: "PATCH",
        body: { visibility },
      }
    ),
  updateGenerationRun: (
    projectId: string,
    runId: string,
    action: "approve" | "reject" | "cancel",
    body?: RejectGenerationRunInput
  ) =>
    apiRequest<GenerationRunDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}/${action}`,
      {
        method: "POST",
        body: body ?? {},
      }
    ),
  // Re-enter a run at an earlier stage: supersede that stage + downstream and
  // resume so the agent re-runs from there.
  restartGenerationRunFromStage: (
    projectId: string,
    runId: string,
    stageType: GenerationStageType
  ) =>
    apiRequest<GenerationRunDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}/restart-from`,
      {
        method: "POST",
        body: { stageType },
      }
    ),
  createTimelineRevision: (
    projectId: string,
    timelineId: string,
    input: CreateTimelineRevisionInput
  ) =>
    apiRequest<{ job: unknown }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/revisions`,
      {
        method: "POST",
        body: typeof input === "string" ? { message: input } : input,
      }
    ),
  createRunBoardRevision: (
    projectId: string,
    runId: string,
    input: BoardRevisionRequest
  ) =>
    apiRequest<BoardRevisionResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}/board-revisions`,
      {
        method: "POST",
        body: input,
      }
    ),
  // Project-scoped AI edit: route an asset edit through the agent without a run
  // (the API revives/starts one). The agent revises the target in context.
  createProjectAssetRevision: (projectId: string, input: BoardRevisionRequest) =>
    apiRequest<{ runId: string; revision: BoardRevisionResponse["revision"] }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/asset-revisions`,
      {
        method: "POST",
        body: input,
      }
    ),
  startPromptGenerationRun: (
    projectId: string,
    input: StartGenerationRunInput
  ) =>
    apiRequest<StartGenerationRunResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-entrypoints/prompt`,
      {
        method: "POST",
        body: input,
      }
    ),
  startUploadedFootageGenerationRun: (
    projectId: string,
    input: StartUploadedFootageRunInput
  ) =>
    apiRequest<StartGenerationRunResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-entrypoints/uploaded-footage`,
      {
        method: "POST",
        body: input,
      }
    ),
  startTimelineExport: (
    projectId: string,
    timelineId: string,
    input: StartTimelineExportInput
  ) =>
    apiRequest<ExportJobResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/timelines/${encodeURIComponent(timelineId)}/exports`,
      {
        method: "POST",
        body: input,
      }
    ),
  getTimelineExport: (projectId: string, jobId: string, signal?: AbortSignal) =>
    apiRequest<ExportJobResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(jobId)}`,
      { signal }
    ),
  getLatestProjectTimeline: (projectId: string, signal?: AbortSignal) =>
    apiRequest<ProjectTimelineResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/timelines/latest`,
      { signal }
    ),
  getExportArtifact: (
    projectId: string,
    artifactId: string,
    signal?: AbortSignal
  ) =>
    apiRequest<ExportArtifactResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}`,
      { signal }
    ),
  getStudioProject: async (): Promise<StudioProjectResponse> => {
    const { projects } = await v1Api.listProjects({ limit: 1 });
    return {
      project: projects[0] ? studioProjectFromV1(projects[0]) : null,
    };
  },
  getStudioProjectById: async (
    projectId: string,
    timeline?: Project["timeline"] | null
  ): Promise<StudioProjectResponse> => {
    const [{ project }, { workspaceId }] = await Promise.all([
      v1Api.getProject(projectId),
      v1Api.me(),
    ]);
    const { assets } = await v1Api.listWorkspaceAssets(workspaceId, {
      projectId,
      limit: 100,
    });
    return {
      project: {
        ...studioProjectFromV1(project),
        timeline: timeline ?? null,
        clips: assets.map(workspaceAssetToClip),
      },
    };
  },
  listCreatedVideos: async () => ({ videos: [] }),
};
