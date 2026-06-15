import assert from "node:assert/strict";
import test from "node:test";
import {
  HostedLocalStorageConfigError,
  readStorageConfig,
  resolveBucket,
  StorageConfigError,
} from "../config";

test("storage config defaults to local disk media storage", () => {
  const config = readStorageConfig({
    POPCORN_READY_LOCAL_DIR: "/tmp/popcorn-local",
  });

  assert.equal(config.backend, "local");
  assert.equal(config.localMediaDir, "/tmp/popcorn-local/media");
  assert.equal(config.localUrlBase, "http://localhost:4000");
  assert.equal(config.publicBucket, "assets-public");
  assert.equal(config.privateBucket, "assets-private");
});

test("local storage uses explicit public local URL base when provided", () => {
  const config = readStorageConfig({
    STORAGE_BACKEND: "local",
    STORAGE_LOCAL_URL_BASE: "https://api.example.com/",
    PORT: "8080",
  });

  assert.equal(config.localUrlBase, "https://api.example.com");
});

test("local storage derives hosted Railway media origin from public domain", () => {
  const config = readStorageConfig({
    STORAGE_BACKEND: "local",
    PORT: "8080",
    RAILWAY_ENVIRONMENT: "production",
    RAILWAY_PUBLIC_DOMAIN: "api.popcornready.example",
  });

  assert.equal(config.localUrlBase, "https://api.popcornready.example");
});

test("hosted local storage does not fall back to localhost", () => {
  assert.throws(
    () =>
      readStorageConfig({
        STORAGE_BACKEND: "local",
        PORT: "8080",
        RAILWAY_ENVIRONMENT: "production",
      }),
    HostedLocalStorageConfigError
  );
});

test("s3 config reads MinIO endpoint and path-style options", () => {
  const config = readStorageConfig({
    STORAGE_BACKEND: "s3",
    AWS_REGION: "us-east-1",
    AWS_ENDPOINT_URL_S3: "http://localhost:9000",
    S3_FORCE_PATH_STYLE: "true",
    AWS_ACCESS_KEY_ID: "minioadmin",
    AWS_SECRET_ACCESS_KEY: "minioadmin",
    S3_PUBLIC_BUCKET: "assets-public-test",
    S3_PRIVATE_BUCKET: "assets-private-test",
    S3_PUBLIC_URL_BASE: "http://localhost:9000/assets-public-test/",
  });

  assert.equal(config.backend, "s3");
  assert.equal(config.s3EndpointUrl, "http://localhost:9000");
  assert.equal(config.forcePathStyle, true);
  assert.equal(config.publicUrlBase, "http://localhost:9000/assets-public-test");
  assert.equal(resolveBucket(config, "public"), "assets-public-test");
  assert.equal(resolveBucket(config, "private"), "assets-private-test");
});

test("s3 config validates required delivery settings", () => {
  assert.throws(
    () => readStorageConfig({ STORAGE_BACKEND: "s3" }),
    (error) =>
      error instanceof StorageConfigError &&
      error.message.includes("S3_PUBLIC_URL_BASE")
  );
});

test("hosted s3 storage does not require a local media URL base", () => {
  const config = readStorageConfig({
    STORAGE_BACKEND: "s3",
    RAILWAY_ENVIRONMENT: "production",
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "aws-key",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    S3_PUBLIC_BUCKET: "assets-public",
    S3_PRIVATE_BUCKET: "assets-private",
    S3_PUBLIC_URL_BASE: "https://cdn.example.com",
  });

  assert.equal(config.backend, "s3");
  assert.equal(config.localUrlBase, "http://localhost:4000");
});
