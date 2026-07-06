// Act-level storyboard surface: acts are the coarse "arc" tier of the story
// spine (blueprint → acts → scenes → beats → panels). The act mockup is one
// cheap CARTOON sketch tile that summarizes the whole act — the highest-level
// review panel, stored on story_blueprint_acts.mockup_asset_id. Like the scene
// wireframe it is a disposable review artifact, never photoreal and never a
// video seed. Settles the story-spine-unification open question in favor of a
// dedicated `act_mockup` role (not a reuse of `poster`).

import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, notFound } from "@/core/errors";
import {
  STORYBOARD_SKETCH_STYLE_PRESET,
  STORYBOARD_SKETCH_TILE_SIZE,
} from "@/lib/generative/sketch-style";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import type { AuthContext } from "./auth";
import { createGeneratedAsset } from "./generated-assets";
import type { V1Job } from "./jobs";
import { getProject } from "./store";
import type { StoryboardItemStatus } from "./storyboards-types";

export interface StoryboardActRow {
  id: string;
  project_id: string;
  story_blueprint_id: string;
  stable_id: string;
  position: number;
  title: string | null;
  purpose: string | null;
  summary: string | null;
  target_duration_sec: number | null;
  mockup_asset_id: string | null;
  status: StoryboardItemStatus;
  created_at: string;
  updated_at: string;
}

export interface StoryboardAct {
  id: string;
  projectId: string;
  storyboardId: string;
  stableId: string;
  actIndex: number;
  title: string | null;
  purpose: string | null;
  summary: string | null;
  targetDurationSec: number | null;
  mockupAssetId: string | null;
  status: StoryboardItemStatus;
  createdAt: string;
  updatedAt: string;
}

const ACT_COLUMNS =
  "id, project_id, story_blueprint_id, stable_id, position, title, purpose, summary, target_duration_sec, mockup_asset_id, status, created_at, updated_at";

function iso(value: string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return new Date(value).toISOString();
}

function mapAct(row: StoryboardActRow): StoryboardAct {
  return {
    id: row.id,
    projectId: row.project_id,
    storyboardId: row.story_blueprint_id,
    stableId: row.stable_id,
    actIndex: row.position,
    title: row.title,
    purpose: row.purpose,
    summary: row.summary,
    targetDurationSec: row.target_duration_sec,
    mockupAssetId: row.mockup_asset_id,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function getActRow(
  db: SupabaseClient,
  projectId: string,
  storyboardId: string,
  actId: string
): Promise<StoryboardActRow> {
  const data = await runQuery(
    "storyboards.getAct",
    db
      .from("story_blueprint_acts")
      .select(ACT_COLUMNS)
      .eq("project_id", projectId)
      .eq("story_blueprint_id", storyboardId)
      .eq("id", actId)
      .maybeSingle()
  );
  if (!data) throw notFound(`Storyboard act not found: ${actId}`);
  return data as StoryboardActRow;
}

export async function listActs(input: {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
}): Promise<StoryboardAct[]> {
  await getProject(input.auth.workspaceId, input.projectId);
  const db = getServiceSupabase();
  const data = await runQuery(
    "storyboards.listActs",
    db
      .from("story_blueprint_acts")
      .select(ACT_COLUMNS)
      .eq("project_id", input.projectId)
      .eq("story_blueprint_id", input.storyboardId)
      .order("position", { ascending: true })
  );
  return (data as StoryboardActRow[]).map(mapAct);
}

export function buildActMockupPrompt(
  act: Pick<StoryboardActRow, "title" | "purpose" | "summary">,
  override?: string
): string {
  const lines: string[] = [STORYBOARD_SKETCH_STYLE_PRESET];
  if (act.title) lines.push(`Act: ${act.title}.`);
  if (act.purpose) lines.push(`Narrative purpose: ${act.purpose}.`);
  const content =
    override?.trim() ||
    act.summary?.trim() ||
    act.title?.trim() ||
    "A single panel that captures the arc of this act.";
  lines.push(`Depict the whole act in one storyboard panel: ${content}`);
  return lines.join("\n");
}

function jobAssetId(job: V1Job): string {
  const result = job.result as { assetIds?: unknown } | null;
  const assetId = Array.isArray(result?.assetIds) ? result.assetIds[0] : null;
  if (typeof assetId !== "string" || assetId.length === 0) {
    throw new ApiError("job_failed", "Act mockup job did not return an asset id.");
  }
  return assetId;
}

export interface GenerateActMockupInput {
  auth: AuthContext;
  projectId: string;
  storyboardId: string;
  actId: string;
  // Optional edited prompt; falls back to the act's own planning text.
  prompt?: string;
}

// Generate (or regenerate) an act's mockup tile and point mockup_asset_id at
// it. Synchronous like the scene wireframe: createGeneratedAsset runs the job
// to completion, so by the time we return the asset exists and the act
// references it.
export async function generateActMockup(
  input: GenerateActMockupInput
): Promise<{ actId: string; assetId: string }> {
  await getProject(input.auth.workspaceId, input.projectId);
  const db = getServiceSupabase();
  const act = await getActRow(db, input.projectId, input.storyboardId, input.actId);

  const prompt = buildActMockupPrompt(act, input.prompt);

  const result = await createGeneratedAsset({
    auth: input.auth,
    projectId: input.projectId,
    body: {
      kind: "image",
      prompt,
      description: "Disposable act-level storyboard mockup for review.",
      size: STORYBOARD_SKETCH_TILE_SIZE,
      assetRole: "act_mockup",
      displayName: `Act mockup${act.title ? ` — ${act.title}` : ""}`,
    },
  });

  const assetId = jobAssetId(result.body.job as V1Job);

  // FK (project_id, mockup_asset_id) -> assets is satisfied: the generated
  // asset is project-scoped. Point the act at it.
  await runQuery(
    "storyboards.setActMockup",
    db
      .from("story_blueprint_acts")
      .update({ mockup_asset_id: assetId })
      .eq("project_id", input.projectId)
      .eq("story_blueprint_id", input.storyboardId)
      .eq("id", input.actId)
  );

  return { actId: input.actId, assetId };
}
