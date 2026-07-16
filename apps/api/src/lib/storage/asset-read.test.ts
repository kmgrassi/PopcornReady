import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { materializeAssetObject } from "./asset-read";
import type { StorageConfig } from "./config";
import type { ObjectStore } from "./object-store";

const config: StorageConfig = {
  backend: "s3",
  localMediaDir: "/unused",
  localUrlBase: "https://api.example.com",
  region: "us-east-1",
  publicBucket: "assets-public",
  privateBucket: "assets-private",
  publicUrlBase: "https://cdn.example.com",
  forcePathStyle: false,
};

test("materializeAssetObject reads the persisted private bucket and preserves extension", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "asset-read-test-"));
  const reads: Array<{ key: string; visibility: string }> = [];
  const store = mockObjectStore(async (key, visibility) => {
    reads.push({ key, visibility });
    return { body: Buffer.from("private-image") };
  });

  try {
    const result = await materializeAssetObject({
      storageKey: "workspace/project/tile/storyboard.png",
      storageBucket: "assets-private",
      config,
      store,
      tempRoot,
    });

    assert.deepEqual(reads, [
      { key: "workspace/project/tile/storyboard.png", visibility: "private" },
    ]);
    assert.equal(path.extname(result.path), ".png");
    assert.equal(await fs.readFile(result.path, "utf8"), "private-image");
    await result.cleanup();
    await assert.rejects(fs.readFile(result.path));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("materializeAssetObject selects the public bucket without consulting DB_BACKEND", async () => {
  const previousDbBackend = process.env.DB_BACKEND;
  process.env.DB_BACKEND = "supabase";
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "asset-read-test-"));
  const reads: Array<{ key: string; visibility: string }> = [];
  const store = mockObjectStore(async (key, visibility) => {
    reads.push({ key, visibility });
    return { body: Buffer.from("public-image") };
  });

  try {
    const result = await materializeAssetObject({
      storageKey: "workspace/project/anchor/hero.webp",
      storageBucket: "assets-public",
      config,
      store,
      tempRoot,
    });
    assert.deepEqual(reads, [
      { key: "workspace/project/anchor/hero.webp", visibility: "public" },
    ]);
    await result.cleanup();
  } finally {
    if (previousDbBackend === undefined) delete process.env.DB_BACKEND;
    else process.env.DB_BACKEND = previousDbBackend;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("materializeAssetObject rejects an unknown persisted bucket without probing", async () => {
  let reads = 0;
  const store = mockObjectStore(async () => {
    reads += 1;
    return { body: Buffer.alloc(0) };
  });

  await assert.rejects(
    materializeAssetObject({
      storageKey: "workspace/project/asset/image.png",
      storageBucket: "legacy-assets",
      config,
      store,
    }),
    /Unknown asset storage bucket: legacy-assets/
  );
  assert.equal(reads, 0);
});

test("materializeAssetObject distinguishes a missing object from infrastructure failure", async () => {
  const missingStore = mockObjectStore(async () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  });
  await assert.rejects(
    materializeAssetObject({
      storageKey: "workspace/project/missing.png",
      storageBucket: "assets-private",
      config,
      store: missingStore,
    }),
    { name: "AssetObjectNotFoundError" }
  );

  const unavailableStore = mockObjectStore(async () => {
    throw new Error("connection timed out");
  });
  await assert.rejects(
    materializeAssetObject({
      storageKey: "workspace/project/unavailable.png",
      storageBucket: "assets-private",
      config,
      store: unavailableStore,
    }),
    /connection timed out/
  );
});

function mockObjectStore(getObject: ObjectStore["getObject"]): ObjectStore {
  return {
    async putObject(input) {
      return { bucket: config.publicBucket, key: input.key };
    },
    getObject,
    async getObjectMetadata() {
      return {};
    },
    async copyObject(input) {
      return { bucket: config.publicBucket, key: input.destinationKey };
    },
    async deleteObject() {},
    objectUrl(key) {
      return key;
    },
    async signedObjectUrl(key) {
      return key;
    },
    async ensureBucket() {},
  };
}
