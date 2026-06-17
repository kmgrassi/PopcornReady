import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { Project } from "@popcorn/shared/types";
import type { VersionedTimeline } from "@popcorn/shared/v1/types";
import { createExportVideoTool, parseExportVideoInput } from "../export-video";
import { runExportVideoJob } from "../export-video-job";
import { ToolInputError, type ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const timeline: VersionedTimeline = {
  id: "timeline_1",
  schemaVersion: "timeline.v1",
  projectId: "proj_1",
  briefVersionId: "brief_1",
  aspectRatio: "16:9",
  fps: 30,
  segments: [
    {
      id: "seg_1",
      clipId: "clip_1",
      sourceInSec: 0,
      sourceOutSec: 4,
      role: "Hook",
      beatId: "beat_1",
      reason: "Open on the hero shot.",
    },
  ],
  provenance: {
    briefVersionId: "brief_1",
    sourceAssetIds: ["clip_1"],
    generatedAssetJobIds: [],
    criticReport: null,
    appliedPatchCount: 0,
  },
  createdBy: { jobId: "job_assemble" },
  createdAt: "2026-06-17T00:00:00.000Z",
};

const project: Project = {
  id: "proj_1",
  goal: "Export the finished cut.",
  plan: null,
  timeline: {
    aspectRatio: "16:9",
    fps: 30,
    segments: timeline.segments,
  },
  clips: [
    {
      id: "clip_1",
      kind: "video",
      url: "https://example.com/clip.mp4",
      filename: "clip.mp4",
      durationSec: 4,
      description: "Seed clip for the export unit test.",
    },
  ],
  critic: null,
  chat: [],
  updatedAt: timeline.createdAt,
};

function queuedJob() {
  return {
    job: {
      id: "job_1",
      type: "export" as const,
      status: "queued" as const,
      projectId: "proj_1",
      createdAt: "t",
      updatedAt: "t",
    },
    created: true,
  };
}

function jobsSpy() {
  const calls: string[] = [];
  let succeededResult: unknown;
  let failedError: unknown;
  return {
    calls,
    get succeededResult() {
      return succeededResult;
    },
    get failedError() {
      return failedError;
    },
    jobs: {
      async setStep() {
        calls.push("setStep");
        return {} as never;
      },
      async succeed(_id: string, result: unknown) {
        calls.push("succeed");
        succeededResult = result;
        return {} as never;
      },
      async fail(_id: string, error: unknown) {
        calls.push("fail");
        failedError = error;
        return {} as never;
      },
    },
  };
}

test("export_video requires an active timeline", async () => {
  const tool = createExportVideoTool({
    getActiveProjectTimeline: async () => null,
    createJob: async () => {
      throw new Error("must not create a job without a timeline");
    },
    runExportVideoJob: async () => {},
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "assemble_timeline");
  }
});

test("export_video accepts and kicks off the worker with the active timeline", async () => {
  let kicked:
    | {
        jobId: string;
        timelineId: string;
        orchestratorRunId?: string;
        options?: { quality?: string };
      }
    | undefined;
  const tool = createExportVideoTool({
    getActiveProjectTimeline: async () => ({
      timeline,
      timelineContentHash: "timeline_hash",
      project,
    }),
    createJob: async () => queuedJob(),
    runExportVideoJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    { quality: "preview" },
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  if (result.status === "accepted") {
    assert.equal(result.jobId, "job_1");
    assert.equal(result.resumesWhen, "job_terminal");
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kicked?.jobId, "job_1");
  assert.equal(kicked?.timelineId, "timeline_1");
  assert.equal(kicked?.orchestratorRunId, "run_1");
  assert.equal(kicked?.options?.quality, "preview");
});

test("export_video validates input before reading the timeline", () => {
  assert.throws(() => parseExportVideoInput({ durationPolicy: "forever" }), ToolInputError);
  assert.throws(() => parseExportVideoInput({ maxDeltaSec: "1" }), ToolInputError);
  assert.deepEqual(parseExportVideoInput({ format: "mp4", showCaptions: true }), {
    format: "mp4",
    showCaptions: true,
  });
});

test("runExportVideoJob saves the artifact, records an output asset, and resumes", async () => {
  const spy = jobsSpy();
  let savedArtifactId: string | undefined;
  let addedAssetInput:
    | {
        artifactId: string;
        timelineId: string;
        timelineContentHash: string;
        jobId: string;
        orchestratorRunId?: string;
      }
    | undefined;
  let resumedRun: string | undefined;

  await runExportVideoJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      timelineId: "timeline_1",
      timelineContentHash: "timeline_hash",
      project,
      options: { format: "mp4" },
    },
    {
      jobs: spy.jobs,
      runExportJob: () => ({
        artifact: {
          id: "artifact_1",
          projectId: "proj_1",
          kind: "video/mp4",
          status: "ready",
          url: "https://example.com/export.mp4",
          timelineId: "timeline_1",
          durationSec: 4,
          renderPlan: {
            schemaVersion: "render-plan.v1",
            engine: "remotion",
            timelineId: "timeline_1",
            durationPolicy: "timeline_only",
            timelineDurationSec: 4,
            audioDurationSec: 0,
            audioAssetIds: [],
            durationSec: 4,
            output: {
              format: "mp4",
              codec: "h264",
              width: 1920,
              height: 1080,
              fps: 30,
              quality: "standard",
            },
            format: "mp4",
            quality: "standard",
            showCaptions: false,
          },
          createdAt: "2026-06-17T00:00:00.000Z",
        },
      }),
      saveArtifact: async (artifact) => {
        savedArtifactId = artifact.id;
        return artifact;
      },
      addExportVideoAsset: async (input) => {
        addedAssetInput = {
          artifactId: input.artifact.id,
          timelineId: input.timelineId,
          timelineContentHash: input.timelineContentHash,
          jobId: input.jobId,
          orchestratorRunId: input.orchestratorRunId,
        };
        return { id: "asset_1" } as never;
      },
      resumeOrchestratorRun: async (runId) => {
        resumedRun = runId;
      },
    }
  );

  assert.equal(savedArtifactId, "artifact_1");
  assert.deepEqual(addedAssetInput, {
    artifactId: "artifact_1",
    timelineId: "timeline_1",
    timelineContentHash: "timeline_hash",
    jobId: "job_1",
    orchestratorRunId: "run_1",
  });
  assert.deepEqual(spy.succeededResult, {
    artifactId: "artifact_1",
    assetIds: ["asset_1"],
    timelineId: "timeline_1",
    status: "ready",
  });
  assert.equal(resumedRun, "run_1");
  assert.ok(!spy.calls.includes("fail"));
});
