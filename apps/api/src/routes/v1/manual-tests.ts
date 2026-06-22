import { Router } from "express";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { providerFor } from "@/lib/generative/providers";
import type { IdeogramImageModel } from "@popcorn/shared/generative/types";

export const manualTestsRouter = Router();

const MANUAL_IDEOGRAM_TEST_WARNING =
  "Manual Ideogram smoke-test endpoint only. Do not use this endpoint for general image generation, product workflows, or persisted asset creation.";

export interface ManualIdeogramImageTestInput {
  prompt: string;
  model?: IdeogramImageModel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIdeogramModel(value: unknown): IdeogramImageModel | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "ideogram-v4" || value === "ideogram-v3") return value;
  throw new ApiError("validation_failed", "model must be ideogram-v4 or ideogram-v3.", {
    fields: [{ path: "model", message: "Must be ideogram-v4 or ideogram-v3." }],
  });
}

export function parseManualIdeogramImageTestRequest(
  body: unknown
): ManualIdeogramImageTestInput {
  if (!isRecord(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.", {
      fields: [{ path: "", message: "Must be an object." }],
    });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    throw new ApiError("validation_failed", "prompt is required.", {
      fields: [{ path: "prompt", message: "Must be a non-empty string." }],
    });
  }

  return {
    prompt,
    ...(body.model !== undefined ? { model: parseIdeogramModel(body.model) } : {}),
  };
}

// POST /api/v1/manual-tests/ideogram-image
//
// Single-purpose manual smoke-test endpoint for Ideogram credentials and model
// switching. This intentionally does NOT create project assets, jobs, actions,
// provenance, or storage objects. Product image generation must keep using the
// generated-assets/provider pipeline.
manualTestsRouter.post(
  "/manual-tests/ideogram-image",
  mutation(async ({ body }) => {
    const input = parseManualIdeogramImageTestRequest(body);
    const result = await providerFor("ideogram").generateAsset({
      provider: "ideogram",
      kind: "image",
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
    });

    return {
      status: 200,
      body: {
        warning: MANUAL_IDEOGRAM_TEST_WARNING,
        provider: result.provider,
        model: result.model,
        prompt: result.prompt,
        mimeType: result.mimeType,
        extension: result.extension,
        byteLength: result.bytes.length,
        dataUrl: `data:${result.mimeType};base64,${result.bytes.toString("base64")}`,
      },
      headers: { "Cache-Control": "no-store" },
    };
  })
);
