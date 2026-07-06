// Scene-level storyboard wireframe: one cheap, disposable CARTOON sketch per
// scene — the "pin it on the wall and evaluate the arc" panel. It is NOT photoreal
// and NOT the video; it's a review/anchor artifact stored on
// story_blueprint_scenes.scene_asset_id. Generation reuses the shared image
// pipeline (createGeneratedAsset) with the storyboard sketch style preset so the
// output reads as a hand-drawn storyboard cell, never a finished frame.

import { ApiError } from "@/core/errors";
import {
  STORYBOARD_SKETCH_STYLE_PRESET,
  STORYBOARD_SKETCH_TILE_SIZE,
} from "@/lib/generative/sketch-style";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import type { AuthContext } from "./auth";
import { createGeneratedAsset } from "./generated-assets";
import type { V1Job } from "./jobs";
import { getSceneRow } from "./storyboards-repository";

export interface GenerateSceneWireframeInput {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  // Optional edited prompt; falls back to the scene's own planning text.
  prompt?: string;
}

interface SceneWireframeRow {
  title: string | null;
  summary: string | null;
  setting: string | null;
  mood: string | null;
}

function buildSceneWireframePrompt(scene: SceneWireframeRow, override?: string): string {
  const lines: string[] = [STORYBOARD_SKETCH_STYLE_PRESET];
  if (scene.title) lines.push(`Scene: ${scene.title}.`);
  if (scene.setting) lines.push(`Setting: ${scene.setting}.`);
  if (scene.mood) lines.push(`Mood: ${scene.mood}.`);
  const content =
    override?.trim() ||
    scene.summary?.trim() ||
    scene.title?.trim() ||
    "A single establishing panel that captures this scene.";
  lines.push(`Depict in one storyboard panel: ${content}`);
  return lines.join("\n");
}

function jobAssetId(job: V1Job): string {
  const result = job.result as { assetIds?: unknown } | null;
  const assetId = Array.isArray(result?.assetIds) ? result.assetIds[0] : null;
  if (typeof assetId !== "string" || assetId.length === 0) {
    throw new ApiError("job_failed", "Scene wireframe job did not return an asset id.");
  }
  return assetId;
}

// Generate (or regenerate) a scene's wireframe and point scene_asset_id at it.
// Synchronous: createGeneratedAsset runs the job to completion, so by the time we
// return the asset exists and the scene references it.
export async function generateSceneWireframe(
  input: GenerateSceneWireframeInput
): Promise<{ sceneId: string; assetId: string }> {
  const db = getServiceSupabase();
  const scene = (await getSceneRow(
    db,
    input.projectId,
    input.storyboardId,
    input.sceneId
  )) as unknown as SceneWireframeRow;

  const prompt = buildSceneWireframePrompt(scene, input.prompt);

  // createGeneratedAsset runs the job to completion and throws on failure.
  const result = await createGeneratedAsset({
    auth: input.auth,
    projectId: input.projectId,
    body: {
      kind: "image",
      prompt,
      description: "Disposable storyboard scene wireframe for review.",
      size: STORYBOARD_SKETCH_TILE_SIZE,
      assetRole: "scene_storyboard",
      displayName: `Scene wireframe${scene.title ? ` — ${scene.title}` : ""}`,
    },
  });

  const assetId = jobAssetId(result.body.job as V1Job);

  // FK (project_id, scene_asset_id) -> assets is satisfied: the generated asset is
  // project-scoped. Point the scene at it.
  await runQuery(
    "scene-wireframe.setSceneAsset",
    db
      .from("story_blueprint_scenes")
      .update({ scene_asset_id: assetId })
      .eq("project_id", input.projectId)
      .eq("story_blueprint_id", input.storyboardId)
      .eq("id", input.sceneId)
  );

  return { sceneId: input.sceneId, assetId };
}
