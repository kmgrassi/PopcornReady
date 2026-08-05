// Request/response schemas and lightweight validators for the v1 agent API.
// Validation is intentionally hand-written (no schema library) to match the
// rest of the codebase. Validators throw ApiError("validation_failed").

import type {
  CreateStudioDraftRequest,
  StudioDraftBrief,
  StudioDraftFootageChoice,
  StudioDraftFootageMode,
  StudioDraftPayload,
  StudioDraftStep,
  UpdateStudioDraftRequest,
} from "@popcorn/shared/v1/studio-drafts";
import type { FieldError } from "./errors";
import { validationError } from "./errors";
import { parsePagination } from "./schema-pagination";
import {
  isPlainObject,
  optionalInteger,
  optionalString,
  optionalStringArray,
  parseEnum,
  requireString,
  throwIfInvalid,
} from "./schema-validation";
export { parsePagination } from "./schema-pagination";
export * from "./asset-schemas";
export * from "./asset-search-schemas";
export * from "./catalog-schemas";

export const SCHEMA_VERSIONS = {
  workspace: "workspace.v1",
  project: "project.v1",
  briefVersion: "briefVersion.v1",
  asset: "asset.v1",
} as const;

export type AspectRatio = "9:16" | "16:9" | "1:1";
const ASPECT_RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1"];

export type Platform =
  | "youtube"
  | "tiktok"
  | "reels"
  | "facebook"
  | "vimeo"
  | "general";
const PLATFORMS: Platform[] = [
  "youtube",
  "tiktok",
  "reels",
  "facebook",
  "vimeo",
  "general",
];

export type VideoFormat =
  | "mystery_to_model"
  | "visual_reveal"
  | "challenge"
  | "misconception"
  | "animated_explainer"
  | "classroom_demo"
  | "aesthetic_montage";
const VIDEO_FORMATS: VideoFormat[] = [
  "mystery_to_model",
  "visual_reveal",
  "challenge",
  "misconception",
  "animated_explainer",
  "classroom_demo",
  "aesthetic_montage",
];
export const STORY_FORMATS = VIDEO_FORMATS;

export type NarrationMode = "none" | "generate" | "provided_text" | "provided_asset";
const NARRATION_MODES: NarrationMode[] = [
  "none",
  "generate",
  "provided_text",
  "provided_asset",
];

const STUDIO_DRAFT_STEPS: StudioDraftStep[] = [
  "brief",
  "footage",
  "story",
  "generate",
  "review",
  "export",
];
const STUDIO_DRAFT_FOOTAGE_CHOICES: StudioDraftFootageChoice[] = ["prompt_only", "upload"];
const STUDIO_DRAFT_FOOTAGE_MODES: StudioDraftFootageMode[] = ["asset_driven", "hybrid"];

export interface NarrationInput {
  mode: NarrationMode;
  script?: string;
  voiceId?: string;
  audioAssetId?: string;
}

export interface BriefConstraints {
  mustUseAssetIds?: string[];
  avoidAssetIds?: string[];
  requiredBeats?: string[];
  forbiddenClaims?: string[];
  brandVoice?: string;
  callToAction?: string;
}

export interface VideoBrief {
  goal: string;
  targetLengthSec: number;
  aspectRatio: AspectRatio;
  platform?: Platform;
  audience?: string;
  style?: string;
  format?: VideoFormat;
  hookQuestion?: string;
  strongestVisual?: string;
  oneBigIdea?: string;
  caveat?: string;
  payoff?: string;
  narration?: NarrationInput;
  constraints?: BriefConstraints;
}


export function parseBrief(input: unknown, pathPrefix = "brief"): VideoBrief {
  const fields: FieldError[] = [];
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path: pathPrefix, message: "Must be an object." },
    ]);
  }

  const goal = requireString(input.goal, `${pathPrefix}.goal`, fields);

  let targetLengthSec: number | undefined;
  if (
    typeof input.targetLengthSec !== "number" ||
    !Number.isFinite(input.targetLengthSec) ||
    input.targetLengthSec < 1 ||
    input.targetLengthSec > 600
  ) {
    fields.push({
      path: `${pathPrefix}.targetLengthSec`,
      message: "Must be a number between 1 and 600.",
    });
  } else {
    targetLengthSec = input.targetLengthSec;
  }

  const aspectRatio = parseEnum(
    input.aspectRatio,
    ASPECT_RATIOS,
    `${pathPrefix}.aspectRatio`,
    fields
  );

  const platform = parseEnum(
    input.platform,
    PLATFORMS,
    `${pathPrefix}.platform`,
    fields
  );
  const format = parseEnum(
    input.format,
    VIDEO_FORMATS,
    `${pathPrefix}.format`,
    fields
  );

  let narration: NarrationInput | undefined;
  if (input.narration !== undefined && input.narration !== null) {
    if (!isPlainObject(input.narration)) {
      fields.push({ path: `${pathPrefix}.narration`, message: "Must be an object." });
    } else {
      const mode = parseEnum(
        input.narration.mode,
        NARRATION_MODES,
        `${pathPrefix}.narration.mode`,
        fields
      );
      if (mode) {
        narration = {
          mode,
          script: optionalString(
            input.narration.script,
            `${pathPrefix}.narration.script`,
            fields
          ),
          voiceId: optionalString(
            input.narration.voiceId,
            `${pathPrefix}.narration.voiceId`,
            fields
          ),
          audioAssetId: optionalString(
            input.narration.audioAssetId,
            `${pathPrefix}.narration.audioAssetId`,
            fields
          ),
        };
      }
    }
  }

  let constraints: BriefConstraints | undefined;
  if (input.constraints !== undefined && input.constraints !== null) {
    if (!isPlainObject(input.constraints)) {
      fields.push({ path: `${pathPrefix}.constraints`, message: "Must be an object." });
    } else {
      const c = input.constraints;
      constraints = {
        mustUseAssetIds: optionalStringArray(
          c.mustUseAssetIds,
          `${pathPrefix}.constraints.mustUseAssetIds`,
          fields
        ),
        avoidAssetIds: optionalStringArray(
          c.avoidAssetIds,
          `${pathPrefix}.constraints.avoidAssetIds`,
          fields
        ),
        requiredBeats: optionalStringArray(
          c.requiredBeats,
          `${pathPrefix}.constraints.requiredBeats`,
          fields
        ),
        forbiddenClaims: optionalStringArray(
          c.forbiddenClaims,
          `${pathPrefix}.constraints.forbiddenClaims`,
          fields
        ),
        brandVoice: optionalString(
          c.brandVoice,
          `${pathPrefix}.constraints.brandVoice`,
          fields
        ),
        callToAction: optionalString(
          c.callToAction,
          `${pathPrefix}.constraints.callToAction`,
          fields
        ),
      };
    }
  }

  // Validate optional text fields before throwing so malformed values surface
  // as validation_failed rather than being silently coerced to undefined.
  const audience = optionalString(input.audience, `${pathPrefix}.audience`, fields);
  const style = optionalString(input.style, `${pathPrefix}.style`, fields);
  const hookQuestion = optionalString(
    input.hookQuestion,
    `${pathPrefix}.hookQuestion`,
    fields
  );
  const strongestVisual = optionalString(
    input.strongestVisual,
    `${pathPrefix}.strongestVisual`,
    fields
  );
  const oneBigIdea = optionalString(
    input.oneBigIdea,
    `${pathPrefix}.oneBigIdea`,
    fields
  );
  const caveat = optionalString(input.caveat, `${pathPrefix}.caveat`, fields);
  const payoff = optionalString(input.payoff, `${pathPrefix}.payoff`, fields);

  throwIfInvalid(fields);

  return {
    goal: goal as string,
    targetLengthSec: targetLengthSec as number,
    aspectRatio: aspectRatio as AspectRatio,
    audience,
    style,
    platform,
    format,
    hookQuestion,
    strongestVisual,
    oneBigIdea,
    caveat,
    payoff,
    narration,
    constraints,
  };
}

export interface CreateProjectInput {
  name?: string;
  brief?: VideoBrief;
  posterProvider?: string;
  namingPrompt?: string;
  namingContext?: "image" | "video" | "soundtrack";
}

const PROJECT_NAMING_CONTEXTS: NonNullable<CreateProjectInput["namingContext"]>[] = [
  "image",
  "video",
  "soundtrack",
];
const MAX_PROJECT_NAMING_PROMPT_LENGTH = 500;

export type ProjectListOrder = "createdAt" | "updatedAt";

export function parseProjectListOrder(
  searchParams: URLSearchParams
): ProjectListOrder {
  const order = searchParams.get("order") ?? "createdAt";
  if (order !== "createdAt" && order !== "updatedAt") {
    throw validationError("The request query is invalid.", [
      { path: "order", message: "Must be createdAt or updatedAt." },
    ]);
  }
  return order;
}

export function parseCreateProject(input: unknown): CreateProjectInput {
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  const fields: FieldError[] = [];
  const name = optionalString(input.name, "name", fields);
  const posterProvider = optionalString(input.posterProvider, "posterProvider", fields);
  const namingPrompt = optionalString(input.namingPrompt, "namingPrompt", fields);
  const namingContext = parseEnum(
    input.namingContext,
    PROJECT_NAMING_CONTEXTS,
    "namingContext",
    fields,
  );
  if (namingPrompt && namingPrompt.length > MAX_PROJECT_NAMING_PROMPT_LENGTH) {
    fields.push({
      path: "namingPrompt",
      message: `Must be ${MAX_PROJECT_NAMING_PROMPT_LENGTH} characters or fewer.`,
    });
  }
  throwIfInvalid(fields);

  const brief =
    input.brief !== undefined && input.brief !== null
      ? parseBrief(input.brief)
      : undefined;

  return {
    ...(name ? { name } : {}),
    ...(brief ? { brief } : {}),
    ...(posterProvider ? { posterProvider } : {}),
    ...(namingPrompt ? { namingPrompt } : {}),
    ...(namingContext ? { namingContext } : {}),
  };
}

function parseStudioDraftPayload(input: unknown, path: string): StudioDraftPayload {
  const fields: FieldError[] = [];
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path, message: "Must be an object." },
    ]);
  }

  if (input.v !== 1) {
    fields.push({ path: `${path}.v`, message: "Must be 1." });
  }
  if (!isPlainObject(input.draft)) {
    fields.push({ path: `${path}.draft`, message: "Must be an object." });
  }
  const step = parseEnum(input.step, STUDIO_DRAFT_STEPS, `${path}.step`, fields);
  const projectId = optionalString(input.projectId, `${path}.projectId`, fields);
  const runId = optionalString(input.runId, `${path}.runId`, fields);

  throwIfInvalid(fields);

  const payload: StudioDraftPayload = {
    v: 1,
    draft: parseStudioDraftBrief(input.draft as Record<string, unknown>, `${path}.draft`),
    step: step as StudioDraftStep,
  };
  if (projectId !== undefined) payload.projectId = projectId;
  if (runId !== undefined) payload.runId = runId;
  return payload;
}

function parseStudioDraftBrief(input: Record<string, unknown>, path: string): StudioDraftBrief {
  const fields: FieldError[] = [];
  const targetLengthSec = optionalInteger(
    input.targetLengthSec,
    `${path}.targetLengthSec`,
    fields,
    30,
    0,
    Number.MAX_SAFE_INTEGER
  );

  const draft: StudioDraftBrief = {};
  const goal = optionalString(input.goal, `${path}.goal`, fields);
  const aspectRatio = parseEnum(input.aspectRatio, ASPECT_RATIOS, `${path}.aspectRatio`, fields);
  const projectName = optionalString(input.projectName, `${path}.projectName`, fields);
  const footageChoice = parseEnum(
    input.footageChoice,
    STUDIO_DRAFT_FOOTAGE_CHOICES,
    `${path}.footageChoice`,
    fields
  );
  const footageMode = parseEnum(
    input.footageMode,
    STUDIO_DRAFT_FOOTAGE_MODES,
    `${path}.footageMode`,
    fields
  );
  const audience = optionalString(input.audience, `${path}.audience`, fields);
  const platform = parseEnum(input.platform, PLATFORMS, `${path}.platform`, fields);
  const format = parseEnum(input.format, VIDEO_FORMATS, `${path}.format`, fields);
  const hook = optionalString(input.hook, `${path}.hook`, fields);
  const bestVisual = optionalString(input.bestVisual, `${path}.bestVisual`, fields);
  const bigIdea = optionalString(input.bigIdea, `${path}.bigIdea`, fields);
  const payoff = optionalString(input.payoff, `${path}.payoff`, fields);
  const accuracyNote = optionalString(input.accuracyNote, `${path}.accuracyNote`, fields);
  const style = optionalString(input.style, `${path}.style`, fields);
  const callToAction = optionalString(input.callToAction, `${path}.callToAction`, fields);
  const provider = optionalString(input.provider, `${path}.provider`, fields);

  throwIfInvalid(fields);

  if (goal !== undefined) draft.goal = goal;
  if (input.targetLengthSec !== undefined && input.targetLengthSec !== null) {
    draft.targetLengthSec = targetLengthSec;
  }
  if (aspectRatio !== undefined) draft.aspectRatio = aspectRatio;
  if (projectName !== undefined) draft.projectName = projectName;
  if (footageChoice !== undefined) draft.footageChoice = footageChoice;
  if (footageMode !== undefined) draft.footageMode = footageMode;
  if (audience !== undefined) draft.audience = audience;
  if (platform !== undefined) draft.platform = platform;
  if (format !== undefined) draft.format = format;
  if (hook !== undefined) draft.hook = hook;
  if (bestVisual !== undefined) draft.bestVisual = bestVisual;
  if (bigIdea !== undefined) draft.bigIdea = bigIdea;
  if (payoff !== undefined) draft.payoff = payoff;
  if (accuracyNote !== undefined) draft.accuracyNote = accuracyNote;
  if (style !== undefined) draft.style = style;
  if (callToAction !== undefined) draft.callToAction = callToAction;
  if (provider !== undefined) draft.provider = provider;

  return draft;
}

export function parseCreateStudioDraft(input: unknown): CreateStudioDraftRequest {
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  return { payload: parseStudioDraftPayload(input.payload, "payload") };
}

export function parseUpdateStudioDraft(input: unknown): UpdateStudioDraftRequest {
  if (!isPlainObject(input)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  return { payload: parseStudioDraftPayload(input.payload, "payload") };
}
