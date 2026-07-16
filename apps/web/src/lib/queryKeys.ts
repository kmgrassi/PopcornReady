import type {
  AssetKind,
  GenerationRun,
} from "@popcorn/shared/v1/types";

import type { WorkspaceAssetSource, v1Api } from "./api-client";

type StudioProjectTimeline = NonNullable<
  Parameters<typeof v1Api.getStudioProjectById>[1]
>;

export type StudioProjectTimelineKey = {
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
  projectGenerationRuns: (projectId: string) =>
    ["projects", projectId, "generation-runs"] as const,
  projectAssets: (
    projectId: string,
    params: { limit?: number; cursor?: string | null } = {},
  ) => ["projects", projectId, "assets", params] as const,
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

export function studioProjectTimelineKey(
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
