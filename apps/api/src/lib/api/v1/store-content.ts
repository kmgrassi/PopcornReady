import type { TranscriptWord } from "@popcorn/shared/transcript";
import type { GraphAssetInput } from "./asset-graph";

export type ContentSchemaKind =
  | "brief"
  | "beat"
  | "plan"
  | "visual_anchor_plan"
  | "story_blueprint"
  | "script_draft"
  | "timeline"
  | "narration_script"
  | "audio_mix"
  | "critique"
  | "transcript";

export type GraphAssetKind =
  | "source_footage"
  | "brief"
  | "beat"
  | "anchor"
  | "keyframe"
  | "clip"
  | "audio_track"
  | "narration_script"
  | "transcript"
  | "critique"
  | "plan"
  | "story_blueprint"
  | "composite"
  | "transition"
  | "audio_mix"
  | "render"
  | "poster";

export type AssetMedia = "data" | "image" | "video" | "audio";

export interface DataAssetRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  project_id: string;
  lineage_id: string;
  version: number;
  kind: GraphAssetKind;
  media: AssetMedia;
  status: "ready" | "pending";
  role: string | null;
  content: unknown;
  content_hash: string | null;
  inputs_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptSegmentRow {
  id: string;
  schema_version: string;
  workspace_id: string;
  project_id: string;
  transcript_asset_id: string;
  position: number;
  start_sec: number;
  end_sec: number;
  text: string;
  speaker: string | null;
  words: TranscriptWord[];
  created_at: string;
  updated_at: string;
}

// Typed-JSONB guardrail (assets_content_schema_check / assets_params_schema_check):
// jsonb document payloads must carry a schema marker. Stamp it on write, strip
// it when projecting the payload back out as a domain object.
export const CONTENT_SCHEMA_KEY = "schema_version";

export function markedContent(
  kind: ContentSchemaKind,
  content: unknown
): Record<string, unknown> {
  const schema =
    kind === "story_blueprint"
      ? "storyBlueprint.v1"
      : kind === "script_draft"
        ? "scriptDraft.v1"
        : `${kind}.v1`;
  return { [CONTENT_SCHEMA_KEY]: schema, ...(content as Record<string, unknown>) };
}

export function unmarkedContent<T>(content: unknown): T {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const { [CONTENT_SCHEMA_KEY]: _schema, ...rest } = content as Record<string, unknown>;
    return rest as T;
  }
  return content as T;
}

export function inputIds(inputs: GraphAssetInput[]): string[] {
  return [...new Set(inputs.map((input) => input.assetId).filter(Boolean))].sort();
}
