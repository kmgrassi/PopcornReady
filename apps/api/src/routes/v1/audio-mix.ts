import { Router } from "express";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { getIdempotencyKey } from "@/lib/agent-api/http";
import { agentApiStore } from "@/lib/agent-api/jobs";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { resolveAudioMixPlan, type AudioMixLayerInput } from "@popcorn/timeline/audio-mix";

export const audioMixRouter = Router();

type RouteParams = Record<string, string | undefined>;

function requiredParam(params: RouteParams, name: string): string {
  const value = params[name];
  if (!value) {
    throw new ApiError("validation_failed", `${name} is required.`);
  }
  return value;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

interface AudioMixLayerRow {
  id: string;
  audio_asset_id: string;
  role: string;
  gain_db: number | string;
  duck_under: boolean;
  in_sec: number | string;
  out_sec: number | string;
}

async function layersForBody(input: {
  workspaceId: string;
  projectId: string;
  body: Record<string, unknown>;
}): Promise<AudioMixLayerInput[]> {
  if (Array.isArray(input.body.layers)) return parseInlineLayers(input.body);
  if (typeof input.body.mixAssetId === "string" && input.body.mixAssetId.trim()) {
    return loadMixAssetLayers(input.workspaceId, input.projectId, input.body.mixAssetId.trim());
  }
  throw new ApiError("validation_failed", "`mixAssetId` or `layers` is required.");
}

function parseInlineLayers(body: Record<string, unknown>): AudioMixLayerInput[] {
  if (!Array.isArray(body.layers)) {
    throw new ApiError("validation_failed", "`layers` must be an array.");
  }
  return body.layers.map((raw, index) => {
    const layer = bodyRecord(raw);
    if (typeof layer.audioAssetId !== "string" || !layer.audioAssetId.trim()) {
      throw new ApiError("validation_failed", `layers[${index}].audioAssetId is required.`);
    }
    return {
      ...(typeof layer.id === "string" && layer.id.trim() ? { id: layer.id.trim() } : {}),
      audioAssetId: layer.audioAssetId.trim(),
      ...(typeof layer.role === "string" && layer.role.trim() ? { role: layer.role.trim() } : {}),
      ...(finiteNumber(layer.gainDb) !== undefined ? { gainDb: finiteNumber(layer.gainDb) } : {}),
      ...(typeof layer.duckUnder === "boolean" ? { duckUnder: layer.duckUnder } : {}),
      ...(finiteNumber(layer.inSec) !== undefined ? { inSec: finiteNumber(layer.inSec) } : {}),
      ...(finiteNumber(layer.outSec) !== undefined ? { outSec: finiteNumber(layer.outSec) } : {}),
      ...(finiteNumber(layer.durationSec) !== undefined
        ? { durationSec: finiteNumber(layer.durationSec) }
        : {}),
    };
  });
}

async function loadMixAssetLayers(
  workspaceId: string,
  projectId: string,
  mixAssetId: string
): Promise<AudioMixLayerInput[]> {
  const db = getServiceSupabase();
  const { data: mix, error: mixError } = await db
    .from("assets")
    .select("id, kind, media")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("id", mixAssetId)
    .maybeSingle();
  if (mixError) throw new ApiError("database_error", mixError.message);
  if (!mix || mix.kind !== "audio_mix" || mix.media !== "data") {
    throw new ApiError("asset_invalid", `Asset ${mixAssetId} is not an audio_mix asset.`);
  }

  const { data, error } = await db
    .from("audio_mix_layers")
    .select("id, audio_asset_id, role, gain_db, duck_under, in_sec, out_sec")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("mix_asset_id", mixAssetId)
    .order("position", { ascending: true });
  if (error) throw new ApiError("database_error", error.message);
  return ((data as AudioMixLayerRow[] | null) ?? []).map((row) => ({
    id: row.id,
    audioAssetId: row.audio_asset_id,
    role: row.role,
    gainDb: Number(row.gain_db),
    duckUnder: row.duck_under,
    inSec: Number(row.in_sec),
    outSec: Number(row.out_sec),
  }));
}

function parseSegmentWindow(body: Record<string, unknown>) {
  const raw = body.segmentWindow;
  if (!raw) return undefined;
  const window = bodyRecord(raw);
  const startSec = finiteNumber(window.startSec);
  const endSec = finiteNumber(window.endSec);
  if (startSec === undefined || endSec === undefined) {
    throw new ApiError("validation_failed", "segmentWindow requires numeric startSec and endSec.");
  }
  return { startSec, endSec };
}

audioMixRouter.post(
  "/projects/:projectId/audio-mix/preview",
  mutation(async ({ auth, body, req }, params) => {
    const projectId = requiredParam(params, "projectId");
    const parsed = bodyRecord(body);
    const timelineDurationSec = finiteNumber(parsed.timelineDurationSec);
    if (timelineDurationSec === undefined || timelineDurationSec <= 0) {
      throw new ApiError("validation_failed", "`timelineDurationSec` must be a positive number.");
    }

    const { job, created } = await agentApiStore.createOrGetJob({
      type: "audio_alignment",
      projectId,
      idempotencyKey: scopedIdempotencyKey(req, projectId),
    });
    if (!created) return { status: 202, body: { job } };

    await agentApiStore.setStep(job.id, "aligning_audio");
    const preview = resolveAudioMixPlan({
      layers: await layersForBody({ workspaceId: auth.workspaceId, projectId, body: parsed }),
      timelineDurationSec,
      segmentWindow: parseSegmentWindow(parsed),
      ...(finiteNumber(parsed.duckGainDb) !== undefined
        ? { duckGainDb: finiteNumber(parsed.duckGainDb) }
        : {}),
    });
    const finished = await agentApiStore.succeed(job.id, {
      preview,
      status: "pending_render",
      segmentId: typeof parsed.segmentId === "string" ? parsed.segmentId : null,
      mixAssetId: typeof parsed.mixAssetId === "string" ? parsed.mixAssetId : null,
    });
    return { status: 202, body: { job: finished } };
  })
);

function scopedIdempotencyKey(req: Parameters<typeof getIdempotencyKey>[0], projectId: string) {
  const key = getIdempotencyKey(req);
  return key ? `${projectId}:${key}` : null;
}
