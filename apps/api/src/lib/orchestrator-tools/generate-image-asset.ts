import { startGeneratedAssetJob as realStartGeneratedAssetJob } from "@/lib/api/v1/generated-assets";
import { getAsset as realGetAsset } from "@/lib/api/v1/store";
import { estimateCostUsd } from "@/lib/generative/pricing";

import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

const MINOR_RE = /\b(baby|boy|child|girl|kid|minor|teen|teenage|toddler|youth)\b/i;

export interface GenerateImageAssetInput {
  prompt: string;
  description?: string;
  referenceAssetIds?: string[];
  aspectRatio?: string;
}

export interface GenerateImageAssetDeps {
  startGeneratedAssetJob: typeof realStartGeneratedAssetJob;
  getAsset: typeof realGetAsset;
}

const defaults: GenerateImageAssetDeps = {
  startGeneratedAssetJob: realStartGeneratedAssetJob,
  getAsset: realGetAsset,
};

export const generateImageAssetInputSchema = {
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
    aspectRatio: { type: "string", maxLength: 32 },
  },
  required: ["prompt"],
} as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError("generate_image_asset input must be an object.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolInputError(`generate_image_asset ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function ids(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16) {
    throw new ToolInputError(
      "generate_image_asset referenceAssetIds must be a list of at most 16 IDs."
    );
  }
  const parsed = value.map((item) =>
    typeof item === "string" ? item.trim() : ""
  );
  if (parsed.some((item) => !item)) {
    throw new ToolInputError(
      "generate_image_asset referenceAssetIds must contain non-empty strings."
    );
  }
  return [...new Set(parsed)];
}

export function parseGenerateImageAssetInput(value: unknown): GenerateImageAssetInput {
  const input = record(value);
  const allowed = new Set(["prompt", "description", "referenceAssetIds", "aspectRatio"]);
  const unsupported = Object.keys(input).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw new ToolInputError("generate_image_asset received unsupported fields.", {
      unsupportedFields: unsupported,
    });
  }
  return {
    prompt: text(input.prompt, "prompt", true)!,
    ...(text(input.description, "description") ? {
      description: text(input.description, "description"),
    } : {}),
    ...(ids(input.referenceAssetIds)?.length ? {
      referenceAssetIds: ids(input.referenceAssetIds),
    } : {}),
    ...(text(input.aspectRatio, "aspectRatio") ? {
      aspectRatio: text(input.aspectRatio, "aspectRatio"),
    } : {}),
  };
}

function acceptedJob(result: Awaited<ReturnType<typeof realStartGeneratedAssetJob>>): string {
  const job = result.body.job as { id?: unknown } | undefined;
  if (typeof job?.id !== "string") {
    throw new Error("Standalone image generation did not return a durable job.");
  }
  return job.id;
}

export function createGenerateImageAssetTool(
  deps: Partial<GenerateImageAssetDeps> = {}
): ToolDefinition<GenerateImageAssetInput> {
  const d = { ...defaults, ...deps };
  return {
    ...toolDefinitionMetadata("generate_image_asset"),
    description:
      "Generate one genuine standalone image without requiring a plan, beat, storyboard, or keyframe. Provider and model are derived by the server.",
    usage: {
      produces: ["One immutable pooled graph image; no selection is moved."],
      useWhen: ["The trusted task kind is image_create."],
    },
    inputSchema: generateImageAssetInputSchema,
    outputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
      additionalProperties: false,
    },
    parseInput: parseGenerateImageAssetInput,
    estimateCost: () => ({
      estimatedCostUsd: estimateCostUsd({ provider: "openai", kind: "image" }),
      unit: "image_generation",
    }),
    async execute(input, context): Promise<ToolCallResult> {
      if (!context.projectId) {
        throw new ToolInputError("generate_image_asset requires a project.");
      }
      const references = await Promise.all(
        (input.referenceAssetIds ?? []).map((assetId) =>
          d.getAsset(context.auth.workspaceId, context.projectId!, assetId)
        )
      );
      const forceMinorSafeProvider = MINOR_RE.test(
        `${input.prompt}\n${input.description ?? ""}`
      );
      const result = await d.startGeneratedAssetJob({
        auth: context.auth,
        projectId: context.projectId,
        ...(context.actionId ? { actionId: context.actionId } : {}),
        ...(context.sessionClaimGeneration !== undefined
          ? { sessionClaimGeneration: context.sessionClaimGeneration }
          : {}),
        body: {
          kind: "image",
          prompt: input.prompt,
          description: input.description ?? input.prompt,
          assetRole: "standalone_image",
          referenceAssetIds: input.referenceAssetIds ?? [],
          graphInputs: references.map((asset, position) => ({
            assetId: asset.id,
            relation: "input",
            role: "reference",
            position,
            ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
          })),
          ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
          ...(forceMinorSafeProvider ? { provider: "gemini" } : {}),
          ...(context.orchestratorRunId ? { runId: context.orchestratorRunId } : {}),
        },
      });
      const jobId = acceptedJob(result);
      return { status: "accepted", jobId, resumesWhen: "job_terminal" };
    },
  };
}
