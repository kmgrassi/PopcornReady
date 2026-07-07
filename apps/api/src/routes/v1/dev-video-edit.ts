// Dev-only "AI video edit" harness. Mounted (in public-routes.ts) ONLY when
// isVideoEditHarnessEnabled() is true, so it is flag-gated and never reachable
// in production. No auth — it stores nothing in the DB and keeps all artifacts
// in a per-job temp directory.
//
// Pipeline (no true video-to-video provider is wired yet, see
// docs/scopes — this approximates an edit with the keys we have):
//   1. ffmpeg extracts the first frame of the uploaded video
//   2. Gemini image-edit ("nano banana") applies the prompt to that frame
//   3. Veo image-to-video animates the edited frame into a new clip

import { execFile } from "child_process";
import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import express, { Router, type RequestHandler } from "express";
import { ApiError } from "@/core/errors";
import { geminiProvider } from "@/lib/generative/providers/gemini";

const execFileAsync = promisify(execFile);

export function isVideoEditHarnessEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = String(env.ENABLE_VIDEO_EDIT_HARNESS || "").trim().toLowerCase();
  const enabled = flag === "1" || flag === "true";
  return enabled && env.NODE_ENV !== "production";
}

type JobStage =
  | "extracting_frame"
  | "editing_frame"
  | "animating"
  | "done"
  | "error";

interface VideoEditJob {
  id: string;
  stage: JobStage;
  error?: string;
  dir: string;
  createdAt: number;
  artifacts: {
    source?: string;
    frame?: string;
    editedFrame?: string;
    video?: string;
  };
}

const jobs = new Map<string, VideoEditJob>();

const ARTIFACT_TYPES: Record<string, string> = {
  source: "video/mp4",
  frame: "image/png",
  editedFrame: "image/png",
  video: "video/mp4",
};

async function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
  await execFileAsync(ffmpegPath, args);
}

async function probeSize(
  filePath: string
): Promise<{ width: number; height: number } | null> {
  const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      filePath,
    ]);
    const [width, height] = stdout.trim().split("x").map(Number);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return { width, height };
    }
  } catch {
    // fall through — orientation defaults to landscape
  }
  return null;
}

async function runPipeline(job: VideoEditJob, prompt: string): Promise<void> {
  const sourcePath = job.artifacts.source;
  if (!sourcePath) throw new Error("Job has no source video.");

  // 1. First frame. Cap at 1280 wide so the image models get a sane input.
  const framePath = path.join(job.dir, "frame.png");
  await runFfmpeg([
    "-y",
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-vf",
    "scale='min(1280,iw)':-2",
    framePath,
  ]);
  job.artifacts.frame = framePath;
  job.stage = "editing_frame";

  const size = await probeSize(sourcePath);
  const portrait = size ? size.height > size.width : false;

  // 2. Edit the frame with the user's instruction, preserving the scene.
  const edited = await geminiProvider.generateAsset({
    provider: "gemini",
    kind: "image",
    prompt:
      `Edit this photo: ${prompt}. ` +
      "Keep the rest of the scene, lighting, camera angle, and framing exactly the same as the reference photo. Photorealistic.",
    referencePaths: [framePath],
  });
  const editedFramePath = path.join(job.dir, `edited.${edited.extension}`);
  await fs.writeFile(editedFramePath, edited.bytes);
  job.artifacts.editedFrame = editedFramePath;
  job.stage = "animating";

  // 3. Animate the edited frame with Veo (image-to-video).
  const video = await geminiProvider.generateAsset({
    provider: "gemini",
    kind: "video",
    prompt:
      `${prompt}. The scene matches the reference image exactly — same room, camera angle, and lighting. ` +
      "Subtle handheld camera motion, natural ambient movement. Photorealistic.",
    referencePaths: [editedFramePath],
    size: portrait ? "720x1280" : "1280x720",
    seconds: 8,
  });
  const videoPath = path.join(job.dir, "output.mp4");
  await fs.writeFile(videoPath, video.bytes);
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

    const id = crypto.randomUUID();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-video-edit-"));
    const sourcePath = path.join(dir, "source.mp4");
    await fs.writeFile(sourcePath, body);

    const job: VideoEditJob = {
      id,
      stage: "extracting_frame",
      dir,
      createdAt: Date.now(),
      artifacts: { source: sourcePath },
    };
    jobs.set(id, job);

    void runPipeline(job, prompt).catch((err) => {
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
