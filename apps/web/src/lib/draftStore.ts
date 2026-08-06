import { apiRequest, v1Api } from "./api-client";
import type { BriefDraft, StudioStep } from "../components/studio/useStudioFlow";
import { normalizeStudioStep } from "../components/studio/studioSteps";
import {
  STUDIO_DRAFT_PAYLOAD_VERSION as SHARED_STUDIO_DRAFT_PAYLOAD_VERSION,
} from "@popcorn/shared/v1/studio-drafts";
import type {
  CreateStudioDraftRequest,
  StudioDraftBrief,
  StudioDraftFootageChoice,
  StudioDraftFootageMode,
  StudioDraftFormat,
  StudioDraftListResponse,
  StudioDraftPayload as SharedStudioDraftPayload,
  StudioDraftPlatform,
  StudioDraftStartSource,
  StudioDraftResponse,
  StudioDraftStep,
  UpdateStudioDraftRequest,
} from "@popcorn/shared/v1/studio-drafts";
import type { AspectRatio } from "@popcorn/shared/v1/types";

export const STUDIO_DRAFT_PAYLOAD_VERSION = SHARED_STUDIO_DRAFT_PAYLOAD_VERSION;

export interface StudioDraftPayload {
  v: typeof STUDIO_DRAFT_PAYLOAD_VERSION;
  draft: BriefDraft;
  step: StudioStep;
  projectId?: string;
  runId?: string;
}

type PersistedStudioDraftPayload = SharedStudioDraftPayload<StudioDraftBrief>;

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
  startSource: "idea",
  scriptText: "",
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

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function startSourceOrUndefined(value: unknown): StudioDraftStartSource | undefined {
  return value === "idea" || value === "script" ? value : undefined;
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

function serializeDraft(draft: BriefDraft): StudioDraftBrief {
  return {
    startSource: draft.startSource,
    scriptText: draft.scriptText,
    goal: draft.goal,
    targetLengthSec: draft.targetLengthSec,
    aspectRatio: draft.aspectRatio,
    projectName: draft.projectName,
    footageChoice: draft.footageChoice,
    footageMode: draft.footageMode,
    audience: draft.audience,
    platform: draft.platform,
    format: draft.format,
    hook: draft.hook,
    bestVisual: draft.bestVisual,
    bigIdea: draft.bigIdea,
    payoff: draft.payoff,
    accuracyNote: draft.accuracyNote,
    style: draft.style,
    callToAction: draft.callToAction,
    provider: draft.provider,
  };
}

function hydrateDraft(draft: StudioDraftBrief): BriefDraft {
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

function persistedDraftFromUnknown(value: unknown): StudioDraftBrief | null {
  if (!isRecord(value)) return null;

  const draft: StudioDraftBrief = {};
  const startSource = startSourceOrUndefined(value.startSource);
  const scriptText = stringOrUndefined(value.scriptText);
  const goal = stringOrUndefined(value.goal);
  const targetLengthSec = numberOrUndefined(value.targetLengthSec);
  const aspectRatio = aspectRatioOrUndefined(value.aspectRatio);
  const projectName = stringOrUndefined(value.projectName);
  const footageChoice = footageChoiceOrUndefined(value.footageChoice);
  const footageMode = footageModeOrUndefined(value.footageMode);
  const audience = stringOrUndefined(value.audience);
  const platform = platformOrUndefined(value.platform);
  const format = formatOrUndefined(value.format);
  const hook = stringOrUndefined(value.hook);
  const bestVisual = stringOrUndefined(value.bestVisual);
  const bigIdea = stringOrUndefined(value.bigIdea);
  const payoff = stringOrUndefined(value.payoff);
  const accuracyNote = stringOrUndefined(value.accuracyNote);
  const style = stringOrUndefined(value.style);
  const callToAction = stringOrUndefined(value.callToAction);
  const provider = stringOrUndefined(value.provider);

  if (startSource !== undefined) draft.startSource = startSource;
  if (scriptText !== undefined) draft.scriptText = scriptText;
  if (goal !== undefined) draft.goal = goal;
  if (targetLengthSec !== undefined) draft.targetLengthSec = targetLengthSec;
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

export function payloadFromUnknown(value: unknown): StudioDraftPayload | null {
  if (!isRecord(value) || value.v !== STUDIO_DRAFT_PAYLOAD_VERSION) return null;
  const parsedDraft = persistedDraftFromUnknown(value.draft);
  if (!parsedDraft) return null;
  const projectId = typeof value.projectId === "string" ? value.projectId : undefined;
  const runId = typeof value.runId === "string" ? value.runId : undefined;

  return {
    v: STUDIO_DRAFT_PAYLOAD_VERSION,
    draft: hydrateDraft(parsedDraft),
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
