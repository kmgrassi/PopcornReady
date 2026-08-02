import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
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

function deliveryBucket(
  asset: StoredAssetUrlFields,
  config: StorageConfig
): string | null {
  if (!asset.storage_key || !asset.storage_bucket) return null;
  return isPubliclyDeliverable(asset, config)
    ? config.publicBucket
    : privateDeliveryBucket(config);
}

function isPubliclyDeliverable(
  asset: StoredAssetUrlFields,
  config: StorageConfig = readStorageConfig()
): boolean {
  if (asset.visibility !== "public") return false;
  return (
    !asset.storage_bucket ||
    asset.storage_bucket === config.publicBucket ||
    asset.storage_bucket === "assets-public"
  );
}

export function assetUrlRequiresSigning(asset: StoredAssetUrlFields): boolean {
  const config = readStorageConfig();
  return Boolean(
    config.backend === "s3" &&
      asset.storage_key &&
      asset.storage_bucket &&
      !isPubliclyDeliverable(asset, config)
  );
}

export async function managedAssetObjectExists(
  asset: StoredAssetUrlFields,
  deps: { config?: StorageConfig; client?: S3Client } = {}
): Promise<boolean> {
  const config = deps.config ?? readStorageConfig();
  if (config.backend === "s3" && asset.storage_key && !asset.storage_bucket) {
    return false;
  }
  const bucket = deliveryBucket(asset, config);
  if (config.backend !== "s3" || !asset.storage_key || !bucket) {
    return true;
  }

  try {
    await (deps.client ?? getS3Client(config)).send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: asset.storage_key,
      })
    );
    return true;
  } catch (error) {
    if (isMissingObjectError(error)) return false;
    throw error;
  }
}

function isMissingObjectError(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.Code === "NoSuchKey"
  );
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
  const config = readStorageConfig();
  const hasManagedStorage = Boolean(asset.storage_key && asset.storage_bucket);
  if (asset.storage_key && hasManagedStorage) {
    if (config.backend === "local") return localPublicPath(asset.storage_key);

    if (isPubliclyDeliverable(asset, config)) {
      return stablePublicUrl(asset.storage_key);
    }

    return buildPresignedS3Url(
      {
        bucket: privateDeliveryBucket(config),
        key: asset.storage_key,
        expiresInSec: opts.privateTtlSec ?? 300,
      },
      getS3Client(config)
    );
  }

  const remoteUrl = remoteAssetUrlForDelivery(asset.remote_url);
  if (remoteUrl) return remoteUrl;

  if (asset.storage_key && config.backend === "local") {
    return localPublicPath(asset.storage_key);
  }

  return undefined;
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
