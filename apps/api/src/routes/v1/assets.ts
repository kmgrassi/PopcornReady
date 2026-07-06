import express, { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import {
  createStorageUploadUrl,
  inventoryAssets,
  registerAsset,
  updateAssetContext,
} from "@/lib/api/v1/assets";
import { writeLocalSignedUpload } from "@/lib/api/v1/asset-upload";
import {
  parseAssetInventory,
  parseAssetSemanticSearch,
  parsePagination,
  parseRegisterAsset,
  parseSetAssetVisibility,
  parseUpdateAssetContext,
} from "@/lib/api/v1/schemas";
import {
  getAsset,
  getAssetMediaUrls,
  listAssets,
  searchProjectAssetsSemantic,
  setAssetVisibility,
} from "@/lib/api/v1/store";
import { regenerateImageAsset } from "@/lib/api/v1/regenerate-asset";
import {
  readLatestTranscript,
  transcribeAsset,
} from "@/lib/api/v1/transcription";
import type { TranscriptionProvider } from "@/lib/generative/transcription";

export const assetsRouter = Router();

function requiredParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (!value) {
    throw new ApiError("validation_failed", `${name} is required.`);
  }
  return value;
}

function parseTranscribeBody(body: unknown): {
  provider?: TranscriptionProvider;
  language?: string;
} {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const raw = body as Record<string, unknown>;
  const provider = raw.provider;
  if (provider !== undefined && provider !== "openai" && provider !== "mock") {
    throw new ApiError("validation_failed", "provider must be openai or mock.");
  }
  const language = raw.language;
  if (language !== undefined && typeof language !== "string") {
    throw new ApiError("validation_failed", "language must be a string.");
  }
  return {
    ...(provider ? { provider } : {}),
    ...(typeof language === "string" && language.trim()
      ? { language: language.trim() }
      : {}),
  };
}

assetsRouter.get(
  "/assets/:assetId/media",
  route(async ({ auth }, params) => {
    const assetId = requiredParam(params, "assetId");
    const media = await getAssetMediaUrls(auth.workspaceId, assetId);
    return {
      status: 200,
      body: media,
      headers: { "Cache-Control": "no-store" },
    };
  })
);

assetsRouter.post(
  "/assets/:assetId/regenerate",
  mutation(async ({ auth, body, requestId }, params) => {
    const assetId = requiredParam(params, "assetId");
    const rawBody = body as {
      prompt?: unknown;
      provider?: unknown;
      model?: unknown;
    } | null;
    const rawPrompt = rawBody?.prompt;
    const prompt = typeof rawPrompt === "string" ? rawPrompt : undefined;
    const provider = typeof rawBody?.provider === "string" ? rawBody.provider : undefined;
    const model = typeof rawBody?.model === "string" ? rawBody.model : undefined;
    const media = await regenerateImageAsset({
      workspaceId: auth.workspaceId,
      assetId,
      prompt,
      provider,
      model,
      requestId,
    });
    return {
      status: 200,
      body: media,
      headers: { "Cache-Control": "no-store" },
    };
  })
);

assetsRouter.get(
  "/projects/:projectId/assets",
  route(async ({ auth, req }, params) => {
    const projectId = requiredParam(params, "projectId");
    const { limit, cursor } = parsePagination(req.searchParams);
    const { items, nextCursor } = await listAssets(
      auth.workspaceId,
      projectId,
      limit,
      cursor
    );
    return {
      status: 200,
      body: { assets: items, pagination: { limit, nextCursor } },
    };
  })
);

assetsRouter.post(
  "/projects/:projectId/assets/search",
  mutation(async ({ auth, body }, params) => {
    const projectId = requiredParam(params, "projectId");
    const input = parseAssetSemanticSearch(body);
    const result = await searchProjectAssetsSemantic(auth.workspaceId, projectId, input);
    return { status: 200, body: result };
  })
);

assetsRouter.post(
  "/projects/:projectId/assets/upload-url",
  mutation(async ({ auth, body }, params) => {
    const projectId = requiredParam(params, "projectId");
    const input = parseUploadUrlRequest(body);
    const upload = await createStorageUploadUrl(auth, projectId, input);
    return { status: 201, body: upload };
  })
);

assetsRouter.put(
  "/projects/:projectId/assets/upload-url/local",
  express.raw({ type: "*/*", limit: process.env.MAX_STORAGE_UPLOAD_BYTES || "250mb" }),
  async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) throw new ApiError("validation_failed", "token is required.");
      await writeLocalSignedUpload({
        token,
        body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

assetsRouter.post(
  "/projects/:projectId/assets/:assetId/transcribe",
  mutation(async ({ auth, body, req }, params) => {
    const projectId = requiredParam(params, "projectId");
    const assetId = requiredParam(params, "assetId");
    const input = parseTranscribeBody(body);
    const job = await transcribeAsset({
      workspaceId: auth.workspaceId,
      projectId,
      assetId,
      provider: input.provider,
      language: input.language,
      idempotencyKey: req.header("Idempotency-Key"),
    });
    return {
      status: 202,
      body: { job },
      headers: { "Cache-Control": "no-store" },
    };
  })
);

assetsRouter.get(
  "/projects/:projectId/assets/:assetId/transcript",
  route(async ({ auth }, params) => {
    const projectId = requiredParam(params, "projectId");
    const assetId = requiredParam(params, "assetId");
    const transcript = await readLatestTranscript({
      workspaceId: auth.workspaceId,
      projectId,
      assetId,
    });
    return {
      status: 200,
      body: { transcript },
      headers: { "Cache-Control": "no-store" },
    };
  })
);

assetsRouter.post(
  "/projects/:projectId/assets",
  mutation(async ({ auth, body }, params) => {
    const projectId = requiredParam(params, "projectId");
    const input = parseRegisterAsset(body);
    const asset = await registerAsset(auth, projectId, input);
    return { status: 201, body: { asset } };
  })
);

assetsRouter.post(
  "/projects/:projectId/assets/inventory",
  mutation(async ({ auth, body }, params) => {
    const projectId = requiredParam(params, "projectId");
    const input = parseAssetInventory(body);
    const report = await inventoryAssets(auth, projectId, input);
    return { status: 200, body: { report } };
  })
);

assetsRouter.get(
  "/projects/:projectId/assets/:assetId",
  route(async ({ auth }, params) => {
    const projectId = requiredParam(params, "projectId");
    const assetId = requiredParam(params, "assetId");
    const asset = await getAsset(auth.workspaceId, projectId, assetId);
    return { status: 200, body: { asset } };
  })
);

assetsRouter.patch(
  "/projects/:projectId/assets/:assetId/context",
  mutation(async ({ auth, body }, params) => {
    const projectId = requiredParam(params, "projectId");
    const assetId = requiredParam(params, "assetId");
    const input = parseUpdateAssetContext(body);
    const asset = await updateAssetContext(auth, projectId, assetId, input);
    return { status: 200, body: { asset } };
  })
);

function parseUploadUrlRequest(body: unknown): { filename?: string; contentType?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", "The request body is invalid.");
  }
  const record = body as Record<string, unknown>;
  const filename = optionalBodyString(record.filename, "filename");
  const contentType = optionalBodyString(record.contentType, "contentType");
  return {
    ...(filename ? { filename } : {}),
    ...(contentType ? { contentType } : {}),
  };
}

function optionalBodyString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ApiError("validation_failed", `${field} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

assetsRouter.patch(
  "/projects/:projectId/assets/:assetId/visibility",
  mutation(async ({ auth, body }, params) => {
    const projectId = requiredParam(params, "projectId");
    const assetId = requiredParam(params, "assetId");
    const { visibility } = parseSetAssetVisibility(body);
    const asset = await setAssetVisibility(
      auth.workspaceId,
      projectId,
      assetId,
      visibility,
      { actorId: auth.actor.id }
    );
    return { status: 200, body: { asset } };
  })
);
