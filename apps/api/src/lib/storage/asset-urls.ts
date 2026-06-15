import { readStorageConfig, resolveBucket, type StorageConfig } from "./config";
import { getS3Client } from "./s3-client";
import { buildPresignedS3Url } from "./s3-presign";

export interface StoredAssetUrlFields {
  remote_url: string | null;
  storage_key: string | null;
  storage_bucket?: string | null;
  visibility?: "public" | "private" | null;
}

function encodeStorageKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function stablePublicUrl(key: string): string {
  const config = readStorageConfig();
  return `${config.publicUrlBase.replace(/\/+$/, "")}/${encodeStorageKey(key)}`;
}

function localPublicPath(key: string): string {
  const config = readStorageConfig();
  const path = key.startsWith("/") ? key : `/${key.replace(/^media\//, "")}`;
  // Absolute against the API origin: the SPA runs on a different origin, and
  // the API statically serves the local object store (see server.ts).
  return `${config.localUrlBase}${path}`;
}

function privateDeliveryBucket(config: StorageConfig): string {
  return resolveBucket(config, "private");
}

function isPubliclyDeliverable(asset: StoredAssetUrlFields): boolean {
  if (asset.visibility !== "public") return false;
  const config = readStorageConfig();
  return !asset.storage_bucket || asset.storage_bucket === config.publicBucket;
}

function isHostedRuntime(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_PUBLIC_DOMAIN
  );
}

function isUndeliverableHostedRemoteUrl(value: string): boolean {
  if (!isHostedRuntime()) return false;

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

export function remoteAssetUrlForDelivery(value: string | null): string | undefined {
  if (!value || isUndeliverableHostedRemoteUrl(value)) return undefined;
  return value;
}

export async function resolveAssetUrl(
  asset: StoredAssetUrlFields,
  opts: { privateTtlSec?: number } = {}
): Promise<string | undefined> {
  const remoteUrl = remoteAssetUrlForDelivery(asset.remote_url);
  if (remoteUrl) return remoteUrl;
  if (!asset.storage_key) return undefined;

  const config = readStorageConfig();
  if (config.backend === "local") return localPublicPath(asset.storage_key);

  if (isPubliclyDeliverable(asset)) return stablePublicUrl(asset.storage_key);

  return buildPresignedS3Url(
    {
      bucket: privateDeliveryBucket(config),
      key: asset.storage_key,
      expiresInSec: opts.privateTtlSec ?? 300,
    },
    getS3Client(config)
  );
}

export async function resolveAssetUrls<T extends StoredAssetUrlFields>(
  assets: T[],
  opts: { privateTtlSec?: number } = {}
): Promise<Array<T & { resolvedUrl?: string }>> {
  return Promise.all(
    assets.map(async (asset) => {
      const resolvedUrl = await resolveAssetUrl(asset, opts);
      return resolvedUrl ? { ...asset, resolvedUrl } : asset;
    })
  );
}
