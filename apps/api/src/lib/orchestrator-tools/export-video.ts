import {
  createDurableOrchestratorJobCreator,
  type OrchestratorJobCreator,
} from "@/lib/orchestrator/job-gateway";
import type { ExportOptions } from "@/lib/agent-api/workers";
import { getStore, type V1Store } from "@/lib/v1/store";
import { assetToClip } from "@/lib/v1/generation/prepare";
import { canonicalContentHash } from "@/lib/api/v1/asset-graph";
import type { Project } from "@popcorn/shared/types";
import type { VersionedTimeline } from "@popcorn/shared/v1/types";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runExportVideoJob as realRunExportVideoJob } from "./export-video-job";

export interface ActiveProjectTimeline {
  timeline: VersionedTimeline;
  timelineContentHash: string;
  project: Project;
}

export interface ExportVideoInput {
  format?: "mp4";
  quality?: string;
  durationPolicy?: ExportOptions["durationPolicy"];
  maxDeltaSec?: number;
  showCaptions?: boolean;
}

export interface ExportVideoOutput {
  jobId: string;
}

export interface ExportVideoDeps {
  getActiveProjectTimeline: (
    workspaceId: string,
    projectId: string
  ) => Promise<ActiveProjectTimeline | null>;
  createJob: OrchestratorJobCreator["createJob"];
  runExportVideoJob: typeof realRunExportVideoJob;
}

const defaultDeps: ExportVideoDeps = {
  getActiveProjectTimeline: getActiveProjectTimelineFromStore,
  createJob: createDurableOrchestratorJobCreator().createJob,
  runExportVideoJob: realRunExportVideoJob,
};

export const exportVideoInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    format: { type: "string", enum: ["mp4"], description: "Output format. Only mp4 is supported." },
    quality: { type: "string", description: "Renderer quality preset." },
    durationPolicy: {
      type: "string",
      enum: ["timeline_only", "match_longest_media", "fail_on_mismatch"],
      description: "How to resolve timeline/audio duration mismatches.",
    },
    maxDeltaSec: {
      type: "number",
      description: "Allowed audio/timeline mismatch before fail_on_mismatch rejects the export.",
    },
    showCaptions: { type: "boolean", description: "Whether captions should be burned in." },
  },
  required: [],
} as const;

export const exportVideoOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { jobId: { type: "string" } },
  required: ["jobId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDurationPolicy(value: unknown): value is ExportOptions["durationPolicy"] {
  return (
    value === "timeline_only" ||
    value === "match_longest_media" ||
    value === "fail_on_mismatch"
  );
}

export function parseExportVideoInput(input: unknown): ExportVideoInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("export_video input must be an object.", {
      expected: exportVideoInputSchema,
    });
  }
  const allowed = new Set(["format", "quality", "durationPolicy", "maxDeltaSec", "showCaptions"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("export_video received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  if (input.format !== undefined && input.format !== "mp4") {
    throw new ToolInputError("export_video format must be mp4.", {});
  }
  if (input.quality !== undefined && typeof input.quality !== "string") {
    throw new ToolInputError("export_video quality must be a string.", {});
  }
  if (input.durationPolicy !== undefined && !isDurationPolicy(input.durationPolicy)) {
    throw new ToolInputError(
      "export_video durationPolicy must be timeline_only, match_longest_media, or fail_on_mismatch.",
      {}
    );
  }
  if (input.maxDeltaSec !== undefined && typeof input.maxDeltaSec !== "number") {
    throw new ToolInputError("export_video maxDeltaSec must be a number.", {});
  }
  if (input.showCaptions !== undefined && typeof input.showCaptions !== "boolean") {
    throw new ToolInputError("export_video showCaptions must be a boolean.", {});
  }
  return {
    ...(input.format === "mp4" ? { format: input.format } : {}),
    ...(typeof input.quality === "string" && input.quality.trim()
      ? { quality: input.quality.trim() }
      : {}),
    ...(input.durationPolicy ? { durationPolicy: input.durationPolicy } : {}),
    ...(typeof input.maxDeltaSec === "number" ? { maxDeltaSec: input.maxDeltaSec } : {}),
    ...(typeof input.showCaptions === "boolean" ? { showCaptions: input.showCaptions } : {}),
  };
}

async function getActiveProjectTimelineFromStore(
  workspaceId: string,
  projectId: string,
  store: V1Store = getStore()
): Promise<ActiveProjectTimeline | null> {
  const project = await store.getProject(projectId);
  if (!project || project.workspaceId !== workspaceId || project.status === "deleted") {
    return null;
  }
  const timeline = (await store.listTimelinesForProject(projectId))[0] ?? null;
  if (!timeline || timeline.segments.length === 0) return null;

  const referencedClipIds = new Set(timeline.segments.map((segment) => segment.clipId));
  const clips = (await store.listAssets(projectId))
    .filter((asset) => referencedClipIds.has(asset.id))
    .map(assetToClip);

  return {
    timeline,
    timelineContentHash: canonicalContentHash(timeline),
    project: {
      id: project.id,
      goal: project.name,
      plan: null,
      timeline: {
        aspectRatio: timeline.aspectRatio,
        fps: timeline.fps,
        ...(timeline.showCaptions === undefined ? {} : { showCaptions: timeline.showCaptions }),
        segments: timeline.segments,
      },
      clips,
      critic: timeline.provenance.criticReport,
      chat: [],
      updatedAt: timeline.createdAt,
    },
  };
}

function timelineRequired(): ToolCallResult<ExportVideoOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "export_video needs an assembled timeline before it can render a final video.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "timeline",
          because: "The export renderer needs the selected timeline segments and media references.",
          satisfyWith: { tool: "assemble_timeline", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "assemble_timeline", inputHint: {} }],
    },
  };
}

export function createExportVideoTool(
  deps: Partial<ExportVideoDeps> = {}
): ToolDefinition<ExportVideoInput, ExportVideoOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("export_video"),
    description:
      "Render the active timeline into a final mp4 export artifact. Requires assemble_timeline first. Runs asynchronously.",
    usage: {
      preconditions: ["An active assembled timeline exists (call assemble_timeline first)."],
      produces: [
        "An export job and a final output asset for the rendered timeline. The run parks until the export job reaches a terminal state.",
      ],
      useWhen: [
        "The timeline has been assembled and any requested critique or approval gates are complete.",
        "The user expects a downloadable final video output.",
      ],
    },
    inputSchema: exportVideoInputSchema,
    outputSchema: exportVideoOutputSchema,
    parseInput: parseExportVideoInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "video_render",
      notes: "Export cost depends on render duration and the configured renderer.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "export_video requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const active = await resolved.getActiveProjectTimeline(
        context.auth.workspaceId,
        context.projectId
      );
      if (!active) return timelineRequired();

      const { job } = await resolved.createJob({
        workspaceId: context.auth.workspaceId,
        type: "export",
        projectId: context.projectId,
        execution: {
          schemaVersion: "orchestrator_job_execution.v1",
          kind: "export_video",
          input: {
            workspaceId: context.auth.workspaceId,
            projectId: context.projectId,
            ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
            timelineId: active.timeline.id,
            timelineContentHash: active.timelineContentHash,
            project: active.project,
            options: input,
          },
        },
      });

      void resolved.runExportVideoJob({
        jobId: job.id,
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
        timelineId: active.timeline.id,
        timelineContentHash: active.timelineContentHash,
        project: active.project,
        options: input,
      });

      return { status: "accepted", jobId: job.id, resumesWhen: "job_terminal" };
    },
  };
}
