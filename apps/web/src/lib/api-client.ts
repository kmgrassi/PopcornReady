import type {
  AssetKind,
  AssetStatus,
  BoardRevisionRequest,
  BoardRevisionResponse,
  BriefVersion,
  CompositionMode,
  JobStatus,
  GateableGenerationStageType,
  GenerationJob,
  GenerationRun,
  GenerationRunStatus,
  GenerationStageType,
  ProjectStoryboard,
  V1Asset,
  V1Project,
  VersionedTimeline,
  VideoBriefInput,
} from "@popcorn/shared/v1/types";
import type { Project } from "@popcorn/shared/types";
import type { GenerationRunDetail } from "./v1/generation-runs/status";
import {
  authenticatedFetch,
  getAuthenticatedHeaders,
} from "./supabase/fetch";

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(status: number, envelope: ApiErrorEnvelope["error"]) {
    super(envelope.message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = envelope.code;
    this.requestId = envelope.requestId ?? null;
    this.details = envelope.details;
  }
}

function contentType(response: Response): string {
  return response.headers.get("content-type")?.toLowerCase() ?? "";
}

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  searchParams?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
};

function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_URL?.trim() || "").replace(/\/$/, "");
}

function buildUrl(path: string, searchParams?: ApiRequestOptions["searchParams"]) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${apiBaseUrl()}${normalizedPath}`, window.location.origin);

  if (searchParams instanceof URLSearchParams) {
    searchParams.forEach((value, key) => url.searchParams.set(key, value));
  } else if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const responseContentType = contentType(response);
  const isJson = responseContentType.includes("application/json");

  if (text && !isJson) {
    const looksLikeHtml = text.trimStart().startsWith("<");
    throw new ApiClientError(502, {
      code: "invalid_api_response",
      message: looksLikeHtml
        ? "The API request returned the web app HTML instead of JSON. Check VITE_API_URL or the production /api redirect."
        : "The API request returned a non-JSON response.",
      details: {
        url: response.url,
        upstreamStatus: response.status,
        contentType: responseContentType || null,
      },
    });
  }

  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new ApiClientError(502, {
      code: "invalid_api_response",
      message: "The API request returned malformed JSON.",
      details: {
        url: response.url,
        upstreamStatus: response.status,
        parseError: error instanceof Error ? error.message : String(error),
      },
    });
  }

  if (!response.ok) {
    const envelope = isErrorEnvelope(data)
      ? data.error
      : {
          code: "internal_error",
          message: response.statusText || "API request failed.",
        };
    throw new ApiClientError(response.status, envelope);
  }

  return data as T;
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorEnvelope).error?.code === "string" &&
    typeof (value as ApiErrorEnvelope).error?.message === "string"
  );
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const { body, headers: inputHeaders, searchParams, ...init } = options;
  const headers = new Headers(inputHeaders);

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  const authHeaders = await getAuthenticatedHeaders(headers);
  const response = await authenticatedFetch(buildUrl(path, searchParams), {
    ...init,
    headers: authHeaders,
    body: requestBody,
  });

  return parseResponse<T>(response);
}

export interface MeResponse {
  actor:
    | string
    | {
        id: string;
        type?: string;
        email?: string | null;
      };
  workspaceId: string;
  workspaceName?: string;
  authMode: string;
  isLocal: boolean;
}

export interface AccountMutationResponse {
  ok: true;
}

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ideogram"
  | "elevenlabs"
  | "runway"
  | "ltx"
  | "nvidia";

export interface ProviderApiKey {
  provider: ModelProvider;
  hasKey: true;
  keyHint: string;
  updatedAt: string;
}

export interface ProviderApiKeysResponse {
  keys: ProviderApiKey[];
}

export interface ProviderApiKeyResponse {
  key: ProviderApiKey;
}

export type ModelSettingPurpose =
  | "image_generation"
  | "video_generation"
  | "audio_generation"
  | "text_generation";

export interface WorkspaceModelSetting {
  purpose: ModelSettingPurpose;
  provider: string;
  model: string;
  updatedAt: string;
}

export interface WorkspaceModelSettingsResponse {
  defaults: WorkspaceModelSetting[];
  settings: WorkspaceModelSetting[];
}

export interface WorkspaceModelSettingResponse {
  setting: WorkspaceModelSetting;
}

export interface ProjectsResponse {
  projects: V1Project[];
  pagination: {
    limit: number;
    nextCursor: string | null;
  };
}

export interface ProjectResponse {
  project: V1Project;
}

export interface ProjectStoryboardResponse {
  storyboard: ProjectStoryboard | null;
}

export interface SaveStoryboardBeatInput {
  id: string;
  intent: string;
  visualDescription?: string | null;
  dialogueSummary?: string | null;
  narration?: string | null;
  durationSec?: number | null;
  status?: ProjectStoryboard["scenes"][number]["beats"][number]["status"];
}

export interface SaveStoryboardSceneInput {
  id: string;
  title: string | null;
  summary?: string | null;
  setting?: string | null;
  mood?: string | null;
  durationSec?: number | null;
  status?: ProjectStoryboard["scenes"][number]["status"];
  beats: SaveStoryboardBeatInput[];
}

export interface SaveProjectStoryboardInput {
  id?: string | null;
  status?: ProjectStoryboard["status"];
  scenes: SaveStoryboardSceneInput[];
}

export interface ListPagination {
  limit: number;
  nextCursor: string | null;
}

export interface WorkspaceGenerationRun extends GenerationRun {
  projectName: string;
}

export type WorkspaceAssetSource = "uploaded" | "generated";

export interface WorkspaceAsset {
  id: string;
  assetId?: string;
  projectId: string;
  projectName: string;
  kind: AssetKind;
  status: AssetStatus;
  source: WorkspaceAssetSource | "upload" | "remote_url" | "local_path" | "imported" | "derived";
  filename?: string;
  title?: string;
  description?: string;
  prompt?: string;
  promptPreview?: string;
  url?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  visibility?: "public" | "private";
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceOutput {
  artifactId: string;
  projectId: string;
  projectName: string;
  timelineId?: string;
  url?: string;
  playbackUrl?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  format?: string;
  createdAt: string;
}

export interface WorkspaceGenerationRunsResponse {
  runs: WorkspaceGenerationRun[];
  pagination: ListPagination;
}

export interface WorkspaceAssetsResponse {
  assets: WorkspaceAsset[];
  pagination: ListPagination;
}

export interface WorkspaceOutputsResponse {
  outputs: WorkspaceOutput[];
  pagination: ListPagination;
}

export interface AssetMediaResponse {
  url: string | null;
  thumbnailUrl?: string | null;
  expiresAt: string;
}

export interface ProjectWatchMedia {
  assetId: string;
  projectId: string;
  projectName: string;
  filename: string;
  kind: "video";
  url: string;
  posterUrl?: string;
  durationSec?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Read-only bundle for the public share / read-only project view.
export interface PublicProjectResponse {
  project: V1Project;
  storyboard: ProjectStoryboard | null;
  media: ProjectWatchMedia | null;
}

export interface ProjectWatchResponse {
  media: ProjectWatchMedia | null;
  fallback: {
    storyboardUrl: string;
  };
}

export interface GenerationRunArtifactResponse {
  artifact: {
    artifactId: string;
    runId: string;
    stageId: string;
    itemId?: string;
    kind: string;
    content: unknown;
    createdAt: string;
  };
  timelineId?: string;
}

export interface CreateProjectInput {
  name?: string;
  brief?: VideoBriefInput;
  posterProvider?: string;
}

export interface CreateProjectResponse extends ProjectResponse {
  briefVersion?: BriefVersion;
}

export interface RegisterProjectUploadInput {
  source: {
    type: "multipart_upload";
    dataBase64: string;
    mimeType?: string;
  };
  kind: AssetKind;
  filename: string;
  durationSec?: number;
  userContext?: {
    description?: string;
    intendedUse?: Array<
      | "primary_footage"
      | "b_roll"
      | "style_reference"
      | "music"
      | "voiceover"
      | "dialogue"
      | "sound_effect"
    >;
  };
}

export interface RegisterProjectUploadResponse {
  asset: V1Asset;
  job: GenerationJob;
}

export interface RejectGenerationRunInput {
  stageType?: GateableGenerationStageType;
  note?: string;
}

export type CreateTimelineRevisionInput = string | BoardRevisionRequest;

export interface StartGenerationRunInput {
  brief: VideoBriefInput;
  briefVersionId?: string;
  mode?: CompositionMode;
  allowGeneratedGapFill?: boolean;
  assetIds?: string[];
  reviewGates?: GateableGenerationStageType[];
  stopAfter?: GateableGenerationStageType;
  provider?: string;
  seedAsset?: {
    kind?: "image" | "video";
    provider?: string;
    prompt?: string;
    description?: string;
    durationSec?: number;
    size?: string;
    quality?: string;
    preflightReviewIterations?: number;
  };
  showCaptions?: boolean;
}

export interface StartUploadedFootageRunInput {
  briefVersionId: string;
  assetIds: string[];
  mode?: CompositionMode;
  allowGeneratedGapFill?: boolean;
  reviewGates?: GateableGenerationStageType[];
  showCaptions?: boolean;
}

export interface StartGenerationRunResponse {
  job: GenerationJob | null;
  runId: string | null;
}

export type ExportDurationPolicy =
  | "timeline_only"
  | "match_longest_media"
  | "fail_on_mismatch";

export interface ExportRenderArtifact {
  id: string;
  projectId: string;
  kind: "video/mp4";
  status: "pending_render" | "ready" | "failed";
  url: string | null;
  timelineId: string;
  durationSec: number;
  createdAt: string;
}

export interface ExportJobResult {
  artifactId?: string;
}

export interface ExportJob {
  id: string;
  type: "export";
  status: JobStatus;
  projectId: string;
  step?: string;
  result?: ExportJobResult;
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface StartTimelineExportInput {
  format: "mp4";
  quality: "draft" | "standard" | "high";
  durationPolicy: ExportDurationPolicy;
  showCaptions: boolean;
}

export interface ExportJobResponse {
  job: ExportJob;
}

export interface StoryboardGenerationJob {
  id: string;
  type: "asset_generation";
  status: JobStatus;
  projectId: string;
  step?: string;
  result?: {
    assetIds?: string[];
    storyboardId?: string;
  };
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardGenerationJobResponse {
  job: StoryboardGenerationJob;
}

// The latest job may be absent (generation never started for this project).
export interface ProjectStoryboardJobResponse {
  job: StoryboardGenerationJob | null;
}

export interface ExportArtifactResponse {
  artifact: ExportRenderArtifact;
}

export interface ProjectTimelineResponse {
  timeline: VersionedTimeline | null;
}

export interface StudioProjectResponse {
  project: Project | null;
}

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

export const v1Api = {
  me: () => apiRequest<MeResponse>("/api/v1/me"),
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
  regenerateAsset: (assetId: string, prompt?: string) =>
    apiRequest<AssetMediaResponse>(
      `/api/v1/assets/${encodeURIComponent(assetId)}/regenerate`,
      {
        method: "POST",
        body: prompt != null ? { prompt } : {},
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
