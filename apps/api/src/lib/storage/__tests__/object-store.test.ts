import assert from "node:assert/strict";
import test from "node:test";
import { CopyObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readStorageConfig } from "../config";
import { createS3ObjectStore } from "../object-store";

function testConfig() {
  return readStorageConfig({
    STORAGE_BACKEND: "s3",
    AWS_REGION: "us-east-1",
    AWS_ENDPOINT_URL_S3: "http://localhost:9000",
    S3_FORCE_PATH_STYLE: "true",
    AWS_ACCESS_KEY_ID: "minioadmin",
    AWS_SECRET_ACCESS_KEY: "minioadmin",
    S3_PUBLIC_BUCKET: "assets-public",
    S3_PRIVATE_BUCKET: "assets-private",
    S3_PUBLIC_URL_BASE: "https://cdn.example.com/assets/",
  });
}

test("s3 objectUrl uses the stable public URL base", () => {
  const config = testConfig();

  const store = createS3ObjectStore(config, {
    client: { send: async () => ({}) } as never,
  });

  assert.equal(
    store.objectUrl("/ws/proj/asset/file.png", "public"),
    "https://cdn.example.com/assets/ws/proj/asset/file.png"
  );
});

test("putObject sets visibility-aware immutable cache metadata", async () => {
  const commands: unknown[] = [];
  const store = createS3ObjectStore(testConfig(), {
    client: {
      send: async (command: unknown) => {
        commands.push(command);
        return {};
      },
    } as never,
  });

  await store.putObject({
    key: "ws/proj/public.png",
    body: "public",
    visibility: "public",
    contentType: "image/png",
  });
  await store.putObject({
    key: "ws/proj/private.png",
    body: "private",
    visibility: "private",
    contentType: "image/png",
  });

  assert.equal((commands[0] as PutObjectCommand).input.CacheControl, "public, max-age=31536000, immutable");
  assert.equal((commands[1] as PutObjectCommand).input.CacheControl, "private, max-age=31536000, immutable");
});

test("copyObject preserves content metadata and rewrites cache scope for the destination", async () => {
  const commands: unknown[] = [];
  const store = createS3ObjectStore(testConfig(), {
    client: {
      send: async (command: unknown) => {
        commands.push(command);
        if (command instanceof HeadObjectCommand) {
          return {
            ContentType: "image/png",
            ContentDisposition: "inline",
            ContentLanguage: "en",
            Metadata: { source: "test" },
          };
        }
        return {};
      },
    } as never,
  });

  await store.copyObject({
    sourceKey: "ws/proj/asset.png",
    sourceVisibility: "public",
    destinationKey: "ws/proj/asset.png",
    destinationVisibility: "private",
  });

  assert.ok(commands[0] instanceof HeadObjectCommand);
  assert.ok(commands[1] instanceof CopyObjectCommand);
  const copy = (commands[1] as CopyObjectCommand).input;
  assert.equal(copy.ContentType, "image/png");
  assert.equal(copy.ContentDisposition, "inline");
  assert.equal(copy.ContentLanguage, "en");
  assert.deepEqual(copy.Metadata, { source: "test" });
  assert.equal(copy.MetadataDirective, "REPLACE");
  assert.equal(copy.CacheControl, "private, max-age=31536000, immutable");

  commands.length = 0;
  await store.copyObject({
    sourceKey: "ws/proj/asset.png",
    sourceVisibility: "private",
    destinationKey: "ws/proj/asset.png",
    destinationVisibility: "public",
  });
  const publicCopy = (commands[1] as CopyObjectCommand).input;
  assert.equal(publicCopy.CacheControl, "public, max-age=31536000, immutable");
  assert.equal(publicCopy.ContentType, "image/png");
  assert.equal(publicCopy.ContentDisposition, "inline");
  assert.deepEqual(publicCopy.Metadata, { source: "test" });
});

test("signedObjectUrl prefers CloudFront signing when configured", async () => {
  const config = readStorageConfig({
    STORAGE_BACKEND: "s3",
    AWS_REGION: "us-east-1",
    AWS_ENDPOINT_URL_S3: "http://localhost:9000",
    AWS_ACCESS_KEY_ID: "minioadmin",
    AWS_SECRET_ACCESS_KEY: "minioadmin",
    S3_PUBLIC_BUCKET: "assets-public",
    S3_PRIVATE_BUCKET: "assets-private",
    S3_PUBLIC_URL_BASE: "https://cdn.example.com",
    CF_SIGN_KEY_PAIR_ID: "KTEST",
    CF_SIGN_PRIVATE_KEY: "configured",
  });
  const store = createS3ObjectStore(config, {
    client: { send: async () => ({}) } as never,
    signCloudFrontUrl: (url, expiresInSec) =>
      `${url}?Expires=${expiresInSec}&Key-Pair-Id=KTEST`,
    buildPresignedS3Url: async () => "https://s3.example.com/fallback",
  });

  const url = await store.signedObjectUrl("ws/proj/asset/file.mp4", "private", 60);

  assert.match(url, /^https:\/\/cdn\.example\.com\/ws\/proj\/asset\/file\.mp4\?/);
  assert.match(url, /Key-Pair-Id=KTEST/);
});

test("signedObjectUrl falls back from CloudFront to S3 presign", async () => {
  const config = readStorageConfig({
    STORAGE_BACKEND: "s3",
    AWS_REGION: "us-east-1",
    AWS_ENDPOINT_URL_S3: "http://localhost:9000",
    AWS_ACCESS_KEY_ID: "minioadmin",
    AWS_SECRET_ACCESS_KEY: "minioadmin",
    S3_PUBLIC_BUCKET: "assets-public",
    S3_PRIVATE_BUCKET: "assets-private",
    S3_PUBLIC_URL_BASE: "https://cdn.example.com",
    CF_SIGN_KEY_PAIR_ID: "KTEST",
    CF_SIGN_PRIVATE_KEY: "configured",
  });
  const store = createS3ObjectStore(config, {
    client: { send: async () => ({}) } as never,
    signCloudFrontUrl: () => {
      throw new Error("bad key");
    },
    buildPresignedS3Url: async (input) =>
      `https://s3.example.com/${input.bucket}/${input.key}?X-Amz-Expires=${input.expiresInSec}`,
  });

  assert.equal(
    await store.signedObjectUrl("ws/proj/asset/file.mp4", "private", 120),
    "https://s3.example.com/assets-private/ws/proj/asset/file.mp4?X-Amz-Expires=120"
  );
});

test("signedObjectUrl falls back to unsigned public URL if signing is unavailable", async () => {
  const config = readStorageConfig({
    STORAGE_BACKEND: "s3",
    AWS_REGION: "us-east-1",
    AWS_ENDPOINT_URL_S3: "http://localhost:9000",
    AWS_ACCESS_KEY_ID: "minioadmin",
    AWS_SECRET_ACCESS_KEY: "minioadmin",
    S3_PUBLIC_BUCKET: "assets-public",
    S3_PRIVATE_BUCKET: "assets-private",
    S3_PUBLIC_URL_BASE: "https://cdn.example.com",
  });
  const store = createS3ObjectStore(config, {
    client: { send: async () => ({}) } as never,
    buildPresignedS3Url: async () => {
      throw new Error("no credentials");
    },
  });

  assert.equal(
    await store.signedObjectUrl("ws/proj/asset/file.mp4", "private", 120),
    "https://cdn.example.com/ws/proj/asset/file.mp4"
  );
});
