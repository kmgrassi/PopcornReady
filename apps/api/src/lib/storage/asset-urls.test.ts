import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveAssetUrl } from "./asset-urls";

const ENV_KEYS = [
  "STORAGE_BACKEND",
  "STORAGE_LOCAL_URL_BASE",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_PUBLIC_BUCKET",
  "S3_PRIVATE_BUCKET",
  "S3_PUBLIC_URL_BASE",
  "AWS_ENDPOINT_URL_S3",
  "S3_FORCE_PATH_STYLE",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_PUBLIC_DOMAIN",
] as const;

let previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

beforeEach(() => {
  previousEnv = {};
  for (const key of ENV_KEYS) previousEnv[key] = process.env[key];

  process.env.STORAGE_BACKEND = "s3";
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  process.env.S3_PUBLIC_BUCKET = "assets-public";
  process.env.S3_PRIVATE_BUCKET = "assets-private";
  process.env.S3_PUBLIC_URL_BASE = "https://cdn.example.com/assets/";
  process.env.AWS_ENDPOINT_URL_S3 = "http://localhost:9000";
  process.env.S3_FORCE_PATH_STYLE = "true";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("resolveAssetUrl passes through remote_url assets", async () => {
  const url = await resolveAssetUrl({
    remote_url: "https://media.example.com/source.mp4",
    storage_key: null,
    storage_bucket: null,
    visibility: "private",
  });

  assert.equal(url, "https://media.example.com/source.mp4");
});

test("resolveAssetUrl ignores remote_url once managed storage exists", async () => {
  const url = await resolveAssetUrl({
    remote_url: "https://popcornready-production.up.railway.app/ws/proj/asset/source.mp4",
    storage_key: "ws/proj/asset/source.mp4",
    storage_bucket: "assets-private",
    visibility: "private",
  });

  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/assets-private/ws/proj/asset/source.mp4");
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "300");
});

test("resolveAssetUrl does not expose hosted localhost remote_url assets", async () => {
  process.env.RAILWAY_ENVIRONMENT = "production";

  const url = await resolveAssetUrl({
    remote_url: "http://localhost:8080/ws/proj/asset/clip.mp4",
    storage_key: "ws/proj/asset/clip.mp4",
    storage_bucket: "assets-public",
    visibility: "public",
  });

  assert.equal(url, "https://cdn.example.com/assets/ws/proj/asset/clip.mp4");
});

test("resolveAssetUrl suppresses hosted .local remote_url placeholders", async () => {
  process.env.RAILWAY_ENVIRONMENT = "production";

  const url = await resolveAssetUrl({
    remote_url: "https://popcornready.local/character-anchors/Newcomer",
    storage_key: null,
    storage_bucket: null,
    visibility: "public",
  });

  assert.equal(url, undefined);
});

test("resolveAssetUrl returns stable unsigned public CDN URLs", async () => {
  const url = await resolveAssetUrl({
    remote_url: null,
    storage_key: "ws 1/proj/asset/clip 01.mp4",
    storage_bucket: "assets-public",
    visibility: "public",
  });

  assert.equal(
    url,
    "https://cdn.example.com/assets/ws%201/proj/asset/clip%2001.mp4"
  );
});

test("resolveAssetUrl returns short-lived signed private URLs", async () => {
  const url = await resolveAssetUrl({
    remote_url: null,
    storage_key: "ws/proj/asset/private.mp4",
    storage_bucket: "assets-private",
    visibility: "private",
  });

  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, "http://localhost:9000");
  assert.equal(parsed.pathname, "/assets-private/ws/proj/asset/private.mp4");
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "300");
  assert.ok(parsed.searchParams.get("X-Amz-Signature"));
});

test("resolveAssetUrl does not expose stale public buckets after privatize", async () => {
  const url = await resolveAssetUrl({
    remote_url: null,
    storage_key: "ws/proj/asset/privatized.mp4",
    storage_bucket: "assets-public",
    visibility: "private",
  });

  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/assets-private/ws/proj/asset/privatized.mp4");
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "300");
});

test("resolveAssetUrl keeps private-bucket assets signed even if the flag is public", async () => {
  const url = await resolveAssetUrl({
    remote_url: null,
    storage_key: "ws/proj/asset/not-yet-moved.mp4",
    storage_bucket: "assets-private",
    visibility: "public",
  });

  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/assets-private/ws/proj/asset/not-yet-moved.mp4");
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "300");
});

test("resolveAssetUrl returns absolute local URLs for local backend storage keys", async () => {
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_URL_BASE = "http://localhost:4200";

  const url = await resolveAssetUrl({
    remote_url: null,
    storage_key: "media/uploads/ws/proj/asset.mp4",
    storage_bucket: null,
    visibility: "private",
  });

  assert.equal(url, "http://localhost:4200/uploads/ws/proj/asset.mp4");
});
