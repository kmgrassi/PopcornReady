import { Router } from "express";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { bearerToken } from "@/lib/api/v1/auth";
import { createGeneratedAsset } from "@/lib/api/v1/generated-assets";
import type { HandlerCtx } from "@/lib/api/v1/handler";
import {
  createProject,
  getWorkspaceRole,
  isWorkspaceAdminRole,
} from "@/lib/api/v1/store";
import { providerFor } from "@/lib/generative/providers";
import { buildUserScopedSupabase } from "@/lib/supabase/clients";
import type { GenerativeProviderName } from "@popcorn/shared/generative/types";
import type { IdeogramImageModel } from "@popcorn/shared/generative/types";

export const manualTestsRouter = Router();

const MANUAL_IDEOGRAM_TEST_WARNING =
  "Manual Ideogram smoke-test endpoint only. Do not use this endpoint for general image generation, product workflows, or persisted asset creation.";

export interface ManualIdeogramImageTestInput {
  prompt: string;
  model?: IdeogramImageModel;
}

export interface ManualProviderAssetTestInput {
  kind: "image" | "video";
  provider: GenerativeProviderName;
  prompt: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  durationSec?: number;
}

type ManualProviderAssetBody = {
  kind: ManualProviderAssetTestInput["kind"];
  provider: GenerativeProviderName;
  prompt: string;
  assetRole: string;
  displayName: string;
  slug: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  resolution?: string;
  durationSec?: number;
};

const OPERATOR_ROLES = new Set(["admin", "owner"]);
const PROVIDER_TEST_SUPPORT: Record<
  ManualProviderAssetTestInput["kind"],
  GenerativeProviderName[]
> = {
  image: ["openai", "gemini", "ideogram", "xai"],
  video: [
    "openai",
    "gemini",
    "runway",
    "ltx",
    "kling",
    "seedance",
    "xai",
    "nvidia_api_catalog",
  ],
};

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

function claimValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function hasOperatorAppMetadata(appMetadata: Record<string, unknown> | undefined): boolean {
  if (!appMetadata) return false;
  const claims = [
    ...claimValues(appMetadata.role),
    ...claimValues(appMetadata.roles),
    ...claimValues(appMetadata.workspace_role),
  ];
  return claims.some((claim) => OPERATOR_ROLES.has(claim.toLowerCase()));
}

async function requireProviderSmokeTestAdmin(
  ctx: Pick<HandlerCtx, "auth" | "req">
): Promise<void> {
  if (ctx.auth.isLocal) return;

  const role = await getWorkspaceRole(ctx.auth.workspaceId, ctx.auth.actor.id);
  if (!isWorkspaceAdminRole(role)) {
    throw new ApiError("forbidden", "Provider smoke-test access requires admin.");
  }

  const token = bearerToken(ctx.req);
  if (!token) {
    throw new ApiError("forbidden", "Provider smoke-test access requires admin.");
  }

  const supabase = buildUserScopedSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || !hasOperatorAppMetadata(data.user.app_metadata)) {
    throw new ApiError("forbidden", "Provider smoke-test access requires admin.");
  }
}

function parseProvider(value: unknown): GenerativeProviderName {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("validation_failed", "provider is required.", {
      fields: [{ path: "provider", message: "Must be a non-empty string." }],
    });
  }
  const provider = value.trim() as GenerativeProviderName;
  const allProviders = new Set<GenerativeProviderName>([
    ...PROVIDER_TEST_SUPPORT.image,
    ...PROVIDER_TEST_SUPPORT.video,
  ]);
  if (!allProviders.has(provider)) {
    throw new ApiError("validation_failed", `Unsupported provider: ${provider}.`, {
      fields: [{ path: "provider", message: "Unsupported provider." }],
    });
  }
  return provider;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ApiError("validation_failed", `${path} must be a string.`, {
      fields: [{ path, message: "Must be a string." }],
    });
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalPositiveNumber(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError("validation_failed", `${path} must be a positive number.`, {
      fields: [{ path, message: "Must be a positive number." }],
    });
  }
  return parsed;
}

function validateAspectRatio(
  provider: GenerativeProviderName,
  kind: ManualProviderAssetTestInput["kind"],
  aspectRatio: string | undefined
): void {
  if (!aspectRatio) return;
  if (aspectRatio !== "16:9" && aspectRatio !== "9:16" && aspectRatio !== "1:1") {
    throw new ApiError("validation_failed", "aspectRatio is not supported.", {
      fields: [{ path: "aspectRatio", message: "Must be 16:9, 9:16, or 1:1." }],
    });
  }
  if (kind === "image" && provider === "gemini") {
    throw new ApiError(
      "validation_failed",
      "Gemini image smoke tests do not support aspectRatio.",
      {
        fields: [
          {
            path: "aspectRatio",
            message: "Gemini image generation does not consume this field.",
          },
        ],
      }
    );
  }
  if (aspectRatio === "1:1" && !(kind === "image" && provider === "ideogram")) {
    throw new ApiError(
      "validation_failed",
      "aspectRatio 1:1 is not supported by this provider smoke test.",
      {
        fields: [
          {
            path: "aspectRatio",
            message: "Use 16:9 or 9:16 for this provider.",
          },
        ],
      }
    );
  }
}

function sizeForAspectRatio(aspectRatio: string | undefined): string | undefined {
  if (aspectRatio === "16:9") return "1280x720";
  if (aspectRatio === "9:16") return "720x1280";
  return undefined;
}

function nvidiaResolutionForAspectRatio(
  aspectRatio: string | undefined
): string | undefined {
  if (aspectRatio === "16:9") return "480_16_9";
  if (aspectRatio === "9:16") return "480_9_16";
  return undefined;
}

export function buildManualProviderAssetBody(
  input: ManualProviderAssetTestInput
): ManualProviderAssetBody {
  const base: ManualProviderAssetBody = {
    kind: input.kind,
    provider: input.provider,
    prompt: input.prompt,
    assetRole: "provider_smoke_test",
    displayName: `Provider smoke test ${input.kind}`,
    slug: `provider-smoke-${input.kind}`,
    ...(input.model ? { model: input.model } : {}),
    ...(input.durationSec ? { durationSec: input.durationSec } : {}),
  };

  if (input.provider === "ideogram") {
    return {
      ...base,
      ...(input.size ? { resolution: input.size } : {}),
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    };
  }

  if (input.provider === "nvidia_api_catalog") {
    const resolution = nvidiaResolutionForAspectRatio(input.aspectRatio);
    return {
      ...base,
      ...(input.size ? { size: input.size } : {}),
      ...(resolution ? { resolution } : {}),
    };
  }

  const size = input.size ?? sizeForAspectRatio(input.aspectRatio);
  return {
    ...base,
    ...(size ? { size } : {}),
  };
}

export function parseManualProviderAssetTestRequest(
  body: unknown
): ManualProviderAssetTestInput {
  if (!isRecord(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.", {
      fields: [{ path: "", message: "Must be an object." }],
    });
  }

  const kind = body.kind;
  if (kind !== "image" && kind !== "video") {
    throw new ApiError("validation_failed", "kind must be image or video.", {
      fields: [{ path: "kind", message: "Must be image or video." }],
    });
  }

  const provider = parseProvider(body.provider);
  if (!PROVIDER_TEST_SUPPORT[kind].includes(provider)) {
    throw new ApiError(
      "validation_failed",
      `Provider "${provider}" does not support ${kind} smoke tests.`,
      {
        fields: [
          {
            path: "provider",
            message: `Must be one of: ${PROVIDER_TEST_SUPPORT[kind].join(", ")}.`,
          },
        ],
      }
    );
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    throw new ApiError("validation_failed", "prompt is required.", {
      fields: [{ path: "prompt", message: "Must be a non-empty string." }],
    });
  }
  const model = optionalString(body.model, "model");
  const size = optionalString(body.size, "size");
  const aspectRatio = optionalString(body.aspectRatio, "aspectRatio");
  validateAspectRatio(provider, kind, aspectRatio);
  const durationSec = optionalPositiveNumber(body.durationSec, "durationSec");

  return {
    kind,
    provider,
    prompt,
    ...(model ? { model } : {}),
    ...(size ? { size } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(durationSec ? { durationSec } : {}),
  };
}

function assetIdsFromJob(job: unknown): string[] {
  if (!isRecord(job) || !isRecord(job.result)) return [];
  const assetIds = job.result.assetIds;
  return Array.isArray(assetIds)
    ? assetIds.filter((item): item is string => typeof item === "string")
    : [];
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

// POST /api/v1/manual-tests/provider-asset
//
// Admin-only smoke-test endpoint that creates a normal persisted project asset
// through the generated-assets pipeline. This is intentionally small and
// operator-facing: it proves saved provider credentials, model wiring, storage,
// actions, jobs, and asset graph writes all work together.
manualTestsRouter.post(
  "/manual-tests/provider-asset",
  mutation(async (ctx) => {
    await requireProviderSmokeTestAdmin(ctx);

    const input = parseManualProviderAssetTestRequest(ctx.body);
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const { project } = await createProject({
      workspaceId: ctx.auth.workspaceId,
      name: `Provider smoke test ${input.kind} ${timestamp}`,
      slug: `provider-smoke-${input.kind}-${timestamp}`,
    });

    const result = await createGeneratedAsset({
      auth: ctx.auth,
      projectId: project.id,
      body: buildManualProviderAssetBody(input),
    });
    const job = result.body.job;

    return {
      status: 201,
      body: {
        project,
        job,
        assetIds: assetIdsFromJob(job),
      },
      headers: { "Cache-Control": "no-store" },
    };
  })
);
