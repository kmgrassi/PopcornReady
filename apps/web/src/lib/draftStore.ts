import { apiRequest, v1Api } from "./api-client";
import type { BriefDraft, StudioStep } from "../components/studio/useStudioFlow";
import { normalizeStudioStep } from "../components/studio/studioSteps";
import type {
  CreateStudioDraftRequest,
  StudioDraftBrief,
  StudioDraftFootageChoice,
  StudioDraftFootageMode,
  StudioDraftFormat,
  StudioDraftPlatform,
  StudioDraftListResponse,
  StudioDraftPayload as WireStudioDraftPayload,
  StudioDraftResponse,
  StudioDraftSeedKind,
  StudioDraftStep,
  UpdateStudioDraftRequest,
} from "@popcorn/shared/v1/studio-drafts";
import type { AspectRatio, GateableGenerationStageType } from "@popcorn/shared/v1/types";

export const STUDIO_DRAFT_PAYLOAD_VERSION = 1;

export interface StudioDraftPayload {
  v: typeof STUDIO_DRAFT_PAYLOAD_VERSION;
  draft: BriefDraft;
  step: StudioStep;
  projectId?: string;
  runId?: string;
}

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

function normalizeStep(value: unknown): StudioStep {
  return normalizeStudioStep(typeof value === "string" ? value : null);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function aspectRatioOrUndefined(value: unknown): AspectRatio | undefined {
  return value === "9:16" || value === "16:9" || value === "1:1" ? value : undefined;
}

function footageChoiceOrUndefined(value: unknown): StudioDraftFootageChoice | undefined {
  return value === "prompt_only" || value === "upload" ? value : undefined;
}

function footageModeOrUndefined(value: unknown): StudioDraftFootageMode | undefined {
  return value === "asset_driven" || value === "hybrid" ? value : undefined;
}

function platformOrUndefined(value: unknown): StudioDraftPlatform | undefined {
  return value === "youtube" ||
    value === "tiktok" ||
    value === "reels" ||
    value === "facebook" ||
    value === "vimeo" ||
    value === "general"
    ? value
    : undefined;
}

function formatOrUndefined(value: unknown): StudioDraftFormat | undefined {
  return value === "mystery_to_model" ||
    value === "visual_reveal" ||
    value === "challenge" ||
    value === "misconception" ||
    value === "animated_explainer" ||
    value === "classroom_demo" ||
    value === "aesthetic_montage"
    ? value
    : undefined;
}

function seedKindOrUndefined(value: unknown): StudioDraftSeedKind | undefined {
  return value === "image" || value === "video" ? value : undefined;
}

function reviewGatesOrUndefined(value: unknown): GateableGenerationStageType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (gate): gate is GateableGenerationStageType =>
      gate === "brief_intake" ||
      gate === "creative_plan" ||
      gate === "storyboard" ||
      gate === "asset_generation" ||
      gate === "audio_generation" ||
      gate === "timeline_assembly" ||
      gate === "quality_review" ||
      gate === "export"
  );
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

function buildWirePayload(
  draft: BriefDraft,
  step: StudioStep,
  ids: { projectId?: string; runId?: string } = {},
): WireStudioDraftPayload {
  const payload = buildPayload(draft, step, ids);
  return {
    ...payload,
    step: wireStepFromStudioStep(payload.step),
    draft: payload.draft,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function persistedDraftFromUnknown(value: unknown): StudioDraftBrief | null {
  if (!isRecord(value)) return null;
  return {
    goal: stringOrUndefined(value.goal),
    targetLengthSec: numberOrUndefined(value.targetLengthSec),
    aspectRatio: aspectRatioOrUndefined(value.aspectRatio),
    projectName: stringOrUndefined(value.projectName),
    footageChoice: footageChoiceOrUndefined(value.footageChoice),
    footageMode: footageModeOrUndefined(value.footageMode),
    audience: stringOrUndefined(value.audience),
    platform: platformOrUndefined(value.platform),
    format: formatOrUndefined(value.format),
    hook: stringOrUndefined(value.hook),
    bestVisual: stringOrUndefined(value.bestVisual),
    bigIdea: stringOrUndefined(value.bigIdea),
    payoff: stringOrUndefined(value.payoff),
    accuracyNote: stringOrUndefined(value.accuracyNote),
    style: stringOrUndefined(value.style),
    callToAction: stringOrUndefined(value.callToAction),
    provider: stringOrUndefined(value.provider),
    seedKind: seedKindOrUndefined(value.seedKind),
    seedSize: stringOrUndefined(value.seedSize),
    showCaptions: booleanOrUndefined(value.showCaptions),
    reviewGates: reviewGatesOrUndefined(value.reviewGates),
  };
}

function payloadFromUnknown(value: unknown): StudioDraftPayload | null {
  if (!isRecord(value) || value.v !== STUDIO_DRAFT_PAYLOAD_VERSION) return null;
  const parsedDraft = persistedDraftFromUnknown(value.draft);
  if (!parsedDraft) return null;

  const draft = {
    ...DEFAULT_BRIEF_DRAFT,
    ...parsedDraft,
    selectedFootage: [],
  };
  if (draft.footageChoice === "upload") {
    draft.footageMode = "hybrid";
  }

  return {
    v: STUDIO_DRAFT_PAYLOAD_VERSION,
    draft,
    step: normalizeStep(value.step),
    projectId: typeof value.projectId === "string" ? value.projectId : undefined,
    runId: typeof value.runId === "string" ? value.runId : undefined,
  };
}

function recordFromUnknown(value: unknown): StudioDraftRecord | null {
  if (!isRecord(value)) return null;
  const draftId =
    typeof value.draftId === "string"
      ? value.draftId
      : typeof value.id === "string"
        ? value.id
        : null;
  if (!draftId) return null;

  const payload = payloadFromUnknown(value.payload);
  const step = normalizeStep(value.step ?? payload?.step);
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
    projectId:
      typeof value.projectId === "string" ? value.projectId : payload?.projectId,
    runId: typeof value.runId === "string" ? value.runId : payload?.runId,
    payload:
      payload ??
      buildPayload(DEFAULT_BRIEF_DRAFT, step, {
        projectId: typeof value.projectId === "string" ? value.projectId : undefined,
        runId: typeof value.runId === "string" ? value.runId : undefined,
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
