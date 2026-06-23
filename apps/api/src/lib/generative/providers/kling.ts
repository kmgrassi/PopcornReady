import type {
  GenerateAssetRequest,
  GeneratedAssetResult,
  GenerativeProvider,
} from "@popcorn/shared/generative/types";
import { createHmac } from "crypto";
import { resolveProviderApiKey } from "@/lib/provider-keys/resolve";
import { estimateCostUsd } from "../pricing";
import {
  aspectRatioFromSize,
  authedFetch,
  characterProviderSettings,
  readAsDataUri,
  requirePrompt,
} from "./shared";

const KLING_BASE_URL = "https://api-singapore.klingai.com";
const KLING_DEFAULT_VIDEO_MODEL = "kling-v3";

interface KlingTaskResponse {
  code?: number;
  message?: string;
  data?: KlingTask;
  task_id?: string;
  id?: string;
}

interface KlingTask {
  task_id?: string;
  id?: string;
  task_status?: "submitted" | "processing" | "succeed" | "failed" | string;
  status?: "submitted" | "processing" | "succeed" | "failed" | string;
  task_status_msg?: string;
  error?: string;
  task_result?: {
    videos?: Array<{ url?: string; duration?: number }>;
  };
  output?: string[];
}

function normalizeKlingVideoSeconds(value?: number): number {
  const candidate = Math.round(Number(value));
  if (!Number.isFinite(candidate)) return 5;
  return candidate <= 7 ? 5 : 10;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signedKlingJwt(): string | undefined {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })
  );
  const signature = base64url(
    createHmac("sha256", secretKey).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
}

async function klingFetch(pathName: string, init: RequestInit): Promise<Response> {
  const apiKey = (await resolveProviderApiKey("kling")) || signedKlingJwt();
  return authedFetch({
    baseUrl: process.env.KLING_BASE_URL || KLING_BASE_URL,
    pathName,
    init,
    apiKey,
    missingKeyMessage:
      "KLING_API_KEY is not set for the Kling provider. If your Kling account uses AK/SK auth, set KLING_ACCESS_KEY and KLING_SECRET_KEY.",
    errorPrefix: "Kling",
  });
}

function taskIdFrom(response: KlingTaskResponse): string | undefined {
  return response.data?.task_id || response.data?.id || response.task_id || response.id;
}

function isTerminal(status: string | undefined): boolean {
  return status === "succeed" || status === "failed";
}

async function waitForKlingTask(endpoint: string, taskId: string): Promise<KlingTask> {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await klingFetch(`${endpoint}/${encodeURIComponent(taskId)}`, {
      method: "GET",
    });
    const json = (await res.json()) as KlingTaskResponse;
    const task = (json.data || json) as KlingTask;
    const status = task.task_status || task.status;
    if (isTerminal(status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error(`Kling task ${taskId} did not complete before timeout.`);
}

async function downloadOutput(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kling output download failed (${res.status}).`);
  return res;
}

async function generateKlingVideo(
  input: Extract<GenerateAssetRequest, { provider: "kling"; kind: "video" }>
): Promise<GeneratedAssetResult> {
  const prompt = requirePrompt(input.prompt);
  const model = input.model || KLING_DEFAULT_VIDEO_MODEL;
  const duration = normalizeKlingVideoSeconds(input.seconds);
  const firstReference = input.referencePaths?.[0];
  const endpoint = firstReference ? "/v1/videos/image2video" : "/v1/videos/text2video";
  const body = {
    model_name: model,
    prompt,
    duration: String(duration),
    mode: input.quality === "high" ? "pro" : "std",
    aspect_ratio: aspectRatioFromSize(input.size, "16:9", "9:16"),
    ...(firstReference ? { image: await readAsDataUri(firstReference) } : {}),
  };

  const createRes = await klingFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const created = (await createRes.json()) as KlingTaskResponse;
  const taskId = taskIdFrom(created);
  if (!taskId) throw new Error("Kling video generation returned no task id.");

  const completed = await waitForKlingTask(endpoint, taskId);
  const status = completed.task_status || completed.status;
  if (status !== "succeed") {
    throw new Error(
      `Kling video generation failed: ${completed.task_status_msg || completed.error || status}`
    );
  }

  const outputUrl = completed.task_result?.videos?.[0]?.url || completed.output?.[0];
  if (!outputUrl) throw new Error("Kling video generation returned no output URL.");

  const videoRes = await downloadOutput(outputUrl);
  return {
    kind: "video",
    bytes: Buffer.from(await videoRes.arrayBuffer()),
    extension: "mp4",
    mimeType: videoRes.headers.get("Content-Type") || "video/mp4",
    provider: "kling",
    model,
    prompt,
    durationSec: completed.task_result?.videos?.[0]?.duration || duration,
    costUsd: estimateCostUsd({
      provider: "kling",
      kind: "video",
      model,
      durationSec: duration,
    }),
    providerSettings: characterProviderSettings(input),
  };
}

export const klingProvider: GenerativeProvider = {
  name: "kling",
  async generateAsset(input) {
    if (input.provider !== "kling" || input.kind !== "video") {
      throw new Error("Kling provider currently supports video generation only.");
    }
    return generateKlingVideo(input);
  },
};
