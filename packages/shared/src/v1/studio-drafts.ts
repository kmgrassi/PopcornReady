import type { StoryContext } from "../types";
import type { AspectRatio, GateableGenerationStageType } from "./types";

export const STUDIO_DRAFT_SCHEMA_VERSION = "studioDraft.v1" as const;
export const STUDIO_DRAFT_PAYLOAD_VERSION = 1 as const;

export type StudioDraftStep =
  | "brief"
  | "footage"
  | "story"
  | "generate"
  | "review"
  | "export";

export type StudioDraftPlatform = NonNullable<StoryContext["platform"]>;
export type StudioDraftFormat = NonNullable<StoryContext["format"]>;
export type StudioDraftFootageChoice = "prompt_only" | "upload";
export type StudioDraftFootageMode = "asset_driven" | "hybrid";
export type StudioDraftSeedKind = "image" | "video";

export interface StudioDraftBrief {
  goal?: string;
  targetLengthSec?: number;
  aspectRatio?: AspectRatio;
  projectName?: string;
  footageChoice?: StudioDraftFootageChoice;
  footageMode?: StudioDraftFootageMode;
  audience?: string;
  platform?: StudioDraftPlatform;
  format?: StudioDraftFormat;
  hook?: string;
  bestVisual?: string;
  bigIdea?: string;
  payoff?: string;
  accuracyNote?: string;
  style?: string;
  callToAction?: string;
  provider?: string;
  seedKind?: StudioDraftSeedKind;
  seedSize?: string;
  showCaptions?: boolean;
  reviewGates?: GateableGenerationStageType[];
}

export interface StudioDraftPayload {
  v: typeof STUDIO_DRAFT_PAYLOAD_VERSION;
  draft: StudioDraftBrief;
  step: StudioDraftStep;
  projectId?: string;
  runId?: string;
}

export interface StudioDraftSummary {
  id: string;
  schemaVersion: typeof STUDIO_DRAFT_SCHEMA_VERSION;
  workspaceId: string;
  displayExcerpt: string;
  step: StudioDraftStep;
  projectId?: string;
  runId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudioDraft extends StudioDraftSummary {
  payload: StudioDraftPayload;
}

export interface StudioDraftListResponse {
  drafts: StudioDraftSummary[];
  pagination: {
    limit: number;
    nextCursor: string | null;
  };
}

export interface StudioDraftResponse {
  draft: StudioDraft;
}

export interface CreateStudioDraftRequest {
  payload: StudioDraftPayload;
}

export interface UpdateStudioDraftRequest {
  payload: StudioDraftPayload;
}
