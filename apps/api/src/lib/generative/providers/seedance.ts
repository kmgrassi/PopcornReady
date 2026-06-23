import type {
  GenerateAssetRequest,
  GeneratedAssetResult,
  GenerativeProvider,
} from "@popcorn/shared/generative/types";
import { resolveProviderApiKey } from "@/lib/provider-keys/resolve";
import { estimateCostUsd } from "../pricing";
import {
  aspectRatioFromSize,
  characterProviderSettings,
  readAsDataUri,
  requirePrompt,
} from "./shared";

const FAL_QUEUE_BASE_URL = "https://queue.fal.run";
const SEEDANCE_TEXT_TO_VIDEO_MODEL = "bytedance/seedance-2.0/text-to-video";
const SEEDANCE_IMAGE_TO_VIDEO_MODEL = "bytedance/seedance-2.0/image-to-video";

interface FalQueueSubmitResponse {
  request_id?: string;
  status_url?: string;
  response_url?: string;
}

interface FalQueueStatusResponse {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | string;
  error?: string;
  logs?: Array<{ message?: string }>;
}

interface FalSeedanceResult {
  video?: {
    url?: string;
    content_type?: string;
    file_name?: string;
  };
  videos?: Array<{
    url?: string;
    content_type?: string;
    file_name?: string;
  }>;
  url?: string;
}

function normalizeSeedanceVideoSeconds(value?: number): number {
  const candidate = Math.round(Number(value));
  if (!Number.isFinite(candidate)) return 5;
  return Math.max(4, Math.min(15, candidate));
}

function seedanceModelPath(model: string | undefined, hasReference: boolean): string {
  const value = model?.trim() || SEEDANCE_TEXT_TO_VIDEO_MODEL;
  const routed = hasReference
    ? value.replace(/\/text-to-video$/, "/image-to-video")
    : value;
  if (hasReference && routed === value && value === "bytedance/seedance-2.0") {
    return SEEDANCE_IMAGE_TO_VIDEO_MODEL;
  }
  return routed.replace(/^fal-ai\//, "").replace(/^fal:\/\//, "");
}

async function falFetch(url: string, init: RequestInit): Promise<Response> {
  const apiKey = await resolveProviderApiKey("seedance");
  if (!apiKey) throw new Error("FAL_KEY is not set for the Seedance provider.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Key ${apiKey}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Seedance/fal.ai request failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res;
}

async function waitForFalRequest(
  statusUrl: string,
  responseUrl: string
): Promise<FalSeedanceResult> {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const statusRes = await falFetch(statusUrl, { method: "GET" });
    const status = (await statusRes.json()) as FalQueueStatusResponse;
    if (status.status === "COMPLETED") {
      const resultRes = await falFetch(responseUrl, { method: "GET" });
      return (await resultRes.json()) as FalSeedanceResult;
    }
    if (status.status === "FAILED") {
      throw new Error(
        `Seedance/fal.ai generation failed: ${
          status.error || status.logs?.at(-1)?.message || "unknown failure"
        }`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error("Seedance/fal.ai request did not complete before timeout.");
}

async function downloadOutput(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Seedance output download failed (${res.status}).`);
  return res;
}

async function generateSeedanceVideo(
  input: Extract<GenerateAssetRequest, { provider: "seedance"; kind: "video" }>
): Promise<GeneratedAssetResult> {
  const prompt = requirePrompt(input.prompt);
  const duration = normalizeSeedanceVideoSeconds(input.seconds);
  const firstReference = input.referencePaths?.[0];
  const model = seedanceModelPath(input.model, Boolean(firstReference));
  const imageUrl = firstReference ? await readAsDataUri(firstReference) : undefined;
  const body = {
    prompt,
    duration,
    aspect_ratio: aspectRatioFromSize(input.size, "16:9", "9:16"),
    resolution: input.resolution || "720p",
    ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
  };

  const submitUrl = `${process.env.FAL_QUEUE_BASE_URL || FAL_QUEUE_BASE_URL}/${model}`;
  const submitRes = await falFetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const submitted = (await submitRes.json()) as FalQueueSubmitResponse;
  const responseUrl =
    submitted.response_url ||
    `${submitUrl}/requests/${encodeURIComponent(String(submitted.request_id || ""))}`;
  const statusUrl =
    submitted.status_url ||
    `${responseUrl}/status`;
  if (!submitted.request_id && !submitted.response_url) {
    throw new Error("Seedance/fal.ai generation returned no request id.");
  }

  const result = await waitForFalRequest(statusUrl, responseUrl);
  const output = result.video || result.videos?.[0];
  const outputUrl = output?.url || result.url;
  if (!outputUrl) throw new Error("Seedance/fal.ai generation returned no output URL.");

  const videoRes = await downloadOutput(outputUrl);
  return {
    kind: "video",
    bytes: Buffer.from(await videoRes.arrayBuffer()),
    extension: output?.file_name?.split(".").pop() || "mp4",
    mimeType: output?.content_type || videoRes.headers.get("Content-Type") || "video/mp4",
    provider: "seedance",
    model,
    prompt,
    durationSec: duration,
    costUsd: estimateCostUsd({
      provider: "seedance",
      kind: "video",
      model,
      durationSec: duration,
    }),
    providerSettings: characterProviderSettings(input),
  };
}

export const seedanceProvider: GenerativeProvider = {
  name: "seedance",
  async generateAsset(input) {
    if (input.provider !== "seedance" || input.kind !== "video") {
      throw new Error("Seedance provider currently supports video generation only.");
    }
    return generateSeedanceVideo(input);
  },
};
