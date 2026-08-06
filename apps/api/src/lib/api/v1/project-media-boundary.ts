import { ApiError } from "@/core/errors";
import { getActiveProjectScriptDraft, getProject } from "./store";

export type ActiveProjectScript = Awaited<
  ReturnType<typeof getActiveProjectScriptDraft>
>;

interface ProjectMediaBoundaryDeps {
  getProject: typeof getProject;
  getActiveProjectScriptDraft: typeof getActiveProjectScriptDraft;
}

export function assertApprovedScriptForProjectMedia(
  script: ActiveProjectScript,
): void {
  if (!script || script.scriptDraft.status !== "approved") {
    throw new ApiError(
      "validation_failed",
      "Approve the active script before generating project media.",
    );
  }
}

export async function requireApprovedScriptForProjectMedia(
  workspaceId: string,
  projectId: string,
  deps: ProjectMediaBoundaryDeps = { getProject, getActiveProjectScriptDraft },
): Promise<void> {
  await deps.getProject(workspaceId, projectId);
  assertApprovedScriptForProjectMedia(
    await deps.getActiveProjectScriptDraft(projectId),
  );
}
