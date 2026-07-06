// Request/response schemas and lightweight validators for the v1 agent API.
// Validation is intentionally hand-written (no schema library) to match the
// rest of the codebase. Validators throw ApiError("validation_failed").

import { ApiError, validationError, type FieldError } from "./errors";
import { parsePagination } from "./schema-pagination";
import {
  isPlainObject,
  optionalBoolean,
  optionalEnumArray,
  optionalInteger,
  optionalString,
  optionalStringArray,
  parseEnum,
  requireString,
  throwIfInvalid,
} from "./schema-validation";

export type AssetKind = "video" | "image" | "audio";
const ASSET_KINDS: AssetKind[] = ["video", "image", "audio"];
export type AssetMediaType = AssetKind | "text" | "reference";
const ASSET_MEDIA_TYPES: AssetMediaType[] = [
  "video",
  "image",
  "audio",
  "text",
  "reference",
];
export type AssetOrigin = "uploaded" | "generated" | "imported" | "derived";
export type AssetUse =
  | "primary_footage"
  | "b_roll"
  | "character_reference"
  | "style_reference"
  | "location_reference"
  | "logo_or_brand"
  | "music"
  | "voiceover"
  | "dialogue"
  | "sound_effect"
  | "title_or_graphic";
const ASSET_USES: AssetUse[] = [
  "primary_footage",
  "b_roll",
  "character_reference",
  "style_reference",
  "location_reference",
  "logo_or_brand",
  "music",
  "voiceover",
  "dialogue",
  "sound_effect",
  "title_or_graphic",
];
export type KnowledgeConfidence = "low" | "medium" | "high";
const KNOWLEDGE_CONFIDENCES: KnowledgeConfidence[] = ["low", "medium", "high"];
export type KnownFactSource =
  | "user"
  | "agent"
  | "generation_prompt"
  | "metadata"
  | "transcript";
const KNOWN_FACT_SOURCES: KnownFactSource[] = [
  "user",
  "agent",
  "generation_prompt",
  "metadata",
  "transcript",
];
export type KnowledgeAction =
  | "ask_user"
  | "sample_video"
  | "analyze_image"
  | "transcribe_audio";
const KNOWLEDGE_ACTIONS: KnowledgeAction[] = [
  "ask_user",
  "sample_video",
  "analyze_image",
  "transcribe_audio",
];
export type AssetConstraintType =
  | "must_use"
  | "avoid"
  | "likeness_reference"
  | "style_reference"
  | "brand_required"
  | "audio_required"
  | "no_audio"
  | "do_not_crop"
  | "do_not_modify";
const ASSET_CONSTRAINT_TYPES: AssetConstraintType[] = [
  "must_use",
  "avoid",
  "likeness_reference",
  "style_reference",
  "brand_required",
  "audio_required",
  "no_audio",
  "do_not_crop",
  "do_not_modify",
];
export type AssetRelationshipType =
  | "derived_from"
  | "sampled_from"
  | "represents_character"
  | "represents_location"
  | "belongs_to_scene"
  | "audio_for"
  | "visual_for";
const ASSET_RELATIONSHIP_TYPES: AssetRelationshipType[] = [
  "derived_from",
  "sampled_from",
  "represents_character",
  "represents_location",
  "belongs_to_scene",
  "audio_for",
  "visual_for",
];

export type AgentAssetSource =
  | { type: "remote_url"; url: string }
  | { type: "local_path"; path: string }
  | {
      type: "multipart_upload";
      dataBase64?: string;
      mimeType?: string;
      requiresTranscode?: boolean;
    }
  | { type: "storage_upload"; path: string; requiresTranscode?: boolean }
  | { type: "generated"; generatedAssetId: string }
  | {
      type: "catalog";
      catalogEntryId: string;
      sourceAssetId?: string;
      sourceStoryBlueprintId?: string;
    };

export interface AssetContext {
  summary?: string;
  recommendedRoles?: string[];
  transcriptText?: string;
  moments?: { startSec: number; endSec: number; label?: string }[];
}

export interface UserAssetContext {
  title?: string;
  description?: string;
  people?: string[];
  characterNames?: string[];
  location?: string;
  event?: string;
  notableMoments?: string[];
  tags?: string[];
  transcriptHint?: string;
  audioNotes?: string;
  intendedUse?: AssetUse[];
  mustUse?: boolean;
  avoid?: boolean;
}

export type UserClipContext = UserAssetContext;

export interface UsableMoment {
  startSec: number;
  endSec: number;
  label: string;
  description: string;
  suggestedUse:
    | "hook"
    | "context"
    | "proof"
    | "emotion"
    | "transition"
    | "detail"
    | "b_roll"
    | "cta";
}
const USABLE_MOMENT_USES: UsableMoment["suggestedUse"][] = [
  "hook",
  "context",
  "proof",
  "emotion",
  "transition",
  "detail",
  "b_roll",
  "cta",
];

export interface AgentAssetContext {
  summary: string;
  mediaType: AssetMediaType;
  subjects: string[];
  actions?: string[];
  setting?: string;
  mood?: string;
  likelyUses: AssetUse[];
  cautions: string[];
  transcriptSummary?: string;
  confidence: KnowledgeConfidence;
  sampledAssetIds: string[];
  model: {
    provider: string;
    model?: string;
  };
}

export interface AgentClipContext extends AgentAssetContext {
  mediaType: "video";
  visualSubjects: string[];
  shotTypes: string[];
  usableMoments: UsableMoment[];
  sampledFrames: string[];
}

export interface KnownFact {
  field: string;
  value: string;
  confidence: KnowledgeConfidence;
  source: KnownFactSource;
}

export interface KnowledgeGap {
  field: string;
  question: string;
  canInferAutomatically: boolean;
  suggestedAction: KnowledgeAction;
}

export interface AssetConstraint {
  type: AssetConstraintType;
  reason?: string;
}

export interface AssetRelationship {
  type: AssetRelationshipType;
  targetAssetId: string;
  description?: string;
}

export interface AssetKnowledgeProvenance {
  createdAt: string;
  updatedAt: string;
  analysisVersion: string;
  model?: {
    provider: string;
    model?: string;
  };
  sourcePrompt?: string;
  sampledAssetIds: string[];
  transcriptAssetId?: string;
}

export interface AssetKnowledge {
  assetId: string;
  mediaType: AssetMediaType;
  origin: AssetOrigin;
  userContext?: UserAssetContext;
  agentContext?: AgentAssetContext | AgentClipContext;
  knowledgeScore: number;
  knowledgeSummary: string;
  knownFacts: KnownFact[];
  unknowns: KnowledgeGap[];
  likelyUses: AssetUse[];
  constraints: AssetConstraint[];
  relationships: AssetRelationship[];
  provenance: AssetKnowledgeProvenance;
}

export interface AssetKnowledgeSummary {
  assetId: string;
  mediaType: AssetMediaType;
  known: string[];
  unknown: KnowledgeGap[];
  likelyUses: AssetUse[];
  confidence: KnowledgeConfidence;
}

export interface LearningAction {
  assetId?: string;
  action: KnowledgeAction;
  reason: string;
}

export interface AssetInventoryReport {
  projectId: string;
  assets: AssetKnowledgeSummary[];
  globalKnowns: string[];
  globalUnknowns: KnowledgeGap[];
  recommendedLearningActions: LearningAction[];
  coverageEstimate: {
    video: "none" | "partial" | "complete";
    images: "none" | "partial" | "complete";
    audio: "none" | "partial" | "complete";
    characters: "none" | "partial" | "complete";
    brandsOrLogos: "none" | "partial" | "complete";
  };
}

export interface ClipUnderstanding {
  assetId: string;
  source: "upload" | "generated";
  userContext?: UserClipContext;
  agentContext?: AgentClipContext | AgentAssetContext;
  combinedSummary: string;
  timelineHints: {
    mustUse: boolean;
    avoid: boolean;
    preferredBeats: string[];
    bestStartSec?: number;
    bestEndSec?: number;
  };
  provenance: {
    userContextUpdatedAt?: string;
    analyzedAt?: string;
    analysisVersion: string;
    sampledFrameAssetIds: string[];
  };
}

export interface RegisterAssetInput {
  source: AgentAssetSource;
  kind?: AssetKind;
  filename?: string;
  durationSec?: number;
  context?: AssetContext;
  userContext?: UserAssetContext;
  agentContext?: AgentAssetContext | AgentClipContext;
}

export interface UpdateAssetContextInput {
  context?: AssetContext;
  userContext?: UserAssetContext | null;
  agentContext?: AgentAssetContext | AgentClipContext | null;
}

export interface AssetInventoryInput {
  assetIds?: string[];
  includeExistingContext: boolean;
}

export interface AnalyzeBatchOptions {
  sampleFrames: boolean;
  transcribeAudio: boolean;
  defaultVideoSamples: number;
  maxVideoSamples: number;
  storage: "local";
}

export interface AnalyzeBatchInput {
  assetIds: string[];
  userContext?: Record<string, unknown>;
  analysisOptions: AnalyzeBatchOptions;
}

export interface AnalyzeAssetInput {
  regenerate?: boolean;
  analysisOptions?: {
    sampleFrames?: boolean;
    transcribeAudio?: boolean;
  };
}

const KIND_BY_EXTENSION: Record<string, AssetKind> = {
  mp4: "video",
  mov: "video",
  webm: "video",
  m4v: "video",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
};

export function inferKindFromName(name: string): AssetKind | undefined {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? KIND_BY_EXTENSION[ext] : undefined;
}

function parseAssetSource(input: unknown, fields: FieldError[]): AgentAssetSource | undefined {
  if (!isPlainObject(input)) {
    fields.push({ path: "source", message: "Must be an object with a `type`." });
    return undefined;
  }
  const type = input.type;
  switch (type) {
    case "remote_url": {
      const url = requireString(input.url, "source.url", fields);
      if (!url) return undefined;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          fields.push({ path: "source.url", message: "Must be an http(s) URL." });
          return undefined;
        }
      } catch {
        fields.push({ path: "source.url", message: "Must be a valid URL." });
        return undefined;
      }
      return { type: "remote_url", url };
    }
    case "local_path": {
      const p = requireString(input.path, "source.path", fields);
      if (!p) return undefined;
      return { type: "local_path", path: p };
    }
    case "multipart_upload": {
      const dataBase64 = requireString(input.dataBase64, "source.dataBase64", fields);
      if (!dataBase64) return undefined;
      const mimeType = optionalString(input.mimeType, "source.mimeType", fields);
      return { type: "multipart_upload", dataBase64, ...(mimeType ? { mimeType } : {}) };
    }
    case "storage_upload": {
      const uploadPath = requireString(input.path, "source.path", fields);
      if (!uploadPath) return undefined;
      return { type: "storage_upload", path: uploadPath };
    }
    case "generated": {
      const generatedAssetId = requireString(
        input.generatedAssetId,
        "source.generatedAssetId",
        fields
      );
      if (!generatedAssetId) return undefined;
      return { type: "generated", generatedAssetId };
    }
    default:
      fields.push({
        path: "source.type",
        message:
          "Must be one of: remote_url, local_path, multipart_upload, storage_upload, generated.",
      });
      return undefined;
  }
}

function optionalMomentArray(
  value: unknown,
  path: string,
  fields: FieldError[]
): { startSec: number; endSec: number; label?: string }[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    fields.push({ path, message: "Must be an array of moments." });
    return undefined;
  }

  const moments: { startSec: number; endSec: number; label?: string }[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(item)) {
      fields.push({ path: itemPath, message: "Must be an object." });
      return;
    }
    if (
      typeof item.startSec !== "number" ||
      !Number.isFinite(item.startSec) ||
      item.startSec < 0
    ) {
      fields.push({ path: `${itemPath}.startSec`, message: "Must be a non-negative number." });
      return;
    }
    if (
      typeof item.endSec !== "number" ||
      !Number.isFinite(item.endSec) ||
      item.endSec < item.startSec
    ) {
      fields.push({
        path: `${itemPath}.endSec`,
        message: "Must be a number greater than or equal to startSec.",
      });
      return;
    }
    moments.push({
      startSec: item.startSec,
      endSec: item.endSec,
      label: optionalString(item.label, `${itemPath}.label`, fields),
    });
  });
  return moments;
}

function optionalUsableMomentArray(
  value: unknown,
  path: string,
  fields: FieldError[]
): UsableMoment[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    fields.push({ path, message: "Must be an array of usable moments." });
    return undefined;
  }

  const moments: UsableMoment[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(item)) {
      fields.push({ path: itemPath, message: "Must be an object." });
      return;
    }
    if (
      typeof item.startSec !== "number" ||
      !Number.isFinite(item.startSec) ||
      item.startSec < 0
    ) {
      fields.push({
        path: `${itemPath}.startSec`,
        message: "Must be a non-negative number.",
      });
      return;
    }
    if (
      typeof item.endSec !== "number" ||
      !Number.isFinite(item.endSec) ||
      item.endSec < item.startSec
    ) {
      fields.push({
        path: `${itemPath}.endSec`,
        message: "Must be a number greater than or equal to startSec.",
      });
      return;
    }
    const label = requireString(item.label, `${itemPath}.label`, fields);
    const description = requireString(
      item.description,
      `${itemPath}.description`,
      fields
    );
    const suggestedUse = parseEnum(
      item.suggestedUse,
      USABLE_MOMENT_USES,
      `${itemPath}.suggestedUse`,
      fields
    );
    if (!label || !description || !suggestedUse) return;
    moments.push({
      startSec: item.startSec,
      endSec: item.endSec,
      label,
      description,
      suggestedUse,
    });
  });
  return moments;
}

function parseUserAssetContext(
  input: unknown,
  path: string,
  fields: FieldError[]
): UserAssetContext | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isPlainObject(input)) {
    fields.push({ path, message: "Must be an object." });
    return undefined;
  }
  return {
    title: optionalString(input.title, `${path}.title`, fields),
    description: optionalString(input.description, `${path}.description`, fields),
    people: optionalStringArray(input.people, `${path}.people`, fields),
    characterNames: optionalStringArray(
      input.characterNames,
      `${path}.characterNames`,
      fields
    ),
    location: optionalString(input.location, `${path}.location`, fields),
    event: optionalString(input.event, `${path}.event`, fields),
    notableMoments: optionalStringArray(
      input.notableMoments,
      `${path}.notableMoments`,
      fields
    ),
    tags: optionalStringArray(input.tags, `${path}.tags`, fields),
    transcriptHint: optionalString(input.transcriptHint, `${path}.transcriptHint`, fields),
    audioNotes: optionalString(input.audioNotes, `${path}.audioNotes`, fields),
    intendedUse: optionalEnumArray(
      input.intendedUse,
      ASSET_USES,
      `${path}.intendedUse`,
      fields
    ),
    mustUse: optionalBoolean(input.mustUse, `${path}.mustUse`, fields),
    avoid: optionalBoolean(input.avoid, `${path}.avoid`, fields),
  };
}

function parseAgentAssetContext(
  input: unknown,
  path: string,
  fields: FieldError[]
): AgentAssetContext | AgentClipContext | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isPlainObject(input)) {
    fields.push({ path, message: "Must be an object." });
    return undefined;
  }

  const summary = requireString(input.summary, `${path}.summary`, fields);
  const mediaType = parseEnum(
    input.mediaType,
    ASSET_MEDIA_TYPES,
    `${path}.mediaType`,
    fields
  );
  const confidence = parseEnum(
    input.confidence,
    KNOWLEDGE_CONFIDENCES,
    `${path}.confidence`,
    fields
  );
  const subjects = optionalStringArray(input.subjects, `${path}.subjects`, fields) ?? [];
  const likelyUses =
    optionalEnumArray(input.likelyUses, ASSET_USES, `${path}.likelyUses`, fields) ?? [];
  const cautions = optionalStringArray(input.cautions, `${path}.cautions`, fields) ?? [];
  const sampledAssetIds =
    optionalStringArray(input.sampledAssetIds, `${path}.sampledAssetIds`, fields) ?? [];

  let model: AgentAssetContext["model"] | undefined;
  if (!isPlainObject(input.model)) {
    fields.push({ path: `${path}.model`, message: "Must be an object." });
  } else {
    const provider = requireString(input.model.provider, `${path}.model.provider`, fields);
    model = {
      provider: provider as string,
      model: optionalString(input.model.model, `${path}.model.model`, fields),
    };
  }

  const base: AgentAssetContext = {
    summary: summary as string,
    mediaType: mediaType as AssetMediaType,
    subjects,
    actions: optionalStringArray(input.actions, `${path}.actions`, fields),
    setting: optionalString(input.setting, `${path}.setting`, fields),
    mood: optionalString(input.mood, `${path}.mood`, fields),
    likelyUses,
    cautions,
    transcriptSummary: optionalString(
      input.transcriptSummary,
      `${path}.transcriptSummary`,
      fields
    ),
    confidence: confidence as KnowledgeConfidence,
    sampledAssetIds,
    model: model as AgentAssetContext["model"],
  };

  if (mediaType !== "video") return base;

  return {
    ...base,
    mediaType: "video",
    visualSubjects:
      optionalStringArray(input.visualSubjects, `${path}.visualSubjects`, fields) ?? [],
    shotTypes: optionalStringArray(input.shotTypes, `${path}.shotTypes`, fields) ?? [],
    usableMoments:
      optionalUsableMomentArray(input.usableMoments, `${path}.usableMoments`, fields) ?? [],
    sampledFrames: optionalStringArray(input.sampledFrames, `${path}.sampledFrames`, fields) ?? [],
  };
}

function parseAssetContext(
  input: unknown,
  path: string,
  fields: FieldError[]
): AssetContext | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isPlainObject(input)) {
    fields.push({ path, message: "Must be an object." });
    return undefined;
  }
  const context: AssetContext = {};
  const summary = optionalString(input.summary, `${path}.summary`, fields);
  const recommendedRoles = optionalStringArray(
    input.recommendedRoles,
    `${path}.recommendedRoles`,
    fields
  );
  const transcriptText = optionalString(input.transcriptText, `${path}.transcriptText`, fields);
  const moments = optionalMomentArray(input.moments, `${path}.moments`, fields);
  if (summary !== undefined) context.summary = summary;
  if (recommendedRoles !== undefined) context.recommendedRoles = recommendedRoles;
  if (transcriptText !== undefined) context.transcriptText = transcriptText;
  if (moments !== undefined) context.moments = moments;
  return context;
}

export function parseRegisterAsset(input: unknown): RegisterAssetInput {
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  const fields: FieldError[] = [];
  const source = parseAssetSource(input.source, fields);
  const kind = parseEnum(input.kind, ASSET_KINDS, "kind", fields);
  const filename = optionalString(input.filename, "filename", fields);

  let durationSec: number | undefined;
  if (input.durationSec !== undefined && input.durationSec !== null) {
    if (typeof input.durationSec !== "number" || !Number.isFinite(input.durationSec) || input.durationSec < 0) {
      fields.push({ path: "durationSec", message: "Must be a non-negative number." });
    } else {
      durationSec = input.durationSec;
    }
  }

  const context = parseAssetContext(input.context, "context", fields);
  const userContext = parseUserAssetContext(input.userContext, "userContext", fields);
  const agentContext = parseAgentAssetContext(input.agentContext, "agentContext", fields);

  throwIfInvalid(fields);

  return {
    source: source as AgentAssetSource,
    kind,
    filename,
    durationSec,
    context,
    userContext,
    agentContext,
  };
}

export interface SetAssetVisibilityInput {
  visibility: "public" | "private";
}

export type SetProjectVisibilityInput = SetAssetVisibilityInput;

export function parseSetAssetVisibility(input: unknown): SetAssetVisibilityInput {
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  if (input.visibility !== "public" && input.visibility !== "private") {
    throw validationError('visibility must be "public" or "private".', [
      { path: "visibility", message: 'Must be "public" or "private".' },
    ]);
  }
  return { visibility: input.visibility };
}

export function parseSetProjectVisibility(input: unknown): SetProjectVisibilityInput {
  return parseSetAssetVisibility(input);
}

export function parseUpdateAssetContext(input: unknown): UpdateAssetContextInput {
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  const fields: FieldError[] = [];
  const context = parseAssetContext(input.context, "context", fields);
  const userContext =
    input.userContext === null
      ? null
      : parseUserAssetContext(input.userContext, "userContext", fields);
  const agentContext =
    input.agentContext === null
      ? null
      : parseAgentAssetContext(input.agentContext, "agentContext", fields);

  throwIfInvalid(fields);

  return { context, userContext, agentContext };
}

export function parseAssetInventory(input: unknown): AssetInventoryInput {
  if (input === undefined || input === null) {
    return { includeExistingContext: true };
  }
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  const fields: FieldError[] = [];
  const assetIds = optionalStringArray(input.assetIds, "assetIds", fields);
  const includeExistingContext =
    input.includeExistingContext === undefined
      ? true
      : optionalBoolean(input.includeExistingContext, "includeExistingContext", fields);
  throwIfInvalid(fields);
  return { assetIds, includeExistingContext: includeExistingContext ?? true };
}

export function parseAnalyzeBatch(input: unknown): AnalyzeBatchInput {
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  const fields: FieldError[] = [];

  let assetIds: string[] = [];
  if (!Array.isArray(input.assetIds) || input.assetIds.length === 0) {
    fields.push({ path: "assetIds", message: "Must be a non-empty array of asset IDs." });
  } else if (input.assetIds.some((id) => typeof id !== "string" || id.trim() === "")) {
    fields.push({ path: "assetIds", message: "Must contain only non-empty strings." });
  } else {
    assetIds = [...new Set(input.assetIds.map((id) => id.trim()))];
  }

  let userContext: Record<string, unknown> | undefined;
  if (input.userContext !== undefined && input.userContext !== null) {
    if (!isPlainObject(input.userContext)) {
      fields.push({ path: "userContext", message: "Must be an object." });
    } else {
      userContext = input.userContext;
    }
  }

  const rawOptions = isPlainObject(input.analysisOptions)
    ? input.analysisOptions
    : {};
  if (
    input.analysisOptions !== undefined &&
    input.analysisOptions !== null &&
    !isPlainObject(input.analysisOptions)
  ) {
    fields.push({ path: "analysisOptions", message: "Must be an object." });
  }

  const defaultVideoSamples = optionalInteger(
    rawOptions.defaultVideoSamples,
    "analysisOptions.defaultVideoSamples",
    fields,
    5,
    1,
    10
  );
  const maxVideoSamples = optionalInteger(
    rawOptions.maxVideoSamples,
    "analysisOptions.maxVideoSamples",
    fields,
    10,
    1,
    10
  );
  const storage = parseEnum(
    rawOptions.storage,
    ["local"],
    "analysisOptions.storage",
    fields
  );
  const sampleFrames = optionalBoolean(
    rawOptions.sampleFrames,
    "analysisOptions.sampleFrames",
    fields
  );
  const transcribeAudio = optionalBoolean(
    rawOptions.transcribeAudio,
    "analysisOptions.transcribeAudio",
    fields
  );
  if (transcribeAudio) {
    fields.push({
      path: "analysisOptions.transcribeAudio",
      message: "Audio transcription is not implemented for asset analysis yet.",
    });
  }

  throwIfInvalid(fields);

  return {
    assetIds,
    userContext,
    analysisOptions: {
      sampleFrames: sampleFrames ?? true,
      transcribeAudio: transcribeAudio ?? false,
      defaultVideoSamples,
      maxVideoSamples: Math.max(defaultVideoSamples, maxVideoSamples),
      storage: storage ?? "local",
    },
  };
}

export function parseAnalyzeAsset(input: unknown): AnalyzeAssetInput {
  const body = input === undefined || input === null ? {} : input;
  if (!isPlainObject(body)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  const fields: FieldError[] = [];
  let analysisOptions: AnalyzeAssetInput["analysisOptions"];
  if (body.analysisOptions !== undefined && body.analysisOptions !== null) {
    if (!isPlainObject(body.analysisOptions)) {
      fields.push({ path: "analysisOptions", message: "Must be an object." });
    } else {
      analysisOptions = {
        sampleFrames: optionalBoolean(
          body.analysisOptions.sampleFrames,
          "analysisOptions.sampleFrames",
          fields
        ),
        transcribeAudio: optionalBoolean(
          body.analysisOptions.transcribeAudio,
          "analysisOptions.transcribeAudio",
          fields
        ),
      };
    }
  }
  const regenerate = optionalBoolean(body.regenerate, "regenerate", fields);
  throwIfInvalid(fields);
  return {
    ...(regenerate === undefined ? {} : { regenerate }),
    ...(analysisOptions ? { analysisOptions } : {}),
  };
}


export function parseDiscoverAssetsQuery(searchParams: URLSearchParams): {
  limit: number;
  cursor: string | null;
  kind?: AssetKind;
} {
  const { limit, cursor } = parsePagination(searchParams);
  const rawKind = searchParams.get("kind");
  if (rawKind !== null && !ASSET_KINDS.includes(rawKind as AssetKind)) {
    throw new ApiError("validation_failed", "kind must be one of: video, image, audio.", {
      fields: [{ path: "kind", message: "Must be one of: video, image, audio." }],
    });
  }
  return { limit, cursor, ...(rawKind ? { kind: rawKind as AssetKind } : {}) };
}

export function parseDiscoverSearchQuery(searchParams: URLSearchParams): {
  q: string;
  limit: number;
  cursor: string | null;
  kind?: AssetKind;
  semantic?: boolean;
} {
  const q = searchParams.get("q")?.trim();
  if (!q) {
    throw new ApiError("validation_failed", "q is required.", {
      fields: [{ path: "q", message: "Must be a non-empty search query." }],
    });
  }
  if (q.length > 200) {
    throw new ApiError("validation_failed", "q must be 200 characters or fewer.", {
      fields: [{ path: "q", message: "Must be 200 characters or fewer." }],
    });
  }
  const semanticParam = searchParams.get("semantic");
  const semantic =
    semanticParam === null
      ? undefined
      : semanticParam === "1" || semanticParam.toLowerCase() === "true";
  if (
    semanticParam !== null &&
    !["1", "0", "true", "false"].includes(semanticParam.toLowerCase())
  ) {
    throw new ApiError("validation_failed", "semantic must be true or false.", {
      fields: [{ path: "semantic", message: "Must be true or false." }],
    });
  }
  return { q, semantic, ...parseDiscoverAssetsQuery(searchParams) };
}
