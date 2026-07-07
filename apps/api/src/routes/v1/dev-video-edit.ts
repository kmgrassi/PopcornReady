// Dev-only "AI video edit" harness. Mounted (in public-routes.ts) ONLY when
// isVideoEditHarnessEnabled() is true, so it is flag-gated and never reachable
// in production. No auth — it stores nothing in the DB and keeps all artifacts
// in a per-job temp directory.
//
// Pipeline: upload the user's video to the Gemini Files API, then ask
// Gemini Omni Flash to edit it from the natural-language instruction
// (interactions API). No masks, no frame extraction — the model edits the
// uploaded footage directly.

import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import express, { Router, type RequestHandler } from "express";
import { GoogleGenAI } from "@google/genai";
import { ApiError } from "@/core/errors";
import { resolveProviderApiKey } from "@/lib/provider-keys/resolve";

const OMNI_MODEL = "gemini-omni-flash-preview";
const FILE_ACTIVE_DEADLINE_MS = 5 * 60 * 1000;
const EDIT_DEADLINE_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

export function isVideoEditHarnessEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = String(env.ENABLE_VIDEO_EDIT_HARNESS || "").trim().toLowerCase();
  const enabled = flag === "1" || flag === "true";
  return enabled && env.NODE_ENV !== "production";
}

type JobStage = "uploading" | "editing" | "downloading" | "done" | "error";

interface VideoEditJob {
  id: string;
  stage: JobStage;
  error?: string;
  dir: string;
  createdAt: number;
  artifacts: {
    source?: string;
    video?: string;
  };
}

const jobs = new Map<string, VideoEditJob>();

const ARTIFACT_TYPES: Record<string, string> = {
  source: "video/mp4",
  video: "video/mp4",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OutputVideoContent {
  type?: string;
  uri?: string;
  data?: string;
  mime_type?: string;
}

// Walk the interaction's steps and return the last video content block the
// model produced.
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

async function downloadOutputVideo(
  ai: GoogleGenAI,
  apiKey: string,
  video: OutputVideoContent,
  outputPath: string
): Promise<void> {
  if (video.data) {
    await fs.writeFile(outputPath, Buffer.from(video.data, "base64"));
    return;
  }
  if (!video.uri) throw new Error("Edited video has neither data nor uri.");

  try {
    await ai.files.download({ file: video.uri, downloadPath: outputPath });
    const stat = await fs.stat(outputPath);
    if (stat.size > 0) return;
  } catch {
    // fall through to a direct authenticated fetch
  }

  const url = video.uri.includes("alt=media")
    ? video.uri
    : `${video.uri}${video.uri.includes("?") ? "&" : "?"}alt=media`;
  const response = await fetch(url, {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!response.ok) {
    throw new Error(`Downloading the edited video failed (${response.status}).`);
  }
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function runPipeline(
  job: VideoEditJob,
  prompt: string,
  contentType: string
): Promise<void> {
  const sourcePath = job.artifacts.source;
  if (!sourcePath) throw new Error("Job has no source video.");

  const apiKey = await resolveProviderApiKey("gemini");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set for the Gemini provider.");
  const ai = new GoogleGenAI({ apiKey });

  // 1. Upload the source video to the Files API and wait until it's ACTIVE.
  let file = await ai.files.upload({
    file: sourcePath,
    config: { mimeType: contentType },
  });
  const fileDeadline = Date.now() + FILE_ACTIVE_DEADLINE_MS;
  while (file.state === "PROCESSING" && Date.now() < fileDeadline) {
    await sleep(3000);
    file = await ai.files.get({ name: file.name as string });
  }
  if (file.state !== "ACTIVE" || !file.uri) {
    throw new Error(`Uploaded video never became ready (state: ${file.state}).`);
  }
  job.stage = "editing";

  // 2. Ask Gemini Omni Flash to edit the video from the instruction alone.
  let interaction = await ai.interactions.create({
    model: OMNI_MODEL,
    background: true,
    input: [
      { type: "video", uri: file.uri, mime_type: "video/mp4" },
      { type: "text", text: prompt },
    ],
  });
  console.info(`[dev-video-edit] omni interaction started: ${interaction.id}`);

  const editDeadline = Date.now() + EDIT_DEADLINE_MS;
  while (
    (interaction.status === "in_progress" ||
      interaction.status === "requires_action") &&
    Date.now() < editDeadline
  ) {
    await sleep(POLL_INTERVAL_MS);
    interaction = await ai.interactions.get(interaction.id);
  }
  if (interaction.status !== "completed") {
    const detail =
      interaction.status === "in_progress"
        ? "timed out before completion"
        : `ended with status "${interaction.status}"`;
    throw new Error(`Gemini Omni video edit ${detail}.`);
  }

  // 3. Pull the edited video out of the interaction output.
  const outputVideo = findOutputVideo(interaction);
  if (!outputVideo) {
    const text = (interaction as { output_text?: string }).output_text || "";
    throw new Error(
      `Gemini Omni returned no video output. ${text.slice(0, 300)}`
    );
  }
  job.stage = "downloading";
  const videoPath = path.join(job.dir, "output.mp4");
  await downloadOutputVideo(ai, apiKey, outputVideo, videoPath);
  job.artifacts.video = videoPath;
  job.stage = "done";
}

function jobStatusBody(job: VideoEditJob) {
  const artifacts: Record<string, string> = {};
  for (const key of Object.keys(ARTIFACT_TYPES)) {
    if (job.artifacts[key as keyof VideoEditJob["artifacts"]]) {
      artifacts[key] = `/api/v1/dev/video-edit/${job.id}/artifacts/${key}`;
    }
  }
  return { jobId: job.id, stage: job.stage, error: job.error ?? null, artifacts };
}

function devRoute(
  fn: (req: Parameters<RequestHandler>[0]) => Promise<{ status: number; body: unknown }>
): RequestHandler {
  return async (req, res) => {
    try {
      const result = await fn(req);
      res.status(result.status).json(result.body);
    } catch (err) {
      const apiError =
        err instanceof ApiError
          ? err
          : new ApiError(
              "internal_error",
              err instanceof Error ? err.message : "Internal error."
            );
      res.status(apiError.status).json(apiError.envelope(req.requestId));
    }
  };
}

export const devVideoEditRouter = Router();

// POST /api/v1/dev/video-edit?prompt=... — raw video body. Starts a job and
// returns { jobId } immediately; poll the GET endpoint for progress.
devVideoEditRouter.post(
  "/dev/video-edit",
  express.raw({ type: ["video/*", "application/octet-stream"], limit: "250mb" }),
  devRoute(async (req) => {
    const prompt = String(req.query.prompt || "").trim();
    if (!prompt) {
      throw new ApiError("validation_failed", "A ?prompt= query param is required.");
    }
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new ApiError(
        "validation_failed",
        "Send the video file as the raw request body with a video/* content type."
      );
    }
    const contentType = String(req.headers["content-type"] || "video/mp4");

    const id = crypto.randomUUID();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-video-edit-"));
    const sourcePath = path.join(dir, "source.mp4");
    await fs.writeFile(sourcePath, body);

    const job: VideoEditJob = {
      id,
      stage: "uploading",
      dir,
      createdAt: Date.now(),
      artifacts: { source: sourcePath },
    };
    jobs.set(id, job);

    void runPipeline(job, prompt, contentType).catch((err) => {
      job.stage = "error";
      job.error = err instanceof Error ? err.message : String(err);
      console.error(`[dev-video-edit] job ${id} failed:`, err);
    });

    return { status: 202, body: jobStatusBody(job) };
  })
);

// GET /api/v1/dev/video-edit/:jobId — job status + available artifact URLs.
devVideoEditRouter.get(
  "/dev/video-edit/:jobId",
  devRoute(async (req) => {
    const job = jobs.get(req.params.jobId);
    if (!job) throw new ApiError("not_found", "Unknown video-edit job.");
    return { status: 200, body: jobStatusBody(job) };
  })
);

// GET /api/v1/dev/video-edit/:jobId/artifacts/:name — stream an artifact.
devVideoEditRouter.get("/dev/video-edit/:jobId/artifacts/:name", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const name = req.params.name as keyof VideoEditJob["artifacts"];
  const filePath = job?.artifacts[name];
  if (!job || !filePath || !ARTIFACT_TYPES[name]) {
    res.status(404).json({ error: "Unknown job or artifact." });
    return;
  }
  res.type(ARTIFACT_TYPES[name]).sendFile(filePath);
});
