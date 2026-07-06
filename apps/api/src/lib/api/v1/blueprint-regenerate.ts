// Targeted story-blueprint regeneration: re-derive the narrative blueprint from
// the active brief (optionally steered by feedback) as a NEW versioned
// story_blueprints row + immutable story_blueprint asset, without superseding
// any downstream run stages. Existing scenes/beats/panels stay attached to the
// replaced blueprint row; provenance lets downstream consumers detect staleness
// (North Star: recompute only the affected assets, never a forced cascade).

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/core/errors";
import { developStoryBlueprintForProject } from "@/lib/orchestrator-tools/develop-story-blueprint";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
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

// The regenerate target must be the blueprint the project would actually
// supersede: addProjectStoryBlueprint chains supersedes_id off the project's
// current pointer and retires every non-superseded row, so accepting an older
// id would replace the current blueprint while reporting the old id as the
// superseded one. Exported for tests.
export function assertRegenerateTarget(input: {
  storyboardId: string;
  storyboardStatus: "draft" | "approved" | "superseded";
  currentStoryBlueprintId: string | null;
}): void {
  if (input.storyboardStatus === "superseded") {
    throw new ApiError(
      "validation_failed",
      "This storyboard has already been superseded; regenerate the project's current storyboard instead.",
      { currentStoryBlueprintId: input.currentStoryBlueprintId }
    );
  }
  if (
    input.currentStoryBlueprintId !== null &&
    input.currentStoryBlueprintId !== input.storyboardId
  ) {
    throw new ApiError(
      "validation_failed",
      "Only the project's current storyboard can be regenerated.",
      { currentStoryBlueprintId: input.currentStoryBlueprintId }
    );
  }
}

async function getCurrentStoryBlueprintId(
  db: SupabaseClient,
  projectId: string
): Promise<string | null> {
  const row = await runQuery(
    "blueprint-regenerate.currentPointer",
    db
      .from("projects")
      .select("current_story_blueprint_id")
      .eq("id", projectId)
      .maybeSingle()
  );
  return (
    (row as { current_story_blueprint_id?: string | null } | null)
      ?.current_story_blueprint_id ?? null
  );
}

export async function regenerateStoryBlueprint(
  input: RegenerateStoryBlueprintInput
): Promise<RegenerateStoryBlueprintResult> {
  await getProject(input.auth.workspaceId, input.projectId);
  const db = getServiceSupabase();
  // Throws not_found unless the target blueprint belongs to this project.
  const target = await getStoryboardRow(db, input.projectId, input.storyboardId);
  assertRegenerateTarget({
    storyboardId: input.storyboardId,
    storyboardStatus: target.status,
    currentStoryBlueprintId: await getCurrentStoryBlueprintId(db, input.projectId),
  });

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
