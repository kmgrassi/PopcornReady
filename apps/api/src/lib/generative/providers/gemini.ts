import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { GoogleGenAI, type Image, type Video } from "@google/genai";
import type {
  GenerateAssetRequest,
  GeneratedAssetResult,
  GenerativeProvider,
} from "@popcorn/shared/generative/types";
import { estimateCostUsd } from "../pricing";
import {
  aspectRatioFromSize,
  characterProviderSettings,
  mimeForPath,
  requirePrompt,
} from "./shared";
import { resolveProviderApiKey } from "@/lib/provider-keys/resolve";

const GEMINI_DEFAULT_VIDEO_MODEL = "veo-3.1-generate-preview";
const GEMINI_VIDEO_EDIT_MODEL = "gemini-omni-flash-preview";
const FILE_ACTIVE_DEADLINE_MS = 5 * 60 * 1000;
const VIDEO_EDIT_DEADLINE_MS = 20 * 60 * 1000;
const VIDEO_EDIT_POLL_INTERVAL_MS = 10_000;
const execFileAsync = promisify(execFile);
// "Nano banana" — the only image model that will edit a photorealistic image of
// a minor (OpenAI's image-edit endpoint rejects that), which one-shot stories
// frequently feature. Used to generate per-beat keyframes from the hero image.
const GEMINI_DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

async function readAsGeminiImage(filePath: string): Promise<Image> {
  const bytes = await fs.readFile(filePath);
  return {
    imageBytes: Buffer.from(bytes).toString("base64"),
    mimeType: mimeForPath(filePath),
  };
}

async function generateGeminiImage(
  input: Extract<GenerateAssetRequest, { provider: "gemini"; kind: "image" }>
): Promise<GeneratedAssetResult> {
  const key = await resolveProviderApiKey("gemini");
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set for the Gemini provider.");
  }

  const prompt = requirePrompt(input.prompt);
  const model = input.model || GEMINI_DEFAULT_IMAGE_MODEL;
  const ai = new GoogleGenAI({ apiKey: key });

  // Reference images (e.g. the character hero frame) are passed inline so the
  // model can keep the same subject while changing pose/scene per beat.
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const ref of input.referencePaths || []) {
    const bytes = await fs.readFile(ref);
    parts.push({
      inlineData: {
        mimeType: mimeForPath(ref),
        data: Buffer.from(bytes).toString("base64"),
      },
    });
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: parts as never }],
  });
  const outParts = response.candidates?.[0]?.content?.parts || [];
  const imagePart = outParts.find(
    (part) => (part as { inlineData?: { data?: string } }).inlineData?.data
  ) as { inlineData?: { data: string; mimeType?: string } } | undefined;
  if (!imagePart?.inlineData?.data) {
    const text =
      (outParts.find((part) => (part as { text?: string }).text) as { text?: string })?.text || "";
    throw new Error(
      `Gemini image generation returned no image data. ${text.slice(0, 200)}`
    );
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  return {
    kind: "image",
    bytes: Buffer.from(imagePart.inlineData.data, "base64"),
    extension: mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png",
    mimeType,
    provider: "gemini",
    model,
    prompt,
    costUsd: estimateCostUsd({ provider: "gemini", kind: "image", model }),
    providerSettings: characterProviderSettings(input),
  };
}

function normalizeGeminiVideoSeconds(value?: number): number {
  const candidate = Math.round(Number(value));
  if (!Number.isFinite(candidate)) return 8;
  if (candidate <= 4) return 4;
  if (candidate <= 6) return 6;
  return 8;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SUPPORTED_VIDEO_EDIT_INPUT_MIMES = new Set([
  "video/mp4",
  "video/mpeg",
  "video/mpg",
  "video/mov",
  "video/avi",
  "video/x-flv",
  "video/webm",
  "video/wmv",
  "video/3gpp",
]);

function normalizeVideoEditMime(mime: string | undefined): string {
  const lowered = (mime || "").toLowerCase().split(";")[0].trim();
  if (lowered === "video/quicktime") return "video/mov";
  return SUPPORTED_VIDEO_EDIT_INPUT_MIMES.has(lowered) ? lowered : "video/mp4";
}

function isInvalidArgumentError(err: unknown): boolean {
  return (err as { status?: number })?.status === 400;
}

interface OutputVideoContent {
  type?: string;
  uri?: string;
  data?: string;
  mime_type?: string;
}

function findOutputVideo(interaction: unknown): OutputVideoContent | null {
  const steps =
    ((interaction as { steps?: Array<{ type?: string; content?: unknown[] }> })
      .steps) || [];
  let found: OutputVideoContent | null = null;
  for (const step of steps) {
    if (step?.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const block of step.content) {
      const content = block as OutputVideoContent;
      if (content?.type === "video" && (content.uri || content.data)) {
        found = content;
      }
    }
  }
  return found;
}

async function downloadEditedGeminiVideo(
  ai: GoogleGenAI,
  apiKey: string,
  video: OutputVideoContent
): Promise<Buffer> {
  if (video.data) return Buffer.from(video.data, "base64");
  if (!video.uri) throw new Error("Gemini video edit returned neither data nor uri.");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-gemini-edit-"));
  const tmpPath = path.join(tmpDir, "edited.mp4");
  try {
    try {
      await ai.files.download({ file: video.uri, downloadPath: tmpPath });
      const stat = await fs.stat(tmpPath);
      if (stat.size > 0) return await fs.readFile(tmpPath);
    } catch {
      // Fall through to the direct authenticated fetch path below.
    }

    const url = video.uri.includes("alt=media")
      ? video.uri
      : `${video.uri}${video.uri.includes("?") ? "&" : "?"}alt=media`;
    const response = await fetch(url, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!response.ok) {
      throw new Error(`Downloading the edited Gemini video failed (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function uploadVideoAndWaitActive(
  ai: GoogleGenAI,
  filePath: string,
  mimeType: string
) {
  let file = await ai.files.upload({ file: filePath, config: { mimeType } });
  const deadline = Date.now() + FILE_ACTIVE_DEADLINE_MS;
  while (file.state === "PROCESSING" && Date.now() < deadline) {
    await sleep(3000);
    file = await ai.files.get({ name: file.name as string });
  }
  if (file.state !== "ACTIVE" || !file.uri) {
    throw new Error(`Uploaded Gemini edit video never became ready (state: ${file.state}).`);
  }
  return file as typeof file & { uri: string };
}

async function transcodeVideoEditSource(sourcePath: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-gemini-edit-h264-"));
  const convertedPath = path.join(tmpDir, "source.mp4");
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
  await execFileAsync(ffmpegPath, [
    "-y",
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    convertedPath,
  ]);
  return convertedPath;
}

async function downloadGeminiVideo(ai: GoogleGenAI, video: Video): Promise<Buffer> {
  if (video.videoBytes) return Buffer.from(video.videoBytes, "base64");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-gemini-"));
  const tmpPath = path.join(tmpDir, "generated.mp4");
  try {
    await ai.files.download({ file: video, downloadPath: tmpPath });
    return await fs.readFile(tmpPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function generateGeminiVideo(
  input: Extract<GenerateAssetRequest, { provider: "gemini"; kind: "video" }>
): Promise<GeneratedAssetResult> {
  const key = await resolveProviderApiKey("gemini");
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set for the Gemini provider.");
  }

  const prompt = requirePrompt(input.prompt);
  if (input.editSourceVideoPath) {
    return editGeminiVideo({ input, apiKey: key, prompt });
  }

  const model = input.model || GEMINI_DEFAULT_VIDEO_MODEL;
  const durationSeconds = normalizeGeminiVideoSeconds(input.seconds);
  const ai = new GoogleGenAI({ apiKey: key });
  const firstReference = input.referencePaths?.[0];
  if (
    input.characterContext &&
    input.characterContext.consistencyMode === "reference_pack" &&
    input.characterContext.references.length > 1
  ) {
    throw new Error(
      "Gemini video generation supports hero_frame or first_frame_video character references, not multi-image reference_pack."
    );
  }

  let operation = await ai.models.generateVideos({
    model,
    prompt,
    ...(firstReference ? { image: await readAsGeminiImage(firstReference) } : {}),
    config: {
      aspectRatio: aspectRatioFromSize(input.size, "16:9", "9:16"),
      durationSeconds,
      numberOfVideos: 1,
    },
  });
  console.info(
    `[gemini] video operation started: ${operation.name || "unknown operation"}`
  );

  const deadline = Date.now() + 12 * 60 * 1000;
  while (!operation.done && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (!operation.done) {
    throw new Error("Gemini video generation timed out before completion.");
  }
  if (operation.error) {
    throw new Error(`Gemini video generation failed: ${JSON.stringify(operation.error)}`);
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error("Gemini video generation returned no video data.");

  return {
    kind: "video",
    bytes: await downloadGeminiVideo(ai, video),
    extension: "mp4",
    mimeType: video.mimeType || "video/mp4",
    provider: "gemini",
    model,
    prompt,
    costUsd: estimateCostUsd({
      provider: "gemini",
      kind: "video",
      model,
      durationSec: durationSeconds,
    }),
    providerSettings: characterProviderSettings(input),
  };
}

async function editGeminiVideo({
  input,
  apiKey,
  prompt,
}: {
  input: Extract<GenerateAssetRequest, { provider: "gemini"; kind: "video" }>;
  apiKey: string;
  prompt: string;
}): Promise<GeneratedAssetResult> {
  const sourcePath = input.editSourceVideoPath;
  if (!sourcePath) throw new Error("Gemini video edit requires editSourceVideoPath.");

  const model = input.model || GEMINI_VIDEO_EDIT_MODEL;
  const ai = new GoogleGenAI({ apiKey });
  const startEdit = (fileUri: string, mimeType: string) =>
    ai.interactions.create({
      model,
      background: true,
      input: [
        { type: "video", uri: fileUri, mime_type: mimeType as "video/mp4" },
        { type: "text", text: prompt },
      ],
    });

  const file = await uploadVideoAndWaitActive(
    ai,
    sourcePath,
    normalizeVideoEditMime(mimeForPath(sourcePath))
  );

  let interaction;
  let convertedPath: string | undefined;
  try {
    interaction = await startEdit(
      file.uri,
      normalizeVideoEditMime(file.mimeType || mimeForPath(sourcePath))
    );
  } catch (err) {
    if (!isInvalidArgumentError(err)) throw err;
    console.info(
      "[gemini] video edit rejected source video; transcoding to h264 mp4 and retrying"
    );
    convertedPath = await transcodeVideoEditSource(sourcePath);
    const convertedFile = await uploadVideoAndWaitActive(ai, convertedPath, "video/mp4");
    interaction = await startEdit(convertedFile.uri, "video/mp4");
  } finally {
    if (convertedPath) {
      void fs.rm(path.dirname(convertedPath), { recursive: true, force: true });
    }
  }

  console.info(`[gemini] video edit interaction started: ${interaction.id}`);
  const deadline = Date.now() + VIDEO_EDIT_DEADLINE_MS;
  while (
    (interaction.status === "in_progress" ||
      interaction.status === "requires_action") &&
    Date.now() < deadline
  ) {
    await sleep(VIDEO_EDIT_POLL_INTERVAL_MS);
    interaction = await ai.interactions.get(interaction.id);
  }

  if (interaction.status !== "completed") {
    const detail =
      interaction.status === "in_progress"
        ? "timed out before completion"
        : `ended with status "${interaction.status}"`;
    throw new Error(`Gemini video edit ${detail}.`);
  }

  const outputVideo = findOutputVideo(interaction);
  if (!outputVideo) {
    const text = (interaction as { output_text?: string }).output_text || "";
    throw new Error(`Gemini video edit returned no video output. ${text.slice(0, 300)}`);
  }

  return {
    kind: "video",
    bytes: await downloadEditedGeminiVideo(ai, apiKey, outputVideo),
    extension: "mp4",
    mimeType: outputVideo.mime_type || "video/mp4",
    provider: "gemini",
    model,
    prompt,
    costUsd: estimateCostUsd({
      provider: "gemini",
      kind: "video",
      model,
      durationSec: input.seconds,
    }),
    providerSettings: characterProviderSettings(input),
  };
}

export const geminiProvider: GenerativeProvider = {
  name: "gemini",
  async generateAsset(input) {
    if (input.provider !== "gemini") {
      throw new Error("Gemini provider received a non-gemini request.");
    }
    if (input.kind === "video") return generateGeminiVideo(input);
    if (input.kind === "image") return generateGeminiImage(input);
    throw new Error("Gemini provider supports video and image generation only.");
  },
};
