import { ApiError } from "./errors";
import type {
  BeatInput,
  PanelInput,
  SceneInput,
  StoryboardInput,
  StoryboardItemStatus,
  StoryboardStatus,
} from "./storyboards-types";

const STORYBOARD_STATUSES: StoryboardStatus[] = [
  "draft",
  "generating",
  "ready",
  "reviewing",
  "approved",
  "archived",
];

const ITEM_STATUSES: StoryboardItemStatus[] = [
  "draft",
  "queued",
  "generating",
  "ready",
  "approved",
  "rejected",
  "failed",
];

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function optionalString(
  body: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("validation_failed", `${key} must be a string or null.`);
  }
  return value;
}

function optionalNonnegativeNumber(
  body: Record<string, unknown>,
  key: string
): number | null | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ApiError("validation_failed", `${key} must be a non-negative number or null.`);
  }
  return value;
}

function optionalNonnegativeInteger(
  body: Record<string, unknown>,
  key: string
): number | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ApiError("validation_failed", `${key} must be a non-negative integer.`);
  }
  return value as number;
}

function optionalBoolean(
  body: Record<string, unknown>,
  key: string
): boolean | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (typeof value !== "boolean") {
    throw new ApiError("validation_failed", `${key} must be a boolean.`);
  }
  return value;
}

function optionalStatus<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | undefined {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ApiError(
      "validation_failed",
      `${key} must be one of: ${allowed.join(", ")}.`
    );
  }
  return value as T;
}

export function parseStoryboardInput(body: unknown): StoryboardInput {
  const obj = bodyObject(body);
  return {
    planAssetId: optionalString(obj, "planAssetId"),
    status: optionalStatus(obj, "status", STORYBOARD_STATUSES),
  };
}

export function parseSceneInput(body: unknown): SceneInput {
  const obj = bodyObject(body);
  return {
    sceneIndex: optionalNonnegativeInteger(obj, "sceneIndex"),
    title: optionalString(obj, "title"),
    summary: optionalString(obj, "summary"),
    setting: optionalString(obj, "setting"),
    mood: optionalString(obj, "mood"),
    durationSec: optionalNonnegativeNumber(obj, "durationSec"),
    sceneAssetId: optionalString(obj, "sceneAssetId"),
    status: optionalStatus(obj, "status", ITEM_STATUSES),
  };
}

export function parseBeatInput(body: unknown): BeatInput {
  const obj = bodyObject(body);
  const intent = optionalString(obj, "intent");
  if (intent === null) {
    throw new ApiError("validation_failed", "intent must be a string.");
  }
  return {
    beatIndex: optionalNonnegativeInteger(obj, "beatIndex"),
    intent,
    visualDescription: optionalString(obj, "visualDescription"),
    dialogueSummary: optionalString(obj, "dialogueSummary"),
    narration: optionalString(obj, "narration"),
    durationSec: optionalNonnegativeNumber(obj, "durationSec"),
    shotType: optionalString(obj, "shotType"),
    camera: optionalString(obj, "camera"),
    framing: optionalString(obj, "framing"),
    status: optionalStatus(obj, "status", ITEM_STATUSES),
    beatAssetId: optionalString(obj, "beatAssetId"),
  };
}

export function parsePanelInput(body: unknown): PanelInput {
  const obj = bodyObject(body);
  return {
    panelIndex: optionalNonnegativeInteger(obj, "panelIndex"),
    imageAssetId: optionalString(obj, "imageAssetId"),
    promptAssetId: optionalString(obj, "promptAssetId"),
    status: optionalStatus(obj, "status", ITEM_STATUSES),
    isSelected: optionalBoolean(obj, "isSelected"),
    approvedAt: optionalString(obj, "approvedAt"),
  };
}
