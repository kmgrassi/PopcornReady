import { createHash } from "node:crypto";
import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import {
  getAsset as realGetAsset,
  type V1Asset,
} from "@/lib/api/v1/store";
import { estimateCostUsd as estimateGenerativeCostUsd } from "@/lib/generative/pricing";
import { createLogger } from "@/lib/v1/logger";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runEditVideoAssetJob as realRunEditVideoAssetJob } from "./edit-video-asset-job";

type VideoProvider =
  | "openai"
  | "gemini"
  | "runway"
  | "ltx"
  | "kling"
  | "seedance"
  | "xai"
  | "nvidia_api_catalog"
  | "mock";

export interface EditVideoAssetInput {
  sourceAssetId: string;
  instruction: string;
  beatId?: string;
  provider?: VideoProvider;
  model?: string;
}

export interface EditVideoAssetOutput {
  jobId?: string;
  assetIds?: string[];
  sourceAssetId?: string;
}

export interface EditVideoAssetDeps {
  getAsset: typeof realGetAsset;
  createJob: AgentApiStore["createOrGetJob"];
  runEditVideoAssetJob: typeof realRunEditVideoAssetJob;
}

const defaultDeps: EditVideoAssetDeps = {
  getAsset: realGetAsset,
  createJob: (input) => agentApiStore.createOrGetJob(input),
  runEditVideoAssetJob: realRunEditVideoAssetJob,
};

const logger = createLogger();
const DEFAULT_VIDEO_EDIT_PROVIDER: VideoProvider = "gemini";

export const editVideoAssetInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceAssetId: {
      type: "string",
      description: "The existing uploaded footage or generated video asset to edit.",
    },
    instruction: {
      type: "string",
      description: "The user's requested content change to apply to the source video.",
    },
    beatId: {
      type: "string",
      description: "Optional beat id when editing a clip already selected for a beat.",
    },
    provider: {
      type: "string",
      enum: [
        "openai",
        "gemini",
        "runway",
        "ltx",
        "kling",
        "seedance",
        "xai",
        "nvidia_api_catalog",
        "mock",
      ],
      description:
        "Optional video provider override. Use mock only when the user explicitly asks for mock/test provider.",
    },
    model: {
      type: "string",
      description: "Optional provider model override.",
    },
  },
  required: ["sourceAssetId", "instruction"],
} as const;

export const editVideoAssetOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobId: { type: "string" },
    assetIds: { type: "array", items: { type: "string" } },
    sourceAssetId: { type: "string" },
  },
  required: [],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is VideoProvider {
  return (
    value === "openai" ||
    value === "gemini" ||
    value === "runway" ||
    value === "ltx" ||
    value === "kling" ||
    value === "seedance" ||
    value === "xai" ||
    value === "nvidia_api_catalog" ||
    value === "mock"
  );
}

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolInputError(`edit_video_asset ${field} must be a non-empty string.`, {});
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`edit_video_asset ${field} must be a string.`, {});
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseEditVideoAssetInput(input: unknown): EditVideoAssetInput {
  if (!isRecord(input)) {
    throw new ToolInputError("edit_video_asset input must be an object.", {
      expected: editVideoAssetInputSchema,
    });
  }
  const allowed = new Set(["sourceAssetId", "instruction", "beatId", "provider", "model"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("edit_video_asset received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  if (input.provider !== undefined && !isProvider(input.provider)) {
    throw new ToolInputError(
      "edit_video_asset provider must be openai, gemini, runway, ltx, kling, seedance, xai, nvidia_api_catalog, or mock.",
      {}
    );
  }

  return {
    sourceAssetId: requiredString(input, "sourceAssetId"),
    instruction: requiredString(input, "instruction"),
    ...(optionalString(input, "beatId") ? { beatId: optionalString(input, "beatId") } : {}),
    ...(isProvider(input.provider) ? { provider: input.provider } : {}),
    ...(optionalString(input, "model") ? { model: optionalString(input, "model") } : {}),
  };
}

function cannotEdit(reason: string, sourceAssetId: string): ToolCallResult<EditVideoAssetOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: reason,
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "ready_video_asset",
          because: reason,
          satisfyWith: { tool: "generate_clip", inputHint: { sourceAssetId } },
        },
      ],
      suggestedNextTools: [{ tool: "generate_clip", inputHint: {} }],
      details: { sourceAssetId },
    },
  };
}

function idempotencyKey(input: EditVideoAssetInput, source: V1Asset): string {
  return createHash("sha256")
    .update(input.sourceAssetId)
    .update("\0")
    .update(source.contentHash ?? "")
    .update("\0")
    .update(input.instruction.trim().toLowerCase().replace(/\s+/g, " "))
    .update("\0")
    .update(input.provider ?? DEFAULT_VIDEO_EDIT_PROVIDER)
    .update("\0")
    .update(input.model ?? "")
    .digest("hex");
}

export function createEditVideoAssetTool(
  deps: Partial<EditVideoAssetDeps> = {}
): ToolDefinition<EditVideoAssetInput, EditVideoAssetOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    name: "edit_video_asset",
    description:
      "Edit the content of an existing uploaded footage asset or generated video clip. Produces a new video asset linked to the source with an edited_from graph input. Runs asynchronously.",
    usage: {
      preconditions: [
        "The sourceAssetId points at a ready video asset with stored bytes.",
        "Use the user's Request Changes target asset as sourceAssetId.",
      ],
      produces: [
        "A new video asset with graph input role edited_from pointing to the source asset.",
        "Any active project selection that referenced the source asset is moved to the edited asset.",
      ],
      useWhen: [
        "The user asks to change existing footage or a generated clip by adding, removing, replacing, restyling, or modifying content inside that video.",
        "For Request Changes on uploaded primary_footage or a specific clip asset, choose this instead of generate_clip.",
      ],
    },
    inputSchema: editVideoAssetInputSchema,
    outputSchema: editVideoAssetOutputSchema,
    execution: "async",
    parseInput: parseEditVideoAssetInput,
    estimateCost: (input) => ({
      estimatedCostUsd: estimateGenerativeCostUsd({
        provider: input.provider ?? DEFAULT_VIDEO_EDIT_PROVIDER,
        kind: "video",
        durationSec: 8,
        model: input.model,
      }),
      unit: "video_edit",
      notes: "Estimated from source video duration when available during execution.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "edit_video_asset requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      let source: V1Asset;
      try {
        source = await resolved.getAsset(
          context.auth.workspaceId,
          context.projectId,
          input.sourceAssetId
        );
      } catch {
        return cannotEdit(`Source asset not found: ${input.sourceAssetId}.`, input.sourceAssetId);
      }
      if (source.kind !== "video") {
        return cannotEdit(`Source asset ${input.sourceAssetId} is not a video.`, input.sourceAssetId);
      }
      if (source.status !== "ready" || !source.storageKey) {
        return cannotEdit(
          `Source video asset ${input.sourceAssetId} is not ready for editing.`,
          input.sourceAssetId
        );
      }

      const { job, created } = await resolved.createJob({
        type: "asset_generation",
        projectId: context.projectId,
        idempotencyKey: idempotencyKey(input, source),
      });
      logger.info("edit_video_asset.accepted", {
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        runId: context.orchestratorRunId,
        jobId: job.id,
        sourceAssetId: input.sourceAssetId,
        created,
      });

      if (created) {
        void resolved.runEditVideoAssetJob({
          jobId: job.id,
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          sourceAssetId: source.id,
          ...(source.contentHash ? { sourceContentHash: source.contentHash } : {}),
          instruction: input.instruction,
          ...(input.beatId ? { beatId: input.beatId } : {}),
          ...(input.provider ? { provider: input.provider } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
        });
      }

      return { status: "accepted", jobId: job.id, resumesWhen: "job_terminal" };
    },
  };
}
