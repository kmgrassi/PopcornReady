// Dev-only "AI video edit" harness. Mounted (in public-routes.ts) ONLY when
// isVideoEditHarnessEnabled() is true, so it is flag-gated and never reachable
// in production. No auth — it stores nothing in the DB and keeps all artifacts
// in a per-job temp directory.
//
// Pipeline: call the shared Gemini provider's Omni edit branch. No masks, no
// frame extraction — the model edits the uploaded footage directly.

import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import express, { Router, type RequestHandler } from "express";
import { ApiError } from "@/core/errors";
import { geminiProvider } from "@/lib/generative/providers/gemini";

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

async function runPipeline(
  job: VideoEditJob,
  prompt: string
): Promise<void> {
  const sourcePath = job.artifacts.source;
  if (!sourcePath) throw new Error("Job has no source video.");

  job.stage = "editing";
  job.stage = "downloading";
  const result = await geminiProvider.generateAsset({
    provider: "gemini",
    kind: "video",
    prompt,
    editSourceVideoPath: sourcePath,
  });
  const videoPath = path.join(job.dir, "output.mp4");
  await fs.writeFile(videoPath, result.bytes);
  job.artifacts.video = videoPath;
  job.stage = "done";
}

function extensionForContentType(contentType: string): string {
  const normalized = contentType.toLowerCase().split(";")[0].trim();
  if (normalized === "video/quicktime" || normalized === "video/mov") return "mov";
  if (normalized === "video/webm") return "webm";
  if (normalized === "video/3gpp") return "3gp";
  return "mp4";
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
    const sourcePath = path.join(dir, `source.${extensionForContentType(contentType)}`);
    await fs.writeFile(sourcePath, body);

    const job: VideoEditJob = {
      id,
      stage: "uploading",
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
