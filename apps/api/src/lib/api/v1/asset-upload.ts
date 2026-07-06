import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { contentTypeForFilename } from "@/lib/storage/asset-write";
import {
  readStorageConfig,
  resolveBucket,
  type AssetVisibility,
  type StorageConfig,
} from "@/lib/storage/config";
import { createObjectStore, type ObjectStore } from "@/lib/storage/object-store";
import { buildPresignedS3PutUrl } from "@/lib/storage/s3-presign";
import { getS3Client } from "@/lib/storage/s3-client";
import { ApiError } from "./errors";

const DEFAULT_UPLOAD_URL_TTL_SEC = 15 * 60;

export interface CreateUploadUrlInput {
  filename: string;
  contentType?: string;
  visibility: AssetVisibility;
}

export interface UploadUrlResult {
  path: string;
  signedUrl: string;
  expiresAt: string;
}

export function uploadPrefix(workspaceId: string, projectId: string): string {
  return `${workspaceId}/${projectId}/uploads/`;
}

export function assertProjectUploadPath(input: {
  workspaceId: string;
  projectId: string;
  path: string;
}): void {
  const prefix = uploadPrefix(input.workspaceId, input.projectId);
  const uploadPath = input.path.trim();
  if (
    !uploadPath.startsWith(prefix) ||
    uploadPath.includes("\\") ||
    uploadPath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new ApiError(
      "validation_failed",
      "Upload path must stay inside the project upload prefix."
    );
  }
}

export async function createAssetUploadUrl(input: {
  workspaceId: string;
  projectId: string;
  filename: string;
  visibility: AssetVisibility;
  contentType?: string;
  config?: StorageConfig;
  expiresInSec?: number;
}): Promise<UploadUrlResult> {
  const config = input.config ?? readStorageConfig();
  const expiresInSec = input.expiresInSec ?? DEFAULT_UPLOAD_URL_TTL_SEC;
  const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
  const safeFilename = path.basename(input.filename.trim() || "upload.bin");
  const uploadPath = `${uploadPrefix(input.workspaceId, input.projectId)}${randomUUID()}/${safeFilename}`;
  const contentType = contentTypeForFilename(safeFilename, input.contentType);

  if (config.backend === "local") {
    const token = signLocalUploadToken({
      path: uploadPath,
      visibility: input.visibility,
      contentType,
      expiresAt,
    });
    return {
      path: uploadPath,
      signedUrl: `${config.localUrlBase}/api/v1/projects/${encodeURIComponent(
        input.projectId
      )}/assets/upload-url/local?token=${encodeURIComponent(token)}`,
      expiresAt,
    };
  }

  const bucket = resolveBucket(config, input.visibility);
  return {
    path: uploadPath,
    signedUrl: await buildPresignedS3PutUrl(
      {
        bucket,
        key: uploadPath,
        expiresInSec,
        contentType,
      },
      getS3Client(config)
    ),
    expiresAt,
  };
}

export async function writeLocalSignedUpload(input: {
  token: string;
  body: Buffer;
  store?: ObjectStore;
  config?: StorageConfig;
}): Promise<void> {
  const config = input.config ?? readStorageConfig();
  if (config.backend !== "local") {
    throw new ApiError("not_found", "Local upload endpoint is available only for local storage.");
  }
  const payload = verifyLocalUploadToken(input.token);
  await (input.store ?? createObjectStore(config)).putObject({
    key: payload.path,
    body: input.body,
    visibility: payload.visibility,
    contentType: payload.contentType,
  });
}

interface LocalUploadTokenPayload {
  path: string;
  visibility: AssetVisibility;
  contentType: string;
  expiresAt: string;
}

function signLocalUploadToken(payload: LocalUploadTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = hmac(body);
  return `${body}.${sig}`;
}

function verifyLocalUploadToken(token: string): LocalUploadTokenPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(body))) {
    throw new ApiError("forbidden", "Upload URL signature is invalid.");
  }
  let payload: LocalUploadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ApiError("forbidden", "Upload URL payload is invalid.");
  }
  if (new Date(payload.expiresAt).getTime() <= Date.now()) {
    throw new ApiError("forbidden", "Upload URL has expired.");
  }
  if (payload.visibility !== "public" && payload.visibility !== "private") {
    throw new ApiError("forbidden", "Upload URL payload is invalid.");
  }
  if (!payload.path || !payload.contentType) {
    throw new ApiError("forbidden", "Upload URL payload is invalid.");
  }
  return payload;
}

function hmac(value: string): string {
  return createHmac("sha256", localUploadSecret()).update(value).digest("base64url");
}

function localUploadSecret(): string {
  return (
    process.env.UPLOAD_URL_SIGNING_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "popcornready-local-upload-url-dev-secret"
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
