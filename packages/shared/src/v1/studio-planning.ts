import type { StoryContext } from "../types";

export type StudioPlanningStoryFormat = NonNullable<StoryContext["format"]>;

export type StudioPlanningPosterStatus =
  | "ready_for_background"
  | "pending_input";

export interface StudioPlanningPreviewRequest {
  workspaceId?: string;
  draftId?: string;
  projectId?: string;
  briefDraft: Record<string, unknown>;
  footageAssetIds?: string[];
}

export interface StudioPlanningStoryDirection {
  format: StudioPlanningStoryFormat;
  label: string;
  rationale: string;
}

export interface StudioPlanningPosterRequest {
  status: StudioPlanningPosterStatus;
  backgroundReady: boolean;
  prompt: string | null;
  visualDirection: string;
  reason?: string;
}

export interface StudioPlanningPreview {
  storyDirection: StudioPlanningStoryDirection;
  openingHook: string;
  poster: StudioPlanningPosterRequest;
  source: {
    mode: "deterministic";
    llmEnriched: false;
    missingInputs: string[];
  };
}

export interface StudioPlanningPreviewResponse {
  preview: StudioPlanningPreview;
}
