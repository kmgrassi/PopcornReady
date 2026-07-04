import { apiRequest, v1Api } from "./api-client";
import type { BriefDraft, StudioStep } from "../components/studio/useStudioFlow";
import { normalizeStudioStep } from "../components/studio/studioSteps";
import {
  STUDIO_DRAFT_PAYLOAD_VERSION as SHARED_STUDIO_DRAFT_PAYLOAD_VERSION,
} from "@popcorn/shared/v1/studio-drafts";
import type {
  CreateStudioDraftRequest,
  StudioDraftListResponse,
  StudioDraftPayload as SharedStudioDraftPayload,
  StudioDraftResponse,
  StudioDraftStep,
  UpdateStudioDraftRequest,
} from "@popcorn/shared/v1/studio-drafts";
import { GATEABLE_GENERATION_STAGE_TYPES } from "@popcorn/shared/v1/types";

export const STUDIO_DRAFT_PAYLOAD_VERSION = SHARED_STUDIO_DRAFT_PAYLOAD_VERSION;

export interface StudioDraftPayload {
  v: typeof STUDIO_DRAFT_PAYLOAD_VERSION;
  draft: BriefDraft;
  step: StudioStep;
  projectId?: string;
  runId?: string;
}

type SerializedBriefDraft = Omit<BriefDraft, "selectedFootage"> & { selectedFootage: [] };
type PersistedStudioDraftPayload = SharedStudioDraftPayload<SerializedBriefDraft>;

const ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;
const FOOTAGE_CHOICES = ["prompt_only", "upload"] as const;
const FOOTAGE_MODES = ["asset_driven", "hybrid"] as const;
const PLATFORMS = ["youtube", "tiktok", "reels", "facebook", "vimeo", "general"] as const;
const STORY_FORMATS = [
  "mystery_to_model",
  "visual_reveal",
  "challenge",
  "misconception",
  "animated_explainer",
  "classroom_demo",
  "aesthetic_montage",
] as const;
const SEED_KINDS = ["image", "video"] as const;

export interface StudioDraftSummary {
  draftId: string;
  excerpt: string;
  step: StudioStep;
  updatedAt: string;
  projectId?: string;
  runId?: string;
}

export interface StudioDraftRecord extends StudioDraftSummary {
  payload: StudioDraftPayload;
}

const DEFAULT_BRIEF_DRAFT: BriefDraft = {
  goal: "",
  targetLengthSec: 30,
  aspectRatio: "9:16",
  projectName: "",
  footageChoice: "prompt_only",
  footageMode: "hybrid",
  selectedFootage: [],
  audience: "",
  platform: "tiktok",
  format: "visual_reveal",
  hook: "",
  bestVisual: "",
  bigIdea: "",
  payoff: "",
  accuracyNote: "",
  style: "fast-paced social ad",
  callToAction: "",
  provider: "openai",
  seedKind: "image",
  seedSize: "1024x1792",
  showCaptions: true,
  reviewGates: [],
};

function workspacePath(workspaceId: string, suffix = ""): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/studio-drafts${suffix}`;
}

async function currentWorkspaceId(): Promise<string> {
  return (await v1Api.me()).workspaceId;
}

function normalizeStep(
  value: unknown,
  options: { hasRun?: boolean } = {},
): StudioStep {
  return normalizeStudioStep(typeof value === "string" ? value : null, options);
}

function sanitizeDraftForJson(draft: BriefDraft): BriefDraft {
  return {
    ...draft,
    selectedFootage: [],
  };
}

function buildPayload(
  draft: BriefDraft,
  step: StudioStep,
  ids: { projectId?: string; runId?: string } = {},
): StudioDraftPayload {
  return {
    v: STUDIO_DRAFT_PAYLOAD_VERSION,
    draft: sanitizeDraftForJson(draft),
    step,
    ...(ids.projectId ? { projectId: ids.projectId } : {}),
    ...(ids.runId ? { runId: ids.runId } : {}),
  };
}

function wireStepFromStudioStep(step: StudioStep): StudioDraftStep {
  return step === "plan" ? "story" : step;
}

function serializeDraft(draft: BriefDraft): SerializedBriefDraft {
  return {
    ...draft,
    selectedFootage: [],
  };
}

function hydrateDraft(draft: SerializedBriefDraft): BriefDraft {
  const nextDraft: BriefDraft = {
    ...DEFAULT_BRIEF_DRAFT,
    ...draft,
    selectedFootage: [],
  };
  if (nextDraft.footageChoice === "upload") {
    nextDraft.footageMode = "hybrid";
  }
  return nextDraft;
}

function buildWirePayload(
  draft: BriefDraft,
  step: StudioStep,
  ids: { projectId?: string; runId?: string } = {},
): PersistedStudioDraftPayload {
  const payload = buildPayload(draft, step, ids);
  return {
    ...payload,
    step: wireStepFromStudioStep(payload.step),
    draft: serializeDraft(payload.draft),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readEnum<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  fallback: TValue,
): TValue {
  return typeof value === "string" && allowed.includes(value as TValue)
    ? (value as TValue)
    : fallback;
}

function parseReviewGates(value: unknown): BriefDraft["reviewGates"] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate): candidate is BriefDraft["reviewGates"][number] =>
      typeof candidate === "string" &&
      (GATEABLE_GENERATION_STAGE_TYPES as readonly string[]).includes(candidate),
  );
}

function parseSerializedBriefDraft(value: unknown): SerializedBriefDraft | null {
  if (!isRecord(value)) return null;

  return {
    goal: stringOrDefault(value.goal, DEFAULT_BRIEF_DRAFT.goal),
    targetLengthSec: numberOrDefault(value.targetLengthSec, DEFAULT_BRIEF_DRAFT.targetLengthSec),
    aspectRatio: readEnum(value.aspectRatio, ASPECT_RATIOS, DEFAULT_BRIEF_DRAFT.aspectRatio),
    projectName: stringOrDefault(value.projectName, DEFAULT_BRIEF_DRAFT.projectName),
    footageChoice: readEnum(
      value.footageChoice,
      FOOTAGE_CHOICES,
      DEFAULT_BRIEF_DRAFT.footageChoice,
    ),
    footageMode: readEnum(value.footageMode, FOOTAGE_MODES, DEFAULT_BRIEF_DRAFT.footageMode),
    selectedFootage: [],
    audience: stringOrDefault(value.audience, DEFAULT_BRIEF_DRAFT.audience),
    platform: readEnum(value.platform, PLATFORMS, DEFAULT_BRIEF_DRAFT.platform),
    format: readEnum(value.format, STORY_FORMATS, DEFAULT_BRIEF_DRAFT.format),
    hook: stringOrDefault(value.hook, DEFAULT_BRIEF_DRAFT.hook),
    bestVisual: stringOrDefault(value.bestVisual, DEFAULT_BRIEF_DRAFT.bestVisual),
    bigIdea: stringOrDefault(value.bigIdea, DEFAULT_BRIEF_DRAFT.bigIdea),
    payoff: stringOrDefault(value.payoff, DEFAULT_BRIEF_DRAFT.payoff),
    accuracyNote: stringOrDefault(value.accuracyNote, DEFAULT_BRIEF_DRAFT.accuracyNote),
    style: stringOrDefault(value.style, DEFAULT_BRIEF_DRAFT.style),
    callToAction: stringOrDefault(value.callToAction, DEFAULT_BRIEF_DRAFT.callToAction),
    provider: stringOrDefault(value.provider, DEFAULT_BRIEF_DRAFT.provider),
    seedKind: readEnum(value.seedKind, SEED_KINDS, DEFAULT_BRIEF_DRAFT.seedKind),
    seedSize: stringOrDefault(value.seedSize, DEFAULT_BRIEF_DRAFT.seedSize),
    showCaptions: booleanOrDefault(value.showCaptions, DEFAULT_BRIEF_DRAFT.showCaptions),
    reviewGates: parseReviewGates(value.reviewGates),
  };
}

export function payloadFromUnknown(value: unknown): StudioDraftPayload | null {
  if (!isRecord(value) || value.v !== STUDIO_DRAFT_PAYLOAD_VERSION) return null;
  const serializedDraft = parseSerializedBriefDraft(value.draft);
  if (!serializedDraft) return null;
  const draft = hydrateDraft(serializedDraft);
  const projectId = typeof value.projectId === "string" ? value.projectId : undefined;
  const runId = typeof value.runId === "string" ? value.runId : undefined;

  return {
    v: STUDIO_DRAFT_PAYLOAD_VERSION,
    draft,
    step: normalizeStep(value.step, { hasRun: Boolean(projectId && runId) }),
    projectId,
    runId,
  };
}

export function recordFromUnknown(value: unknown): StudioDraftRecord | null {
  if (!isRecord(value)) return null;
  const draftId =
    typeof value.draftId === "string"
      ? value.draftId
      : typeof value.id === "string"
        ? value.id
        : null;
  if (!draftId) return null;

  const payload = payloadFromUnknown(value.payload);
  const projectId =
    typeof value.projectId === "string" ? value.projectId : payload?.projectId;
  const runId = typeof value.runId === "string" ? value.runId : payload?.runId;
  const step = normalizeStep(value.step ?? payload?.step, {
    hasRun: Boolean(projectId && runId),
  });
  const goal = payload?.draft.goal.trim();
  const excerpt =
    typeof value.excerpt === "string" && value.excerpt.trim()
      ? value.excerpt
      : typeof value.displayExcerpt === "string" && value.displayExcerpt.trim()
        ? value.displayExcerpt
        : goal || "Untitled draft";
  return {
    draftId,
    excerpt,
    step,
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    projectId,
    runId,
    payload:
      payload ??
      buildPayload(DEFAULT_BRIEF_DRAFT, step, {
        projectId,
        runId,
      }),
  };
}

async function readDraftRecord(response: Promise<StudioDraftResponse>): Promise<StudioDraftRecord> {
  const { draft } = await response;
  const record = recordFromUnknown(draft);
  if (!record) {
    throw new Error("The saved draft could not be read.");
  }
  return record;
}

export async function listDrafts(): Promise<StudioDraftSummary[]> {
  const workspaceId = await currentWorkspaceId();
  const { drafts } = await apiRequest<StudioDraftListResponse>(workspacePath(workspaceId), {
    method: "GET",
  });
  return drafts
    .map(recordFromUnknown)
    .filter((draft): draft is StudioDraftRecord => Boolean(draft))
    .map(({ payload: _payload, ...summary }) => summary);
}

export async function createDraft(
  draft: BriefDraft = DEFAULT_BRIEF_DRAFT,
  step: StudioStep = "brief",
): Promise<StudioDraftRecord> {
  const workspaceId = await currentWorkspaceId();
  const body: CreateStudioDraftRequest = { payload: buildWirePayload(draft, step) };
  return readDraftRecord(
    apiRequest<StudioDraftResponse>(workspacePath(workspaceId), {
      method: "POST",
      body,
    }),
  );
}

export async function loadDraft(draftId: string): Promise<StudioDraftRecord> {
  const workspaceId = await currentWorkspaceId();
  return readDraftRecord(
    apiRequest<StudioDraftResponse>(
      workspacePath(workspaceId, `/${encodeURIComponent(draftId)}`),
      { method: "GET" },
    ),
  );
}

export async function saveDraft(
  draftId: string,
  draft: BriefDraft,
  step: StudioStep,
  ids: { projectId?: string; runId?: string } = {},
): Promise<StudioDraftRecord> {
  const workspaceId = await currentWorkspaceId();
  const body: UpdateStudioDraftRequest = {
    payload: buildWirePayload(draft, step, ids),
  };
  return readDraftRecord(
    apiRequest<StudioDraftResponse>(
      workspacePath(workspaceId, `/${encodeURIComponent(draftId)}`),
      {
        method: "PUT",
        body,
      },
    ),
  );
}

export async function deleteDraft(draftId: string): Promise<void> {
  const workspaceId = await currentWorkspaceId();
  await apiRequest<void>(workspacePath(workspaceId, `/${encodeURIComponent(draftId)}`), {
    method: "DELETE",
  });
}
