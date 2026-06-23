// Request/response schemas and lightweight validators for the v1 agent API.
// Validation is intentionally hand-written (no schema library) to match the
// rest of the codebase. Validators throw ApiError("validation_failed").

import type {
  CreateStudioDraftRequest,
  StudioDraftPayload,
  StudioDraftStep,
  UpdateStudioDraftRequest,
} from "@popcorn/shared/v1/studio-drafts";
import type { FieldError } from "./errors";
import { validationError } from "./errors";
import { parsePagination } from "./schema-pagination";
import {
  isPlainObject,
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
  throwIfInvalid(fields);

  const brief =
    input.brief !== undefined && input.brief !== null
      ? parseBrief(input.brief)
      : undefined;

  return {
    ...(name ? { name } : {}),
    ...(brief ? { brief } : {}),
    ...(posterProvider ? { posterProvider } : {}),
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
    draft: input.draft as Record<string, unknown>,
    step: step as StudioDraftStep,
  };
  if (projectId !== undefined) payload.projectId = projectId;
  if (runId !== undefined) payload.runId = runId;
  return payload;
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
