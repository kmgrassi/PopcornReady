import type {
  GenerateAssetRequest,
  GeneratedAssetResult,
  GenerativeProvider,
} from "@popcorn/shared/generative/types";
import { resolveProviderApiKey } from "@/lib/provider-keys/resolve";
import { estimateCostUsd } from "../pricing";
import {
  aspectRatioFromSize,
  authedFetch,
  characterProviderSettings,
  readAsDataUri,
  requirePrompt,
} from "./shared";

const XAI_BASE_URL = "https://api.x.ai/v1";
const XAI_DEFAULT_IMAGE_MODEL = "grok-imagine-image-quality";
const XAI_DEFAULT_VIDEO_MODEL = "grok-imagine-video";
const XAI_IMAGE_TO_VIDEO_MODEL = "grok-imagine-video-1.5";

interface XaiImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
    mime_type?: string;
    revised_prompt?: string;
  }>;
}

interface XaiVideoStartResponse {
  request_id?: string;
  id?: string;
}

interface XaiVideoStatusResponse {
  status?: "pending" | "done" | "expired" | "failed" | string;
  model?: string;
  video?: {
    url?: string;
    duration?: number;
  };
  error?: string;
}

function normalizeXaiVideoSeconds(value?: number): number {
  const candidate = Math.round(Number(value));
  if (!Number.isFinite(candidate)) return 8;
  return Math.max(1, Math.min(15, candidate));
}

function xaiResolution(value?: string, fallback = "720p"): string {
  if (value === "480p" || value === "720p" || value === "1k" || value === "2k") {
    return value;
  }
  return fallback;
}

async function xaiFetch(pathName: string, init: RequestInit): Promise<Response> {
  return authedFetch({
    baseUrl: XAI_BASE_URL,
    pathName,
    init,
    apiKey: await resolveProviderApiKey("xai"),
    missingKeyMessage: "XAI_API_KEY is not set for the xAI provider.",
    errorPrefix: "xAI",
  });
}

async function downloadOutput(url: string, provider: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${provider} output download failed (${res.status}).`);
  return res;
}

async function generateXaiImage(
  input: Extract<GenerateAssetRequest, { provider: "xai"; kind: "image" }>
): Promise<GeneratedAssetResult> {
  const prompt = requirePrompt(input.prompt);
  const model = input.model || XAI_DEFAULT_IMAGE_MODEL;
  const firstReference = input.referencePaths?.[0];
  const endpoint = firstReference ? "/images/edits" : "/images/generations";
  const body = {
    model,
    prompt,
    response_format: "b64_json",
    n: input.numImages || 1,
    aspect_ratio: aspectRatioFromSize(input.size, "16:9", "9:16"),
    resolution: xaiResolution(input.resolution, "1k"),
    ...(firstReference
      ? { image: { url: await readAsDataUri(firstReference), type: "image_url" } }
      : {}),
  };

  const res = await xaiFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as XaiImageResponse;
  const image = json.data?.[0];
  if (!image) throw new Error("xAI image generation returned no image.");

  const bytes = image.b64_json
    ? Buffer.from(image.b64_json, "base64")
    : image.url
      ? Buffer.from(await (await downloadOutput(image.url, "xAI")).arrayBuffer())
      : null;
  if (!bytes) throw new Error("xAI image generation returned no image bytes or URL.");

  return {
    kind: "image",
    bytes,
    extension: image.mime_type?.includes("png") ? "png" : "jpg",
    mimeType: image.mime_type || "image/jpeg",
    provider: "xai",
    model,
    prompt: image.revised_prompt || prompt,
    costUsd: estimateCostUsd({ provider: "xai", kind: "image", model }),
    providerSettings: characterProviderSettings(input),
  };
}

async function waitForXaiVideo(requestId: string): Promise<XaiVideoStatusResponse> {
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await xaiFetch(`/videos/${encodeURIComponent(requestId)}`, {
      method: "GET",
    });
    const status = (await res.json()) as XaiVideoStatusResponse;
    if (status.status === "done" || status.status === "failed" || status.status === "expired") {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`xAI video request ${requestId} did not complete before timeout.`);
}

async function generateXaiVideo(
  input: Extract<GenerateAssetRequest, { provider: "xai"; kind: "video" }>
): Promise<GeneratedAssetResult> {
  const prompt = requirePrompt(input.prompt);
  const duration = normalizeXaiVideoSeconds(input.seconds);
  const firstReference = input.referencePaths?.[0];
  const requestedModel = input.model || XAI_DEFAULT_VIDEO_MODEL;
  const model =
    firstReference && requestedModel === XAI_DEFAULT_VIDEO_MODEL
      ? XAI_IMAGE_TO_VIDEO_MODEL
      : requestedModel;
  const body = {
    model,
    prompt,
    duration,
    aspect_ratio: aspectRatioFromSize(input.size, "16:9", "9:16"),
    resolution: xaiResolution(input.resolution, "720p"),
    ...(firstReference ? { image: { url: await readAsDataUri(firstReference) } } : {}),
  };

  const startRes = await xaiFetch("/videos/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const started = (await startRes.json()) as XaiVideoStartResponse;
  const requestId = started.request_id || started.id;
  if (!requestId) throw new Error("xAI video generation returned no request id.");

  const completed = await waitForXaiVideo(requestId);
  if (completed.status !== "done") {
    throw new Error(`xAI video generation failed: ${completed.error || completed.status}`);
  }
  const outputUrl = completed.video?.url;
  if (!outputUrl) throw new Error("xAI video generation returned no output URL.");

  const videoRes = await downloadOutput(outputUrl, "xAI");
  const outputDuration = completed.video?.duration || duration;
  return {
    kind: "video",
    bytes: Buffer.from(await videoRes.arrayBuffer()),
    extension: "mp4",
    mimeType: videoRes.headers.get("Content-Type") || "video/mp4",
    provider: "xai",
    model: completed.model || model,
    prompt,
    durationSec: outputDuration,
    costUsd: estimateCostUsd({
      provider: "xai",
      kind: "video",
      model,
      durationSec: outputDuration,
    }),
    providerSettings: characterProviderSettings(input),
  };
}

export const xaiProvider: GenerativeProvider = {
  name: "xai",
  async generateAsset(input) {
    if (input.provider !== "xai") {
      throw new Error("xAI provider received a non-xAI request.");
    }
    if (input.kind === "image") return generateXaiImage(input);
    if (input.kind === "video") return generateXaiVideo(input);
    throw new Error("xAI provider currently supports image and video generation only.");
  },
};
