import type { AuthContext } from "./auth";
import { ApiError, validationError, type FieldError } from "./errors";
import type { ApiResult } from "./handler";
import {
  addAudioFitCritique,
  getActiveProjectPlan,
  getAsset,
} from "./store";
import {
  fitAudioToPicture,
  type AudioFitDecision,
  type AudioFitWindow,
  type AudioFitWord,
} from "@popcorn/shared/audio-fit";
import type { Beat, ShotPlan } from "@popcorn/shared/types";

export interface AudioFitRequest {
  audioAssetId: string;
  beatId: string;
  options?: {
    maxRetime?: number;
    targetWindow?: AudioFitWindow;
    words?: AudioFitWord[];
  };
}

export interface AudioFitResponse extends AudioFitDecision {
  audioAssetId: string;
  beatId: string;
  critiqueAssetId: string;
  requiresApproval: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown, path: string, fields: FieldError[]): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fields.push({ path, message: "Expected a finite number." });
    return undefined;
  }
  return value;
}

function parseWindow(value: unknown, path: string, fields: FieldError[]): AudioFitWindow | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    fields.push({ path, message: "Expected an object." });
    return undefined;
  }
  const startSec = optionalNumber(value.startSec, `${path}.startSec`, fields);
  const endSec = optionalNumber(value.endSec, `${path}.endSec`, fields);
  if (startSec === undefined || endSec === undefined) return undefined;
  return { startSec, endSec };
}

function parseWords(value: unknown, path: string, fields: FieldError[]): AudioFitWord[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    fields.push({ path, message: "Expected an array." });
    return undefined;
  }
  const words: AudioFitWord[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      fields.push({ path: `${path}.${index}`, message: "Expected an object." });
      return;
    }
    const startSec = optionalNumber(item.startSec, `${path}.${index}.startSec`, fields);
    const endSec = optionalNumber(item.endSec, `${path}.${index}.endSec`, fields);
    if (typeof item.w !== "string" || !item.w.trim()) {
      fields.push({ path: `${path}.${index}.w`, message: "Expected a word string." });
    }
    const confidence = optionalNumber(item.confidence, `${path}.${index}.confidence`, fields);
    if (startSec !== undefined && endSec !== undefined && typeof item.w === "string") {
      words.push({
        w: item.w,
        startSec,
        endSec,
        ...(confidence !== undefined ? { confidence } : {}),
      });
    }
  });
  return words;
}

export function parseAudioFitRequest(body: unknown): AudioFitRequest {
  const fields: FieldError[] = [];
  if (!isRecord(body)) throw validationError("Audio fit request body must be an object.");
  const audioAssetId =
    typeof body.audioAssetId === "string" && body.audioAssetId.trim()
      ? body.audioAssetId.trim()
      : undefined;
  const beatId =
    typeof body.beatId === "string" && body.beatId.trim() ? body.beatId.trim() : undefined;
  if (!audioAssetId) fields.push({ path: "audioAssetId", message: "Required." });
  if (!beatId) fields.push({ path: "beatId", message: "Required." });

  let options: AudioFitRequest["options"] | undefined;
  if (body.options !== undefined) {
    if (!isRecord(body.options)) {
      fields.push({ path: "options", message: "Expected an object." });
    } else {
      const maxRetime = optionalNumber(body.options.maxRetime, "options.maxRetime", fields);
      const targetWindow = parseWindow(body.options.targetWindow, "options.targetWindow", fields);
      const words = parseWords(body.options.words, "options.words", fields);
      options = {
        ...(maxRetime !== undefined ? { maxRetime } : {}),
        ...(targetWindow ? { targetWindow } : {}),
        ...(words ? { words } : {}),
      };
    }
  }

  if (fields.length > 0 || !audioAssetId || !beatId) {
    throw validationError("Invalid audio fit request.", fields);
  }
  return { audioAssetId, beatId, ...(options ? { options } : {}) };
}

function planBeats(plan: ShotPlan): Beat[] {
  return (plan.scenes ?? []).flatMap((scene) => scene.beats ?? []);
}

function beatWindowFromPlan(plan: ShotPlan, beatId: string): AudioFitWindow | null {
  let cursor = 0;
  for (const beat of planBeats(plan)) {
    const durationSec = Math.max(0, Number(beat.durationSec) || 0);
    const id = beat.id || beat.name;
    const startSec = cursor;
    const endSec = cursor + durationSec;
    if (id === beatId) return { startSec, endSec };
    cursor = endSec;
  }
  return null;
}

export async function fitProjectAudioToPicture(input: {
  auth: AuthContext;
  projectId: string;
  request: AudioFitRequest;
  orchestratorRunId?: string;
}): Promise<AudioFitResponse> {
  const audio = await getAsset(
    input.auth.workspaceId,
    input.projectId,
    input.request.audioAssetId
  );
  if (audio.kind !== "audio") {
    throw new ApiError("asset_invalid", `Asset ${input.request.audioAssetId} is not audio.`, {
      assetIds: [input.request.audioAssetId],
    });
  }
  if (audio.status !== "ready") {
    throw new ApiError("asset_not_ready", `Asset ${input.request.audioAssetId} is not ready.`, {
      assetIds: [input.request.audioAssetId],
    });
  }

  const plan = await getActiveProjectPlan(input.projectId);
  const targetWindow =
    input.request.options?.targetWindow ??
    (plan ? beatWindowFromPlan(plan.plan, input.request.beatId) : null);
  if (!targetWindow) {
    throw new ApiError("validation_failed", `Unknown beat id: ${input.request.beatId}.`, {
      beatId: input.request.beatId,
    });
  }

  const durationSec = audio.durationSec;
  if (durationSec === undefined || durationSec === null) {
    throw new ApiError(
      "asset_invalid",
      `Audio asset ${input.request.audioAssetId} is missing durationSec.`,
      { assetIds: [input.request.audioAssetId] }
    );
  }

  const decision = fitAudioToPicture({
    audioDurationSec: durationSec,
    targetWindow,
    words: input.request.options?.words,
    maxRetime: input.request.options?.maxRetime,
  });
  const critique = {
    schemaVersion: "audio_fit_critique.v1",
    audioAssetId: audio.id,
    beatId: input.request.beatId,
    targetWindow,
    placement: decision.placement,
    retime: decision.retime,
    fit: decision.verdict,
    reasons: decision.reasons,
    metrics: decision.metrics,
  };
  const { critiqueAssetId } = await addAudioFitCritique({
    workspaceId: input.auth.workspaceId,
    projectId: input.projectId,
    audioAssetId: audio.id,
    audioContentHash: audio.contentHash,
    planAssetId: plan?.assetId,
    planContentHash: plan?.contentHash,
    beatId: input.request.beatId,
    critique,
    orchestratorRunId: input.orchestratorRunId,
  });

  return {
    audioAssetId: audio.id,
    beatId: input.request.beatId,
    critiqueAssetId,
    requiresApproval: decision.verdict !== "ok",
    ...decision,
  };
}

export async function fitProjectAudioToPictureResult(input: {
  auth: AuthContext;
  projectId: string;
  body: unknown;
}): Promise<ApiResult> {
  const request = parseAudioFitRequest(input.body);
  const result = await fitProjectAudioToPicture({
    auth: input.auth,
    projectId: input.projectId,
    request,
  });
  return { status: 200, body: result };
}
