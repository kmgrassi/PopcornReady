import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import { ApiError } from "@/core/errors";
import {
  effectiveAssetStorageVisibility,
  getAsset,
  addProjectTranscript as realAddProjectTranscript,
  getLatestProjectTranscript,
  type ProjectTranscript,
  type V1Asset,
} from "./store";
import {
  transcribeMedia,
  type TranscriptionProvider,
} from "@/lib/generative/transcription";
import { createObjectStore } from "@/lib/storage/object-store";

export interface TranscribeAssetInput {
  workspaceId: string;
  projectId: string;
  assetId: string;
  provider?: TranscriptionProvider;
  language?: string;
  model?: string;
  idempotencyKey?: string | null;
}

export interface TranscribeAssetJobResult {
  transcriptAssetId: string;
  segmentCount: number;
}

export interface TranscriptionDeps {
  jobs: Pick<AgentApiStore, "createOrGetJob" | "setStep" | "succeed" | "fail" | "getJob">;
  addProjectTranscript: typeof realAddProjectTranscript;
  transcribeMedia: typeof transcribeMedia;
  readAssetBytes: (asset: V1Asset) => Promise<Buffer | undefined>;
  getAsset: typeof getAsset;
}

const defaultDeps: TranscriptionDeps = {
  jobs: agentApiStore,
  addProjectTranscript: realAddProjectTranscript,
  transcribeMedia,
  readAssetBytes,
  getAsset,
};

export async function transcribeAsset(
  input: TranscribeAssetInput,
  deps: Partial<TranscriptionDeps> = {}
) {
  const d = { ...defaultDeps, ...deps };
  const { job, created } = await d.jobs.createOrGetJob({
    type: "asset_ingest",
    projectId: input.projectId,
    idempotencyKey: input.idempotencyKey ?? null,
  });
  if (!created && job.status !== "queued") return job;

  try {
    await d.jobs.setStep(job.id, "transcribing_audio");
    const sourceAsset = await d.getAsset(input.workspaceId, input.projectId, input.assetId);
    assertTranscribable(sourceAsset);
    const provider = input.provider ?? "openai";
    const bytes = provider === "mock" ? undefined : await d.readAssetBytes(sourceAsset);
    const result = await d.transcribeMedia({
      sourceAssetId: sourceAsset.id,
      filename: sourceAsset.filename,
      bytes,
      provider,
      language: input.language,
      model: input.model,
    });
    const transcript = await d.addProjectTranscript({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sourceAssetId: sourceAsset.id,
      sourceContentHash: sourceAsset.contentHash,
      transcript: result.transcript,
      provider: result.provider,
      language: input.language,
      jobId: job.id,
    });
    return await d.jobs.succeed<TranscribeAssetJobResult>(job.id, {
      transcriptAssetId: transcript.asset.id,
      segmentCount: transcript.segments.length,
    });
  } catch (error) {
    const apiError = transcriptionApiError(error);
    await d.jobs.fail(job.id, {
      code: apiError.code,
      message: apiError.message,
      requestId: "",
      ...(apiError.details ? { details: apiError.details } : {}),
    });
    return (await d.jobs.getJob(job.id)) ?? job;
  }
}

function transcriptionApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(no audio|audio stream|no speech)\b/i.test(message)) {
    return new ApiError("no_audio_stream", message);
  }
  return new ApiError("job_failed", message);
}

export async function readLatestTranscript(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
}): Promise<ProjectTranscript> {
  const transcript = await getLatestProjectTranscript({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sourceAssetId: input.assetId,
  });
  if (!transcript) throw new ApiError("not_found", `Transcript not found for asset ${input.assetId}.`);
  return transcript;
}

function assertTranscribable(asset: V1Asset): void {
  if (asset.status !== "ready") {
    throw new ApiError("asset_not_ready", `Asset ${asset.id} is not ready.`);
  }
  if (asset.kind !== "audio" && asset.kind !== "video") {
    throw new ApiError("asset_not_transcribable", "Only audio and video assets can be transcribed.");
  }
}

async function readAssetBytes(asset: V1Asset): Promise<Buffer | undefined> {
  if (asset.storageKey) {
    const visibility = await effectiveAssetStorageVisibility({
      workspaceId: asset.workspaceId,
      projectId: asset.projectId,
      assetVisibility: asset.visibility ?? "public",
    });
    const object = await createObjectStore().getObject(asset.storageKey, visibility);
    return object.body;
  }
  if (asset.remoteUrl) {
    const response = await fetch(asset.remoteUrl);
    if (!response.ok) {
      throw new ApiError(
        "asset_invalid",
        `Could not fetch remote asset for transcription (${response.status}).`
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }
  throw new ApiError(
    "asset_invalid",
    "Asset has no storage object or remote URL to transcribe."
  );
}
