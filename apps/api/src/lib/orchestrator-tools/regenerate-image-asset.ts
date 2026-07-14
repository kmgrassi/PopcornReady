import {
  regenerateImageAsset as realRegenerateImageAsset,
  type RegenerateImageAssetArgs,
} from "@/lib/api/v1/regenerate-asset";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export interface RegenerateImageAssetInput {
  assetId: string;
  prompt: string;
  provider?: string;
  model?: string;
}

export interface RegenerateImageAssetOutput {
  assetId: string;
  url?: string;
}

export interface RegenerateImageAssetToolDeps {
  regenerateImageAsset: (args: RegenerateImageAssetArgs) => ReturnType<typeof realRegenerateImageAsset>;
}

const defaultDeps: RegenerateImageAssetToolDeps = {
  regenerateImageAsset: realRegenerateImageAsset,
};

export const regenerateImageAssetInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assetId: { type: "string", description: "The existing image asset to replace." },
    prompt: { type: "string", description: "The complete replacement image prompt." },
    provider: { type: "string", description: "Optional image provider override." },
    model: { type: "string", description: "Optional image model override." },
  },
  required: ["assetId", "prompt"],
} as const;

export const regenerateImageAssetOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assetId: { type: "string" },
    url: { type: "string" },
  },
  required: ["assetId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(input: Record<string, unknown>, field: "assetId" | "prompt"): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolInputError(`regenerate_image_asset ${field} must be a non-empty string.`, {});
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, field: "provider" | "model"): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`regenerate_image_asset ${field} must be a string.`, {});
  }
  return value.trim() || undefined;
}

export function parseRegenerateImageAssetInput(input: unknown): RegenerateImageAssetInput {
  if (!isRecord(input)) {
    throw new ToolInputError("regenerate_image_asset input must be an object.", {
      expected: regenerateImageAssetInputSchema,
    });
  }
  const allowed = new Set(["assetId", "prompt", "provider", "model"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length) {
    throw new ToolInputError("regenerate_image_asset received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  const provider = optionalString(input, "provider");
  const model = optionalString(input, "model");
  return {
    assetId: requiredString(input, "assetId"),
    prompt: requiredString(input, "prompt"),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
}

export function createRegenerateImageAssetTool(
  deps: Partial<RegenerateImageAssetToolDeps> = {}
): ToolDefinition<RegenerateImageAssetInput, RegenerateImageAssetOutput> {
  const resolved = { ...defaultDeps, ...deps };
  return {
    ...toolDefinitionMetadata("regenerate_image_asset"),
    description:
      "Regenerate one existing image asset from a replacement prompt. Mints a new immutable version and repoints active selections to it.",
    usage: {
      preconditions: ["The target asset is an image in the current workspace."],
      produces: ["A new immutable version of the target image, selected wherever the prior version was selected."],
      useWhen: ["Request Changes targets an existing image tile, keyframe, or visual anchor."],
    },
    inputSchema: regenerateImageAssetInputSchema,
    outputSchema: regenerateImageAssetOutputSchema,
    parseInput: parseRegenerateImageAssetInput,
    estimateCost: () => ({
      notes: "Provider cost is recorded by the image regeneration executor.",
    }),
    async execute(input, context): Promise<ToolCallResult<RegenerateImageAssetOutput>> {
      const media = await resolved.regenerateImageAsset({
        workspaceId: context.auth.workspaceId,
        assetId: input.assetId,
        prompt: input.prompt,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });
      return {
        status: "succeeded",
        resourceIds: [input.assetId],
        output: { assetId: input.assetId, ...(media.url ? { url: media.url } : {}) },
      };
    },
  };
}
