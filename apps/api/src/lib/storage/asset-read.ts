import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readStorageConfig,
  visibilityForBucket,
  type StorageConfig,
} from "./config";
import { createObjectStore, type ObjectStore } from "./object-store";

export interface MaterializedAssetObject {
  path: string;
  cleanup(): Promise<void>;
}

export class AssetObjectNotFoundError extends Error {
  constructor(
    readonly storageKey: string,
    readonly storageBucket: string,
    options?: { cause?: unknown }
  ) {
    super(`Asset object was not found in ${storageBucket}: ${storageKey}`, options);
    this.name = "AssetObjectNotFoundError";
  }
}

export async function materializeAssetObject(input: {
  storageKey: string;
  storageBucket: string;
  config?: StorageConfig;
  store?: ObjectStore;
  tempRoot?: string;
}): Promise<MaterializedAssetObject> {
  const config = input.config ?? readStorageConfig();
  const store = input.store ?? createObjectStore(config);
  const visibility = visibilityForBucket(config, input.storageBucket);
  let object;
  try {
    object = await store.getObject(input.storageKey, visibility);
  } catch (error) {
    if (isObjectNotFound(error)) {
      throw new AssetObjectNotFoundError(input.storageKey, input.storageBucket, {
        cause: error,
      });
    }
    throw error;
  }
  const outputDir = path.join(
    input.tempRoot ?? os.tmpdir(),
    "popcornready-asset-references",
    randomUUID()
  );
  const outputPath = path.join(outputDir, `asset${path.extname(input.storageKey)}`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, object.body);
  return {
    path: outputPath,
    cleanup: () => fs.rm(outputDir, { recursive: true, force: true }),
  };
}

function isObjectNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: unknown;
    name?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    value.code === "ENOENT" ||
    value.name === "NoSuchKey" ||
    value.name === "NotFound"
  );
}
