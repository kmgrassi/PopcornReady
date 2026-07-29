import { canonicalJSON } from "./hash";

export const ASSET_EMBEDDING_SOURCE_RULES_VERSION = "assetEmbeddingSource.v1";

export type EmbeddableAssetKind =
  | "source_footage"
  | "image"
  | "anchor"
  | "keyframe"
  | "poster"
  | "clip"
  | "audio_track"
  | "brief"
  | "plan"
  | "story_blueprint"
  | "narration_script";

export type GraphAssetKind =
  | EmbeddableAssetKind
  | "beat"
  | "critique"
  | "composite"
  | "render";

export type AssetEmbeddingMedia = "data" | "image" | "video" | "audio";

export interface AssetEmbeddingSourceAsset {
  id: string;
  workspaceId?: string;
  projectId: string;
  ref?: string | null;
  kind: GraphAssetKind;
  media: AssetEmbeddingMedia;
  status: "ready" | "pending" | "failed" | string;
  role?: string | null;
  filename?: string | null;
  description?: string | null;
  content?: unknown;
  params?: unknown;
  context?: unknown;
  semanticAnalysis?: unknown;
}

export type AssetEmbeddingChunkKind =
  | "media_description"
  | "media_transcript"
  | "planning_document"
  | "narration_script";

export interface AssetEmbeddingSourceChunk {
  assetId: string;
  chunkKey: string;
  chunkKind: AssetEmbeddingChunkKind;
  sourceText: string;
  sourceRulesVersion: typeof ASSET_EMBEDDING_SOURCE_RULES_VERSION;
}

const DATA_KINDS = new Set<GraphAssetKind>([
  "brief",
  "plan",
  "story_blueprint",
  "narration_script",
]);

const MEDIA_KINDS = new Set<GraphAssetKind>([
  "source_footage",
  "image",
  "anchor",
  "keyframe",
  "poster",
  "clip",
  "audio_track",
]);

const PLANNING_FIELD_LABELS: Record<string, string> = {
  goal: "Goal",
  audience: "Audience",
  platform: "Platform",
  tone: "Tone",
  style: "Style",
  format: "Format",
  constraints: "Constraints",
  aspectRatio: "Aspect ratio",
  targetLengthSec: "Target duration",
  durationSec: "Duration",
  summary: "Summary",
  title: "Title",
  storyDirection: "Story direction",
  visualDirection: "Visual direction",
  visualDescription: "Visual description",
  narration: "Narration",
  narrationText: "Narration",
  script: "Script",
  text: "Text",
  beatIntent: "Beat intent",
  intent: "Intent",
  scene: "Scene",
  scenes: "Scenes",
  beats: "Beats",
};

const PARAM_FIELD_LABELS: Record<string, string> = {
  prompt: "Prompt",
  originalPrompt: "Original prompt",
  providerPrompt: "Provider prompt",
  negativePrompt: "Negative prompt",
  visualDescription: "Visual description",
  subject: "Subject",
  character: "Character",
  scene: "Scene",
  style: "Style",
  voice: "Voice",
  music: "Music",
  narration: "Narration",
  narrationText: "Narration",
};

const SEMANTIC_FIELD_LABELS: Record<string, string> = {
  summary: "Analysis summary",
  visualDescription: "Visual description",
  audioDescription: "Audio description",
  transcriptText: "Transcript",
  transcript: "Transcript",
  subjects: "Subjects",
  actions: "Actions",
  setting: "Setting",
  mood: "Mood",
  likelyUses: "Likely uses",
  semanticTags: "Semantic tags",
};

const RECURSION_BLOCKED_KEYS = new Set([
  "audit",
  "audits",
  "auditsnapshot",
  "cost",
  "costusd",
  "metadata",
  "providerpayload",
  "providerresponse",
  "raw",
  "rawcompletion",
  "rawresponse",
]);

export function isAssetEmbeddingEligible(
  asset: AssetEmbeddingSourceAsset
): boolean {
  if (asset.status !== "ready") return false;
  if (DATA_KINDS.has(asset.kind)) return asset.media === "data";
  if (!MEDIA_KINDS.has(asset.kind)) return false;
  if (asset.kind === "source_footage") return asset.media !== "data";
  if (asset.kind === "audio_track") return asset.media === "audio";
  if (asset.kind === "clip") return asset.media === "video";
  return asset.media === "image";
}

export function buildAssetEmbeddingSourceChunks(
  asset: AssetEmbeddingSourceAsset
): AssetEmbeddingSourceChunk[] {
  if (!isAssetEmbeddingEligible(asset)) return [];

  const identity = compact([
    asset.ref ? `Ref: ${asset.ref}` : undefined,
    `Kind: ${asset.kind}`,
    `Media: ${asset.media}`,
    asset.role ? `Role: ${asset.role}` : undefined,
    asset.filename ? `Filename: ${asset.filename}` : undefined,
  ]);

  if (DATA_KINDS.has(asset.kind)) {
    const semanticLines = [
      ...fieldLines(asset.content, PLANNING_FIELD_LABELS),
      ...fieldLines(asset.context, PLANNING_FIELD_LABELS),
      ...fieldLines(asset.semanticAnalysis, SEMANTIC_FIELD_LABELS),
    ];
    return chunkIfText({
      assetId: asset.id,
      chunkKey: "asset.summary",
      chunkKind:
        asset.kind === "narration_script"
          ? "narration_script"
          : "planning_document",
      identity,
      lines: semanticLines,
    });
  }

  const summaryLines = [
    asset.description ? `Description: ${asset.description}` : undefined,
    ...fieldLines(asset.params, PARAM_FIELD_LABELS),
    ...fieldLines(asset.context, {
      summary: "Context summary",
      recommendedRoles: "Recommended roles",
      moments: "Moments",
      audioNotes: "Audio notes",
      transcriptHint: "Transcript hint",
      title: "Title",
      description: "User description",
      people: "People",
      characterNames: "Characters",
      location: "Location",
      event: "Event",
      notableMoments: "Notable moments",
      tags: "Tags",
      intendedUse: "Intended use",
    }),
    ...fieldLines(asset.semanticAnalysis, SEMANTIC_FIELD_LABELS, {
      excludeKeys: new Set(["transcript", "transcriptText"]),
    }),
  ];

  const chunks = chunkIfText({
    assetId: asset.id,
    chunkKey: "asset.summary",
    chunkKind: "media_description",
    identity,
    lines: summaryLines,
  });

  const transcript = compact([
    ...fieldLines(asset.context, {
      transcriptText: "Transcript",
      transcriptHint: "Transcript hint",
      audioNotes: "Audio notes",
    }),
    ...fieldLines(asset.semanticAnalysis, {
      transcript: "Transcript",
      transcriptText: "Transcript",
    }),
  ]);
  chunks.push(
    ...chunkIfText({
      assetId: asset.id,
      chunkKey: "asset.transcript",
      chunkKind: "media_transcript",
      lines: transcript,
    })
  );

  return chunks;
}

export function assetEmbeddingSourceHashMaterial(
  chunk: AssetEmbeddingSourceChunk
): string {
  return canonicalJSON({
    assetId: chunk.assetId,
    chunkKey: chunk.chunkKey,
    chunkKind: chunk.chunkKind,
    sourceRulesVersion: chunk.sourceRulesVersion,
    sourceText: chunk.sourceText,
  });
}

function chunkIfText(input: {
  assetId: string;
  chunkKey: string;
  chunkKind: AssetEmbeddingChunkKind;
  identity?: Array<string | undefined>;
  lines: Array<string | undefined>;
}): AssetEmbeddingSourceChunk[] {
  const semanticText = normalizeLines(input.lines);
  if (!semanticText) return [];
  const sourceText = normalizeLines([...(input.identity ?? []), semanticText]);
  return [
    {
      assetId: input.assetId,
      chunkKey: input.chunkKey,
      chunkKind: input.chunkKind,
      sourceText,
      sourceRulesVersion: ASSET_EMBEDDING_SOURCE_RULES_VERSION,
    },
  ];
}

function fieldLines(
  value: unknown,
  labels: Record<string, string>,
  options: { excludeKeys?: Set<string> } = {}
): string[] {
  const lines: string[] = [];
  collectFields(value, labels, lines, options, 0);
  return lines;
}

function collectFields(
  value: unknown,
  labels: Record<string, string>,
  lines: string[],
  options: { excludeKeys?: Set<string> },
  depth: number
): void {
  if (depth > 4 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 12)) {
      collectFields(item, labels, lines, options, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (options.excludeKeys?.has(key) || shouldSkipRecursiveKey(key)) continue;
    const label = labels[key];
    if (label) {
      const text = scalarText(nested);
      if (text) lines.push(`${label}: ${text}`);
    }
    collectFields(nested, labels, lines, options, depth + 1);
  }
}

function shouldSkipRecursiveKey(key: string): boolean {
  return RECURSION_BLOCKED_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return normalizeWhitespace(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(scalarText).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join("; ") : undefined;
  }
  if (value && typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => {
        if (
          typeof nested !== "string" &&
          typeof nested !== "number" &&
          typeof nested !== "boolean"
        ) {
          return undefined;
        }
        return `${key}: ${scalarText(nested)}`;
      })
      .filter((part): part is string => Boolean(part));
    return parts.length ? parts.join("; ") : undefined;
  }
  return undefined;
}

function normalizeLines(lines: Array<string | undefined>): string {
  const seen = new Set<string>();
  return lines
    .map((line) => normalizeWhitespace(line ?? ""))
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .join("\n");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value && value.trim()));
}
