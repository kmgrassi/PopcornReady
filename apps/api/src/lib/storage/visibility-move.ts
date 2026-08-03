import { randomUUID } from "node:crypto";
import { copyS3ObjectWithMetadata } from "./object-store";

export type AssetVisibility = "public" | "private";

export interface ReconcileStorageAsset {
  id: string;
  storageKey?: string | null;
  storageBucket?: string | null;
  sidecars?: ReconcileStorageSidecar[];
  visibility: AssetVisibility;
}

export interface ReconcileStorageSidecar {
  key: string;
  storageBucket?: string | null;
}

export interface VisibilityBucketConfig {
  publicBucket: string;
  privateBucket: string;
}

export interface VisibilityObjectStore {
  copyObject(input: {
    sourceBucket: string;
    targetBucket: string;
    key: string;
    targetVisibility: AssetVisibility;
  }): Promise<void>;
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
  invalidatePublicObject(input: { key: string }): Promise<void>;
}

export interface ReconcileAssetStorageInput {
  asset: ReconcileStorageAsset;
  projectVisibility: AssetVisibility;
  previousEffectiveVisibility?: AssetVisibility;
  buckets?: VisibilityBucketConfig;
  store?: VisibilityObjectStore;
  persistStorageBucket: (
    storageBucket: string | null,
    sidecars: ReconcileStorageSidecar[]
  ) => Promise<void>;
}

export interface ReconcileAssetStorageResult {
  effectiveVisibility: AssetVisibility;
  sourceBucket: string | null;
  targetBucket: string | null;
  moved: boolean;
  invalidated: boolean;
  sidecarsMoved: number;
}

export function effectiveAssetVisibility(input: {
  assetVisibility: AssetVisibility;
  projectVisibility: AssetVisibility;
}): AssetVisibility {
  return input.assetVisibility === "public" && input.projectVisibility === "public"
    ? "public"
    : "private";
}

export function storageBucketForVisibility(
  visibility: AssetVisibility,
  buckets: VisibilityBucketConfig = storageBucketsFromEnv()
): string {
  return visibility === "public" ? buckets.publicBucket : buckets.privateBucket;
}

export async function reconcileAssetStorage(
  input: ReconcileAssetStorageInput
): Promise<ReconcileAssetStorageResult> {
  const buckets = input.buckets ?? storageBucketsFromEnv();
  const store = input.store ?? visibilityObjectStoreFromEnv();
  const storageKey = input.asset.storageKey ?? null;
  const sidecars = input.asset.sidecars ?? [];
  const effectiveVisibility = effectiveAssetVisibility({
    assetVisibility: input.asset.visibility,
    projectVisibility: input.projectVisibility,
  });
  const targetBucket = storageKey
    ? storageBucketForVisibility(effectiveVisibility, buckets)
    : null;
  const sourceBucket =
    input.asset.storageBucket ??
    (storageKey && input.previousEffectiveVisibility
      ? storageBucketForVisibility(input.previousEffectiveVisibility, buckets)
      : null);

  if (!storageKey && sidecars.length === 0) {
    await input.persistStorageBucket(null, []);
    return {
      effectiveVisibility,
      sourceBucket,
      targetBucket,
      moved: false,
      invalidated: false,
      sidecarsMoved: 0,
    };
  }

  if (storageKey && (!sourceBucket || !targetBucket)) {
    throw new Error(
      `Cannot reconcile asset ${input.asset.id}: storage bucket is missing and no previous effective visibility was provided.`
    );
  }

  const targetSidecars = sidecars.map((sidecar) => ({
    key: sidecar.key,
    storageBucket: storageBucketForVisibility(effectiveVisibility, buckets),
  }));
  const sidecarMoves = sidecars
    .map((sidecar, index) => {
      const sidecarSourceBucket =
        sidecar.storageBucket ??
        sourceBucket ??
        (input.previousEffectiveVisibility
          ? storageBucketForVisibility(input.previousEffectiveVisibility, buckets)
          : null);
      const sidecarTargetBucket = targetSidecars[index]?.storageBucket ?? null;
      if (!sidecarSourceBucket || !sidecarTargetBucket) {
        throw new Error(
          `Cannot reconcile asset ${input.asset.id} sidecar ${sidecar.key}: storage bucket is missing and no previous effective visibility was provided.`
        );
      }
      return {
        key: sidecar.key,
        sourceBucket: sidecarSourceBucket,
        targetBucket: sidecarTargetBucket,
      };
    })
    .filter((move) => move.sourceBucket !== move.targetBucket);

  if (sourceBucket === targetBucket) {
    for (const move of sidecarMoves) {
      await store.copyObject({
        sourceBucket: move.sourceBucket,
        targetBucket: move.targetBucket,
        key: move.key,
        targetVisibility: effectiveVisibility,
      });
    }
    await input.persistStorageBucket(targetBucket ?? sourceBucket, targetSidecars);
    const invalidatedSidecars = effectiveVisibility === "private";
    if (invalidatedSidecars) {
      for (const move of sidecarMoves) {
        await store.invalidatePublicObject({ key: move.key });
      }
    }
    for (const move of sidecarMoves) {
      await store.deleteObject({ bucket: move.sourceBucket, key: move.key });
    }
    return {
      effectiveVisibility,
      sourceBucket,
      targetBucket,
      moved: sidecarMoves.length > 0,
      invalidated: invalidatedSidecars && sidecarMoves.length > 0,
      sidecarsMoved: sidecarMoves.length,
    };
  }

  if (storageKey && sourceBucket && targetBucket) {
    await store.copyObject({
      sourceBucket,
      targetBucket,
      key: storageKey,
      targetVisibility: effectiveVisibility,
    });
  }
  for (const move of sidecarMoves) {
    await store.copyObject({
      sourceBucket: move.sourceBucket,
      targetBucket: move.targetBucket,
      key: move.key,
      targetVisibility: effectiveVisibility,
    });
  }
  await input.persistStorageBucket(targetBucket, targetSidecars);

  const invalidated = targetBucket === buckets.privateBucket;
  if (invalidated) {
    if (storageKey) await store.invalidatePublicObject({ key: storageKey });
    for (const move of sidecarMoves) {
      await store.invalidatePublicObject({ key: move.key });
    }
  }

  if (storageKey && sourceBucket) {
    await store.deleteObject({ bucket: sourceBucket, key: storageKey });
  }
  for (const move of sidecarMoves) {
    await store.deleteObject({ bucket: move.sourceBucket, key: move.key });
  }

  return {
    effectiveVisibility,
    sourceBucket,
    targetBucket,
    moved: true,
    invalidated,
    sidecarsMoved: sidecarMoves.length,
  };
}

export function storageBucketsFromEnv(): VisibilityBucketConfig {
  return {
    publicBucket:
      process.env.S3_PUBLIC_BUCKET ||
      process.env.ASSETS_PUBLIC_BUCKET ||
      process.env.PUBLIC_ASSETS_BUCKET ||
      "assets-public",
    privateBucket:
      process.env.S3_PRIVATE_BUCKET ||
      process.env.ASSETS_PRIVATE_BUCKET ||
      process.env.PRIVATE_ASSETS_BUCKET ||
      "assets-private",
  };
}

export function visibilityObjectStoreFromEnv(): VisibilityObjectStore {
  if ((process.env.STORAGE_BACKEND ?? "local") !== "s3") {
    return noopVisibilityObjectStore;
  }
  return new S3VisibilityObjectStore();
}

export const noopVisibilityObjectStore: VisibilityObjectStore = {
  async copyObject() {},
  async deleteObject() {},
  async invalidatePublicObject() {},
};

class S3VisibilityObjectStore implements VisibilityObjectStore {
  private async s3Client() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      endpoint: process.env.AWS_ENDPOINT_URL_S3 || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
  }

  async copyObject(input: {
    sourceBucket: string;
    targetBucket: string;
    key: string;
    targetVisibility: AssetVisibility;
  }): Promise<void> {
    const client = await this.s3Client();
    await copyS3ObjectWithMetadata({
      client,
      sourceBucket: input.sourceBucket,
      sourceKey: input.key,
      destinationBucket: input.targetBucket,
      destinationKey: input.key,
      destinationVisibility: input.targetVisibility,
    });
  }

  async deleteObject(input: { bucket: string; key: string }): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.s3Client();
    await client.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }));
  }

  async invalidatePublicObject(input: { key: string }): Promise<void> {
    const distributionId =
      process.env.CLOUDFRONT_DISTRIBUTION_ID ||
      process.env.CF_DISTRIBUTION_ID ||
      process.env.S3_PUBLIC_CLOUDFRONT_DISTRIBUTION_ID;
    if (!distributionId) return;

    const { CloudFrontClient, CreateInvalidationCommand } = await import(
      "@aws-sdk/client-cloudfront"
    );
    const client = new CloudFrontClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    await client.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: `asset-visibility-${Date.now()}-${randomUUID()}`,
          Paths: {
            Quantity: 1,
            Items: [`/${input.key.replace(/^\/+/, "")}`],
          },
        },
      })
    );
  }
}
