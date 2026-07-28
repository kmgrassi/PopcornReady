import { promises as fs } from "node:fs";
import path from "node:path";
import { localDir } from "@/lib/api/v1/store";
import {
  readStorageConfig,
  type AssetVisibility,
  type StorageConfig,
} from "./config";
import { createObjectStore, type ObjectStore } from "./object-store";

const CONTENT_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

export function contentTypeForFilename(
  filename: string,
  explicit?: string
): string {
  if (explicit) return explicit;
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

export function assetStorageKey(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  filename: string;
}): string {
  return [
    input.workspaceId,
    input.projectId,
    input.assetId,
    path.basename(input.filename),
  ].join("/");
}

export async function writeAssetObject(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  filename: string;
  bytes: Buffer;
  visibility: AssetVisibility;
  contentType?: string;
  store?: ObjectStore;
  config?: StorageConfig;
}): Promise<{ storageKey: string; storageBucket: string; contentType: string }> {
  const config = input.config ?? readStorageConfig();
  const store = input.store ?? createObjectStore(config);
  const storageKey = assetStorageKey(input);
  const contentType = contentTypeForFilename(input.filename, input.contentType);
  const stored = await store.putObject({
    key: storageKey,
    body: input.bytes,
    visibility: input.visibility,
    contentType,
  });
  if (shouldWriteCompatibilityCache(config)) {
    await writeCompatibilityCache(storageKey, input.bytes);
  }
  return { storageKey, storageBucket: stored.bucket, contentType };
}

export async function deleteAssetObject(input: {
  storageKey: string;
  visibility: AssetVisibility;
  store?: ObjectStore;
  config?: StorageConfig;
}): Promise<void> {
  const config = input.config ?? readStorageConfig();
  const store = input.store ?? createObjectStore(config);
  await store.deleteObject(input.storageKey, input.visibility);
  if (shouldWriteCompatibilityCache(config)) {
    await fs
      .unlink(path.join(localDir(), input.storageKey))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
}

function shouldWriteCompatibilityCache(config: StorageConfig): boolean {
  if (config.backend === "local") return true;
  return !isHostedRuntime();
}

function isHostedRuntime(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_PUBLIC_DOMAIN
  );
}

async function writeCompatibilityCache(key: string, bytes: Buffer): Promise<void> {
  const target = path.join(localDir(), key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
}
