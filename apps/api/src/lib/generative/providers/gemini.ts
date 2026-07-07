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
const GEMINI_OMNI_EDIT_MODEL = "gemini-omni-flash-preview";
const FILE_ACTIVE_DEADLINE_MS = 5 * 60 * 1000;
const EDIT_DEADLINE_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;
const execFileAsync = promisify(execFile);
// "Nano banana" — the only image model that will edit a photorealistic image of
// a minor (OpenAI's image-edit endpoint rejects that), which one-shot stories
// frequently feature. Used to generate per-beat keyframes from the hero image.
const GEMINI_DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

type GeminiVideoFile = {
  name?: string;
  uri?: string;
  state?: string;
  mimeType?: string;
};

type GeminiOmniInteraction = {
  id: string;
  status?: string;
  steps?: Array<{ type?: string; content?: unknown[] }>;
  output_text?: string;
};

interface OutputVideoContent {
  type?: string;
  uri?: string;
  data?: string;
  mime_type?: string;
}

type GeminiOmniVideoMime =
  | "video/mp4"
  | "video/mpeg"
  | "video/mpg"
  | "video/mov"
  | "video/avi"
  | "video/x-flv"
  | "video/webm"
  | "video/wmv"
  | "video/3gpp";

interface GeminiVideoEditDeps {
  ai: GoogleGenAI;
  apiKey: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fetchImpl?: typeof fetch;
  execFileAsync?: typeof execFileAsync;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mime types the interactions API accepts for video content blocks. Notably
// this is "video/mov", not the "video/quicktime" browsers report for .mov
// uploads.
const SUPPORTED_OMNI_VIDEO_MIMES = new Set([
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

export function normalizeGeminiVideoMime(mime: string | undefined): GeminiOmniVideoMime {
  const lowered = (mime || "").toLowerCase().split(";")[0].trim();
  if (lowered === "video/quicktime") return "video/mov";
  return SUPPORTED_OMNI_VIDEO_MIMES.has(lowered)
    ? (lowered as GeminiOmniVideoMime)
    : "video/mp4";
}

function mimeForVideoEditPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mov" || ext === ".qt") return "video/mov";
  if (ext === ".mpeg") return "video/mpeg";
  if (ext === ".mpg") return "video/mpg";
  if (ext === ".avi") return "video/avi";
  if (ext === ".flv") return "video/x-flv";
  if (ext === ".webm") return "video/webm";
  if (ext === ".wmv") return "video/wmv";
  if (ext === ".3gp" || ext === ".3gpp") return "video/3gpp";
  return normalizeGeminiVideoMime(mimeForPath(filePath));
}

function isInvalidArgumentError(err: unknown): boolean {
  return (err as { status?: number })?.status === 400;
}

// Walk the interaction's steps and return the last video content block the
// model produced.
export function findGeminiOmniOutputVideo(
  interaction: unknown
): OutputVideoContent | null {
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

async function uploadGeminiVideoAndWaitActive(
  filePath: string,
  mimeType: string,
  deps: GeminiVideoEditDeps
): Promise<GeminiVideoFile & { uri: string }> {
  const wait = deps.sleep || sleep;
  const now = deps.now || Date.now;
  let file = (await deps.ai.files.upload({
    file: filePath,
    config: { mimeType },
  })) as GeminiVideoFile;
  const fileDeadline = now() + FILE_ACTIVE_DEADLINE_MS;
  while (file.state === "PROCESSING" && now() < fileDeadline) {
    await wait(3000);
    if (!file.name) {
      throw new Error("Uploaded Gemini video is missing a file name.");
    }
    file = (await deps.ai.files.get({ name: file.name })) as GeminiVideoFile;
  }
  if (file.state !== "ACTIVE" || !file.uri) {
    throw new Error(`Uploaded video never became ready (state: ${file.state}).`);
  }
  return file as GeminiVideoFile & { uri: string };
}

async function downloadGeminiOmniEditedVideo(
  video: OutputVideoContent,
  deps: GeminiVideoEditDeps
): Promise<Buffer> {
  if (video.data) return Buffer.from(video.data, "base64");
  if (!video.uri) throw new Error("Edited video has neither data nor uri.");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-gemini-edit-"));
  const tmpPath = path.join(tmpDir, "edited.mp4");
  try {
    try {
      await deps.ai.files.download({ file: video.uri, downloadPath: tmpPath });
      const stat = await fs.stat(tmpPath);
      if (stat.size > 0) return await fs.readFile(tmpPath);
    } catch {
      // fall through to a direct authenticated fetch
    }

    const url = video.uri.includes("alt=media")
      ? video.uri
      : `${video.uri}${video.uri.includes("?") ? "&" : "?"}alt=media`;
    const response = await (deps.fetchImpl || fetch)(url, {
      headers: { "x-goog-api-key": deps.apiKey },
    });
    if (!response.ok) {
      throw new Error(`Downloading the edited video failed (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function transcodeVideoForGeminiOmni(
  inputPath: string,
  outputPath: string,
  runExecFile: typeof execFileAsync
): Promise<void> {
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
  await runExecFile(ffmpegPath, [
    "-y",
    "-i",
    inputPath,
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
    outputPath,
  ]);
}

async function createGeminiOmniVideoEdit(
  fileUri: string,
  mimeType: GeminiOmniVideoMime,
  prompt: string,
  deps: GeminiVideoEditDeps
): Promise<GeminiOmniInteraction> {
  return (await deps.ai.interactions.create({
    model: GEMINI_OMNI_EDIT_MODEL,
    background: true,
    input: [
      { type: "video", uri: fileUri, mime_type: mimeType },
      { type: "text", text: prompt },
    ],
  })) as GeminiOmniInteraction;
}

export async function editGeminiVideo(
  input: Extract<GenerateAssetRequest, { provider: "gemini"; kind: "video" }>,
  deps: GeminiVideoEditDeps
): Promise<GeneratedAssetResult> {
  const prompt = requirePrompt(input.prompt);
  if (!input.editSourceVideoPath) {
    throw new Error("Gemini video editing requires editSourceVideoPath.");
  }

  const wait = deps.sleep || sleep;
  const now = deps.now || Date.now;
  const model = GEMINI_OMNI_EDIT_MODEL;
  const sourcePath = input.editSourceVideoPath;
  const sourceMimeType = mimeForVideoEditPath(sourcePath);
  const file = await uploadGeminiVideoAndWaitActive(sourcePath, sourceMimeType, deps);

  let interaction: GeminiOmniInteraction;
  try {
    interaction = await createGeminiOmniVideoEdit(
      file.uri,
      normalizeGeminiVideoMime(file.mimeType || sourceMimeType),
      prompt,
      deps
    );
  } catch (err) {
    if (!isInvalidArgumentError(err)) throw err;
    console.info(
      "[gemini] omni interaction rejected the source video; transcoding to h264 mp4 and retrying"
    );
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-gemini-edit-"));
    try {
      const convertedPath = path.join(tmpDir, "converted.mp4");
      await transcodeVideoForGeminiOmni(
        sourcePath,
        convertedPath,
        deps.execFileAsync || execFileAsync
      );
      const convertedFile = await uploadGeminiVideoAndWaitActive(
        convertedPath,
        "video/mp4",
        deps
      );
      interaction = await createGeminiOmniVideoEdit(
        convertedFile.uri,
        "video/mp4",
        prompt,
        deps
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
  console.info(`[gemini] omni video edit interaction started: ${interaction.id}`);

  const editDeadline = now() + EDIT_DEADLINE_MS;
  while (
    (interaction.status === "in_progress" ||
      interaction.status === "requires_action") &&
    now() < editDeadline
  ) {
    await wait(POLL_INTERVAL_MS);
    interaction = (await deps.ai.interactions.get(
      interaction.id
    )) as GeminiOmniInteraction;
  }
  if (interaction.status !== "completed") {
    const detail =
      interaction.status === "in_progress"
        ? "timed out before completion"
        : `ended with status "${interaction.status}"`;
    throw new Error(`Gemini Omni video edit ${detail}.`);
  }

  const outputVideo = findGeminiOmniOutputVideo(interaction);
  if (!outputVideo) {
    const text = interaction.output_text || "";
    throw new Error(`Gemini Omni returned no video output. ${text.slice(0, 300)}`);
  }
  const sourceDurationSec = Math.max(0, Number(input.seconds) || 0);
  return {
    kind: "video",
    bytes: await downloadGeminiOmniEditedVideo(outputVideo, deps),
    extension: "mp4",
    mimeType: normalizeGeminiVideoMime(outputVideo.mime_type || "video/mp4"),
    provider: "gemini",
    model,
    prompt,
    durationSec: sourceDurationSec || undefined,
    costUsd: estimateCostUsd({
      provider: "gemini",
      kind: "video",
      model,
      durationSec: sourceDurationSec,
    }),
    providerSettings: characterProviderSettings(input),
  };
}

async function generateGeminiVideo(
  input: Extract<GenerateAssetRequest, { provider: "gemini"; kind: "video" }>
): Promise<GeneratedAssetResult> {
  const key = await resolveProviderApiKey("gemini");
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set for the Gemini provider.");
  }

  const prompt = requirePrompt(input.prompt);
  const model = input.model || GEMINI_DEFAULT_VIDEO_MODEL;
  const durationSeconds = normalizeGeminiVideoSeconds(input.seconds);
  const ai = new GoogleGenAI({ apiKey: key });
  if (input.editSourceVideoPath) {
    return editGeminiVideo(input, { ai, apiKey: key });
  }
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
