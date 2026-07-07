import { createHash } from "node:crypto";

import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import { estimateCostUsd as estimateGenerativeCostUsd } from "@/lib/generative/pricing";
import {
  getAsset as realGetAsset,
  type V1Asset,
} from "@/lib/api/v1/store";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runEditVideoAssetJob as realRunEditVideoAssetJob } from "./edit-video-asset-job";

type EditVideoProvider = "gemini" | "mock";

export interface EditVideoAssetInput {
  sourceAssetId: string;
  instruction: string;
  beatId?: string;
  provider?: EditVideoProvider;
  model?: string;
}

export interface EditVideoAssetOutput {
  jobId?: string;
  assetIds?: string[];
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

const DEFAULT_EDIT_PROVIDER: EditVideoProvider = "gemini";
const DEFAULT_EDIT_MODEL = "gemini-omni-flash-preview";

export const editVideoAssetInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceAssetId: {
      type: "string",
      description: "Existing ready video asset to edit.",
    },
    instruction: {
      type: "string",
      description: "Natural-language content change to apply to the source video.",
    },
    beatId: {
      type: "string",
      description: "Optional planned beat id when the edited clip should fill a beat slot.",
    },
    provider: {
      type: "string",
      enum: ["gemini", "mock"],
      description:
        "Optional test/dev provider override. Omit to use Gemini Omni for video editing.",
    },
    model: {
      type: "string",
      description: "Optional provider model override for the edit.",
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
  },
  required: [],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is EditVideoProvider {
  return value === "gemini" || value === "mock";
}

function requiredTrimmedString(
  value: unknown,
  field: string
): string {
  if (typeof value !== "string") {
    throw new ToolInputError(`edit_video_asset ${field} must be a string.`, {});
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolInputError(`edit_video_asset ${field} is required.`, {});
  }
  return trimmed;
}

function optionalTrimmedString(
  value: unknown,
  field: string
): string | undefined {
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
    throw new ToolInputError("edit_video_asset provider must be gemini or mock.", {});
  }

  const sourceAssetId = requiredTrimmedString(input.sourceAssetId, "sourceAssetId");
  const instruction = requiredTrimmedString(input.instruction, "instruction");
  const beatId = optionalTrimmedString(input.beatId, "beatId");
  const model = optionalTrimmedString(input.model, "model");
  return {
    sourceAssetId,
    instruction,
    ...(beatId ? { beatId } : {}),
    ...(isProvider(input.provider) ? { provider: input.provider } : {}),
    ...(model ? { model } : {}),
  };
}

function normalizedInstruction(instruction: string): string {
  return instruction.replace(/\s+/g, " ").trim().toLowerCase();
}

function idempotencyKey(input: {
  sourceAssetId: string;
  sourceContentHash?: string;
  instruction: string;
  model: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceAssetId: input.sourceAssetId,
        sourceContentHash: input.sourceContentHash ?? "",
        instruction: normalizedInstruction(input.instruction),
        model: input.model,
      })
    )
    .digest("hex");
}

function sourceNotReady(sourceAssetId: string): ToolCallResult<EditVideoAssetOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "edit_video_asset needs the source video asset to be ready with stored bytes.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "ready_source_video",
          because: `Source asset ${sourceAssetId} is not ready for provider editing.`,
          satisfyWith: {
            tool: "edit_video_asset",
            inputHint: { sourceAssetId, retryAfter: "upload_processing" },
          },
        },
      ],
      suggestedNextTools: [
        {
          tool: "edit_video_asset",
          inputHint: { sourceAssetId, retryAfter: "upload_processing" },
        },
      ],
      details: { sourceAssetId },
    },
  };
}

function invalidSource(source: V1Asset): ToolCallResult<EditVideoAssetOutput> {
  return {
    status: "failed",
    error: {
      kind: "invalid_input",
      message: `edit_video_asset source ${source.id} must be a video asset.`,
      recoverable: true,
      details: { sourceAssetId: source.id, kind: source.kind },
    },
  };
}

export function createEditVideoAssetTool(
  deps: Partial<EditVideoAssetDeps> = {}
): ToolDefinition<EditVideoAssetInput, EditVideoAssetOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    name: "edit_video_asset",
    description:
      "Edit the content of an existing ready video asset from a natural-language instruction, producing a new non-destructive video asset linked to the source. Runs asynchronously.",
    usage: {
      preconditions: [
        "A ready source video asset exists with stored bytes.",
        "The user has asked to change the content of existing footage or a generated clip.",
      ],
      produces: [
        "A new video asset with graph input role edited_from pointing to the source asset.",
        "When beatId is provided, the edited beat_clip can replace that beat's active clip selection.",
      ],
      useWhen: [
        "The user asks to add, remove, replace, or alter something inside existing footage or a generated clip.",
        "Use this instead of generate_clip when the request is about changing an existing video rather than creating a fresh clip from a beat prompt.",
      ],
    },
    inputSchema: editVideoAssetInputSchema,
    outputSchema: editVideoAssetOutputSchema,
    execution: "async",
    parseInput: parseEditVideoAssetInput,
    async estimateCost(input, context) {
      if (!context.projectId) {
        return {
          estimatedCostUsd: estimateGenerativeCostUsd({
            provider: input.provider ?? DEFAULT_EDIT_PROVIDER,
            kind: "video",
            durationSec: 8,
            model: input.model ?? DEFAULT_EDIT_MODEL,
          }),
          unit: "video_edit",
          notes: "Fallback estimate; source duration was unavailable.",
        };
      }
      try {
        const source = await resolved.getAsset(
          context.auth.workspaceId,
          context.projectId,
          input.sourceAssetId
        );
        return {
          estimatedCostUsd: estimateGenerativeCostUsd({
            provider: input.provider ?? DEFAULT_EDIT_PROVIDER,
            kind: "video",
            durationSec: source.durationSec ?? 8,
            model: input.model ?? DEFAULT_EDIT_MODEL,
          }),
          unit: "source_video_seconds",
          notes: "Estimated from the source video duration.",
        };
      } catch {
        return {
          estimatedCostUsd: estimateGenerativeCostUsd({
            provider: input.provider ?? DEFAULT_EDIT_PROVIDER,
            kind: "video",
            durationSec: 8,
            model: input.model ?? DEFAULT_EDIT_MODEL,
          }),
          unit: "video_edit",
          notes: "Fallback estimate; source asset could not be read.",
        };
      }
    },
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
        return sourceNotReady(input.sourceAssetId);
      }

      if (source.kind !== "video") return invalidSource(source);
      if (source.status !== "ready" || !source.storageKey) return sourceNotReady(source.id);

      const provider = input.provider ?? DEFAULT_EDIT_PROVIDER;
      const model = input.model ?? DEFAULT_EDIT_MODEL;
      const { job, created } = await resolved.createJob({
        type: "asset_generation",
        projectId: context.projectId,
        idempotencyKey: idempotencyKey({
          sourceAssetId: source.id,
          sourceContentHash: source.contentHash,
          instruction: input.instruction,
          model,
        }),
      });

      if (created) {
        void resolved.runEditVideoAssetJob({
          jobId: job.id,
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          sourceAssetId: source.id,
          instruction: input.instruction,
          sourceContentHash: source.contentHash,
          sourceDurationSec: source.durationSec,
          sourceRole: source.role,
          ...(input.beatId ? { beatId: input.beatId } : {}),
          provider,
          model,
          ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
        });
      }

      return {
        status: "accepted",
        jobId: job.id,
        resumesWhen: "job_terminal",
        estimatedCostUsd: estimateGenerativeCostUsd({
          provider,
          kind: "video",
          durationSec: source.durationSec ?? 8,
          model,
        }),
      };
    },
  };
}
