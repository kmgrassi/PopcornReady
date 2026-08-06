import express, { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import {
  createStorageUploadUrl,
  inventoryAssets,
  registerAsset,
  updateAssetContext,
} from "@/lib/api/v1/assets";
import { SIGNED_MEDIA_JSON_HEADERS } from "@/lib/api/v1/cache-policy";
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
  getServiceSupabaseForStore,
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
import { getAssetCreditsCharged } from "@/lib/api/v1/asset-credit-usage";
import { createAssetCritique } from "@/lib/api/v1/asset-critique";
import { getRequestSupabase } from "@/lib/supabase/clients";

export const assetsRouter = Router();

type ObjectBody = Record<string, unknown>;

interface AssetRegenerateRequestBody {
  prompt?: string;
  provider?: string;
  model?: string;
}

function requiredParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (!value) {
    throw new ApiError("validation_failed", `${name} is required.`);
  }
  return value;
}

function readBodyObject(body: unknown, message = "Request body must be an object."): ObjectBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", message);
  }
  return body as ObjectBody;
}

function optionalBodyString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ApiError("validation_failed", `${field} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseTranscribeBody(body: unknown): {
  provider?: TranscriptionProvider;
  language?: string;
} {
  if (body === undefined || body === null) return {};
  const raw = readBodyObject(body);
  const provider = raw.provider;
  if (provider !== undefined && provider !== "openai" && provider !== "mock") {
    throw new ApiError("validation_failed", "provider must be openai or mock.");
  }
  const language = optionalBodyString(raw.language, "language");
  return {
    ...(provider ? { provider } : {}),
    ...(language ? { language } : {}),
  };
}

function parseRegenerateBody(body: unknown): AssetRegenerateRequestBody {
  if (body === undefined || body === null) return {};
  const raw = readBodyObject(body);
  const prompt = optionalBodyString(raw.prompt, "prompt");
  const provider = optionalBodyString(raw.provider, "provider");
  const model = optionalBodyString(raw.model, "model");
  return {
    ...(prompt ? { prompt } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
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
  "/projects/:projectId/assets/:assetId/critique",
  mutation(async ({ auth, body, req }, params) => {
    const projectId = requiredParam(params, "projectId");
    const assetId = requiredParam(params, "assetId");
    const rawIdempotencyKey = req.header("Idempotency-Key");
    const idempotencyKey = rawIdempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey !== rawIdempotencyKey) {
      throw new ApiError("validation_failed", "Idempotency-Key is required.");
    }
    if (idempotencyKey.length > 200) {
      throw new ApiError("validation_failed", "Idempotency-Key must be 200 characters or fewer.");
    }
    const raw = body === undefined || body === null ? {} : readBodyObject(body);
    const critique = await createAssetCritique({
      db: auth.isLocal ? getServiceSupabaseForStore() : getRequestSupabase(),
      workspaceId: auth.workspaceId,
      projectId,
      assetId,
      idempotencyKey,
      question: raw.question,
    });
    return { status: 201, body: { critique } };
  })
);

assetsRouter.post(
  "/assets/:assetId/regenerate",
  mutation(async ({ auth, body, requestId }, params) => {
    const assetId = requiredParam(params, "assetId");
    const { prompt, provider, model } = parseRegenerateBody(body);
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
      headers: SIGNED_MEDIA_JSON_HEADERS,
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
    const creditsCharged = auth.isLocal
      ? null
      : await getAssetCreditsCharged(asset.projectId, asset.id);
    return { status: 200, body: { asset, billing: { creditsCharged } } };
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
  const record = readBodyObject(body, "The request body is invalid.");
  const filename = optionalBodyString(record.filename, "filename");
  const contentType = optionalBodyString(record.contentType, "contentType");
  return {
    ...(filename ? { filename } : {}),
    ...(contentType ? { contentType } : {}),
  };
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
