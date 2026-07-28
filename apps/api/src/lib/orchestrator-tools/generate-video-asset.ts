import { startGeneratedAssetJob as realStartGeneratedAssetJob } from "@/lib/api/v1/generated-assets";
import { getAsset as realGetAsset } from "@/lib/api/v1/store";
import { estimateCostUsd } from "@/lib/generative/pricing";

import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export interface GenerateVideoAssetInput {
  prompt: string;
  description?: string;
  referenceAssetIds?: string[];
  durationSec?: number;
}

export interface GenerateVideoAssetDeps {
  startGeneratedAssetJob: typeof realStartGeneratedAssetJob;
  getAsset: typeof realGetAsset;
}

const defaults: GenerateVideoAssetDeps = {
  startGeneratedAssetJob: realStartGeneratedAssetJob,
  getAsset: realGetAsset,
};
const DEFAULT_DURATION_SEC = 8;

export const generateVideoAssetInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: { type: "string", minLength: 1, maxLength: 12_000 },
    description: { type: "string", maxLength: 2_000 },
    referenceAssetIds: {
      type: "array",
      maxItems: 16,
      items: { type: "string", minLength: 1 },
    },
    durationSec: { type: "number", minimum: 1, maximum: 30 },
  },
  required: ["prompt"],
} as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError("generate_video_asset input must be an object.");
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolInputError(`generate_video_asset ${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function parseGenerateVideoAssetInput(value: unknown): GenerateVideoAssetInput {
  const input = record(value);
  const allowed = new Set(["prompt", "description", "referenceAssetIds", "durationSec"]);
  const unsupported = Object.keys(input).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw new ToolInputError("generate_video_asset received unsupported fields.", {
      unsupportedFields: unsupported,
    });
  }
  const prompt = optionalText(input.prompt, "prompt");
  if (!prompt) throw new ToolInputError("generate_video_asset prompt is required.");
  let referenceAssetIds: string[] | undefined;
  if (input.referenceAssetIds !== undefined) {
    if (!Array.isArray(input.referenceAssetIds) || input.referenceAssetIds.length > 16) {
      throw new ToolInputError(
        "generate_video_asset referenceAssetIds must be a list of at most 16 IDs."
      );
    }
    referenceAssetIds = [
      ...new Set(
        input.referenceAssetIds.map((item) =>
          typeof item === "string" ? item.trim() : ""
        )
      ),
    ];
    if (referenceAssetIds.some((item) => !item)) {
      throw new ToolInputError(
        "generate_video_asset referenceAssetIds must contain non-empty strings."
      );
    }
  }
  const durationSec =
    input.durationSec === undefined ? undefined : Number(input.durationSec);
  if (
    durationSec !== undefined &&
    (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > 30)
  ) {
    throw new ToolInputError(
      "generate_video_asset durationSec must be between 1 and 30 seconds."
    );
  }
  return {
    prompt,
    ...(optionalText(input.description, "description") ? {
      description: optionalText(input.description, "description"),
    } : {}),
    ...(referenceAssetIds?.length ? { referenceAssetIds } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
  };
}

function acceptedJob(result: Awaited<ReturnType<typeof realStartGeneratedAssetJob>>): string {
  const job = result.body.job as { id?: unknown } | undefined;
  if (typeof job?.id !== "string") {
    throw new Error("Standalone video generation did not return a durable job.");
  }
  return job.id;
}

export function createGenerateVideoAssetTool(
  deps: Partial<GenerateVideoAssetDeps> = {}
): ToolDefinition<GenerateVideoAssetInput> {
  const d = { ...defaults, ...deps };
  return {
    ...toolDefinitionMetadata("generate_video_asset"),
    description:
      "Generate one standalone video segment without fabricating a beat, storyboard, or first frame. Provider and model are derived by the server.",
    usage: {
      produces: ["One immutable pooled graph clip; no selection is moved."],
      useWhen: ["The trusted task kind is video_create."],
    },
    inputSchema: generateVideoAssetInputSchema,
    outputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
      additionalProperties: false,
    },
    parseInput: parseGenerateVideoAssetInput,
    estimateCost: (input) => ({
      estimatedCostUsd: estimateCostUsd({
        provider: "gemini",
        kind: "video",
        durationSec: input.durationSec ?? DEFAULT_DURATION_SEC,
      }),
      unit: "video_generation",
    }),
    async execute(input, context): Promise<ToolCallResult> {
      if (!context.projectId) {
        throw new ToolInputError("generate_video_asset requires a project.");
      }
      const references = await Promise.all(
        (input.referenceAssetIds ?? []).map((assetId) =>
          d.getAsset(context.auth.workspaceId, context.projectId!, assetId)
        )
      );
      const durationSec = input.durationSec ?? DEFAULT_DURATION_SEC;
      const result = await d.startGeneratedAssetJob({
        auth: context.auth,
        projectId: context.projectId,
        ...(context.actionId ? { actionId: context.actionId } : {}),
        ...(context.sessionClaimGeneration !== undefined
          ? { sessionClaimGeneration: context.sessionClaimGeneration }
          : {}),
        body: {
          kind: "video",
          prompt: input.prompt,
          description: input.description ?? input.prompt,
          assetRole: "standalone_video",
          durationSec,
          seconds: durationSec,
          referenceAssetIds: input.referenceAssetIds ?? [],
          graphInputs: references.map((asset, position) => ({
            assetId: asset.id,
            relation: "input",
            role: "reference",
            position,
            ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
          })),
          ...(context.orchestratorRunId ? { runId: context.orchestratorRunId } : {}),
        },
      });
      const jobId = acceptedJob(result);
      return { status: "accepted", jobId, resumesWhen: "job_terminal" };
    },
  };
}
