import { useQuery, type QueryFunctionContext } from "@tanstack/react-query";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import {
  v1Api,
  type ProjectWatchResponse,
  type PublicProjectResponse,
} from "./api-client";

type QuerySignal = QueryFunctionContext["signal"];

export interface StoryboardPageData {
  projectId: string | null;
  storyboard: ProjectStoryboard | null;
}

export const projectQueryKeys = {
  storyboardPage: (projectId: string | null) =>
    ["projects", projectId ?? "studio-project", "storyboard-page"] as const,
  projectWatch: (projectId: string) => ["projects", projectId, "watch"] as const,
  publicProject: (projectId: string) => ["public-project", projectId] as const,
};

export function usePublicProjectQuery(projectId: string | null) {
  return useQuery<PublicProjectResponse, Error>({
    queryKey: projectId
      ? projectQueryKeys.publicProject(projectId)
      : ["public-project", "missing"],
    queryFn: ({ signal }) => {
      if (!projectId) {
        throw new Error("Project id is required.");
      }
      return v1Api.getPublicProject(projectId, signal);
    },
    enabled: Boolean(projectId),
  });
}

async function loadStoryboardPage(
  routeProjectId: string | null,
  signal: QuerySignal,
): Promise<StoryboardPageData> {
  if (routeProjectId) {
    const { storyboard } = await v1Api.getProjectStoryboard(routeProjectId, signal);
    return { projectId: routeProjectId, storyboard };
  }

  const { project } = await v1Api.getStudioProject();
  if (!project) return { projectId: null, storyboard: null };

  const { storyboard } = await v1Api.getProjectStoryboard(project.id, signal);
  return { projectId: project.id, storyboard };
}

export function useStoryboardPageQuery(routeProjectId: string | null) {
  return useQuery({
    queryKey: projectQueryKeys.storyboardPage(routeProjectId),
    queryFn: ({ signal }) => loadStoryboardPage(routeProjectId, signal),
  });
}

export function useProjectWatchQuery(projectId: string | null) {
  return useQuery<ProjectWatchResponse, Error>({
    queryKey: projectId
      ? projectQueryKeys.projectWatch(projectId)
      : ["projects", "missing", "watch"],
    queryFn: ({ signal }) => {
      if (!projectId) {
        throw new Error("Project id is required.");
      }
      return v1Api.getProjectWatch(projectId, signal);
    },
    enabled: Boolean(projectId),
  });
}
