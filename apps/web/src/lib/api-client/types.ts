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

export type {
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
export type { Project } from "@popcorn/shared/types";

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
  workspaceRole?: "owner" | "admin" | "member" | null;
  isWorkspaceAdmin?: boolean;
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
  | "kling"
  | "seedance"
  | "xai"
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

export type ProviderSmokeAssetKind = "image" | "video";

export type ProviderSmokeAssetProvider =
  | "openai"
  | "gemini"
  | "ideogram"
  | "runway"
  | "ltx"
  | "kling"
  | "seedance"
  | "xai"
  | "nvidia_api_catalog";

export interface CreateProviderSmokeAssetInput {
  kind: ProviderSmokeAssetKind;
  provider: ProviderSmokeAssetProvider;
  prompt: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  durationSec?: number;
}

export interface ProviderSmokeAssetResponse {
  project: V1Project;
  job: GenerationJob;
  assetIds: string[];
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

export interface ForkProjectResponse {
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
  shotType?: string | null;
  camera?: string | null;
  framing?: string | null;
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

export interface ProjectAssetsResponse {
  assets: V1Asset[];
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

export interface CreateBriefVersionResponse {
  briefVersion: BriefVersion;
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
