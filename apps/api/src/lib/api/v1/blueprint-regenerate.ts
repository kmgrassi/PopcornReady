// Targeted story-blueprint regeneration: re-derive the narrative blueprint from
// the active brief (optionally steered by feedback) as a NEW versioned
// story_blueprints row + immutable story_blueprint asset, without superseding
// any downstream run stages. Existing scenes/beats/panels stay attached to the
// replaced blueprint row; provenance lets downstream consumers detect staleness
// (North Star: recompute only the affected assets, never a forced cascade).

import { ApiError } from "@/core/errors";
import { developStoryBlueprintForProject } from "@/lib/orchestrator-tools/develop-story-blueprint";
import { getServiceSupabase } from "@/lib/supabase/clients";
import type { AuthContext } from "./auth";
import { getProject } from "./store";
import { getStoryboardRow } from "./storyboards-repository";

export interface RegenerateStoryBlueprintInput {
  auth: AuthContext;
  projectId: string;
  // The blueprint being replaced; must exist in the project. The new blueprint
  // is a sibling version (new row + asset), not an in-place edit.
  storyboardId: string;
  // Optional revision direction, same contract as the develop_story_blueprint
  // tool's feedback input.
  feedback?: string;
}

export interface RegenerateStoryBlueprintResult {
  storyboardId: string;
  assetId: string;
  supersededStoryboardId: string;
}

export async function regenerateStoryBlueprint(
  input: RegenerateStoryBlueprintInput
): Promise<RegenerateStoryBlueprintResult> {
  await getProject(input.auth.workspaceId, input.projectId);
  const db = getServiceSupabase();
  // Throws not_found unless the target blueprint belongs to this project.
  await getStoryboardRow(db, input.projectId, input.storyboardId);

  const output = await developStoryBlueprintForProject({
    workspaceId: input.auth.workspaceId,
    projectId: input.projectId,
    feedback: input.feedback,
  });
  if (!output) {
    throw new ApiError(
      "brief_missing",
      "An active project brief is required before the story blueprint can be regenerated."
    );
  }

  return {
    storyboardId: output.storyBlueprintId,
    assetId: output.storyBlueprintAssetId,
    supersededStoryboardId: input.storyboardId,
  };
}
