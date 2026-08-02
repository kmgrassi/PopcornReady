#!/usr/bin/env tsx

type JsonRecord = Record<string, unknown>;
type Visibility = "public" | "private";

interface SmokeConfig {
  apiBaseUrl: string;
  authToken?: string;
  sourceMode: "multipart" | "local_path" | "signed_upload";
  localPath?: string;
  filename: string;
  contentType: string;
  publicFetchStatus: number;
  privateFetchStatus: number;
}

interface SmokeContext {
  config: SmokeConfig;
  projectId?: string;
  assetId?: string;
  publicUrl?: string;
}

const sampleBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readConfig(): SmokeConfig {
  const sourceMode = env("STORAGE_SMOKE_SOURCE_MODE") ?? "multipart";
  if (
    sourceMode !== "multipart" &&
    sourceMode !== "local_path" &&
    sourceMode !== "signed_upload"
  ) {
    throw new Error(
      'STORAGE_SMOKE_SOURCE_MODE must be "multipart", "local_path", or "signed_upload".'
    );
  }

  return {
    apiBaseUrl: (env("STORAGE_SMOKE_API_BASE_URL") ?? "http://localhost:4000/api/v1").replace(
      /\/$/,
      ""
    ),
    authToken: env("STORAGE_SMOKE_AUTH_TOKEN"),
    sourceMode,
    localPath: env("STORAGE_SMOKE_LOCAL_PATH"),
    filename: env("STORAGE_SMOKE_FILENAME") ?? "popcorn-storage-smoke.png",
    contentType: env("STORAGE_SMOKE_CONTENT_TYPE") ?? "image/png",
    publicFetchStatus: Number(env("STORAGE_SMOKE_PUBLIC_STATUS") ?? "200"),
    privateFetchStatus: Number(env("STORAGE_SMOKE_PRIVATE_STATUS") ?? "403"),
  };
}

function headers(config: SmokeConfig, contentType = "application/json"): HeadersInit {
  return {
    ...(contentType ? { "content-type": contentType } : {}),
    ...(config.authToken ? { authorization: `Bearer ${config.authToken}` } : {}),
  };
}

async function requestJson<T = JsonRecord>(
  config: SmokeConfig,
  method: string,
  path: string,
  body?: unknown,
  authenticated = true
): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: authenticated ? headers(config) : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`
    );
  }
  return payload as T;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedRecord(value: JsonRecord, key: string): JsonRecord {
  const next = value[key];
  if (!isRecord(next)) {
    throw new Error(`Response is missing object field "${key}".`);
  }
  return next;
}

function stringField(value: JsonRecord, key: string): string {
  const next = value[key];
  if (typeof next !== "string" || next.length === 0) {
    throw new Error(`Response is missing string field "${key}".`);
  }
  return next;
}

function arrayField(value: JsonRecord, key: string): JsonRecord[] {
  const next = value[key];
  if (!Array.isArray(next)) {
    throw new Error(`Response is missing array field "${key}".`);
  }
  return next.filter(isRecord);
}

function extractUrl(asset: JsonRecord): string | undefined {
  for (const key of ["url", "mediaUrl", "assetUrl", "remoteUrl"]) {
    const value = asset[key];
    if (typeof value === "string" && value.startsWith("http")) return value;
  }
  return undefined;
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`
    );
  }
}

function assertStorageFields(asset: JsonRecord, phase: string): void {
  const storageKey = asset.storageKey ?? asset.storage_key;
  const storageBucket = asset.storageBucket ?? asset.storage_bucket;
  if (typeof storageKey !== "string" || storageKey.length === 0) {
    throw new Error(`${phase}: asset is missing storageKey/storage_key.`);
  }
  if (typeof storageBucket !== "string" || storageBucket.length === 0) {
    throw new Error(`${phase}: asset is missing storageBucket/storage_bucket.`);
  }
}

function absoluteUrl(config: SmokeConfig, value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  const apiUrl = new URL(config.apiBaseUrl);
  return `${apiUrl.origin}${value.startsWith("/") ? value : `/${value}`}`;
}

async function signedUploadSource(ctx: SmokeContext): Promise<JsonRecord> {
  if (!ctx.projectId) throw new Error("Project was not created.");
  const response = await requestJson<JsonRecord>(
    ctx.config,
    "POST",
    `/projects/${ctx.projectId}/assets/upload-url`,
    {
      filename: ctx.config.filename,
      contentType: ctx.config.contentType,
    }
  );
  const uploadPath = stringField(response, "path");
  const signedUrl = stringField(response, "signedUrl");
  const requiredHeaders = nestedRecord(response, "requiredHeaders");
  const put = await fetch(absoluteUrl(ctx.config, signedUrl), {
    method: "PUT",
    headers: {
      "content-type": ctx.config.contentType,
      ...Object.fromEntries(
        Object.entries(requiredHeaders).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      ),
    },
    body: sampleBytes,
  });
  if (!put.ok) {
    throw new Error(`signed upload PUT failed (${put.status}): ${await put.text()}`);
  }
  console.log(`uploaded object ${uploadPath}`);
  return { type: "storage_upload", path: uploadPath };
}

async function assetSource(ctx: SmokeContext): Promise<JsonRecord> {
  const { config } = ctx;
  if (config.sourceMode === "multipart") {
    return {
      type: "multipart_upload",
      dataBase64: sampleBytes.toString("base64"),
      mimeType: config.contentType,
    };
  }
  if (config.sourceMode === "local_path") {
    if (!config.localPath) {
      throw new Error("STORAGE_SMOKE_LOCAL_PATH is required for local_path mode.");
    }
    return { type: "local_path", path: config.localPath };
  }
  return signedUploadSource(ctx);
}

async function createProject(ctx: SmokeContext): Promise<void> {
  const response = await requestJson<JsonRecord>(ctx.config, "POST", "/projects", {
    name: `Storage smoke ${new Date().toISOString()}`,
  });
  const project = nestedRecord(response, "project");
  ctx.projectId = stringField(project, "id");
  console.log(`created project ${ctx.projectId}`);
}

async function createAsset(ctx: SmokeContext): Promise<void> {
  if (!ctx.projectId) throw new Error("Project was not created.");
  const response = await requestJson<JsonRecord>(
    ctx.config,
    "POST",
      `/projects/${ctx.projectId}/assets`,
    {
      source: await assetSource(ctx),
      kind: "image",
      filename: ctx.config.filename,
      userContext: {
        title: "Storage smoke asset",
        description: "Created by apps/api/scripts/storage-smoke.ts",
      },
    }
  );
  const asset = nestedRecord(response, "asset");
  ctx.assetId = stringField(asset, "id");
  assertEqual(asset.status, "ready", "created asset status");
  assertStorageFields(asset, "created asset");
  console.log(`created asset ${ctx.assetId}`);
}

async function setVisibility(
  ctx: SmokeContext,
  visibility: Visibility
): Promise<JsonRecord> {
  if (!ctx.projectId || !ctx.assetId) throw new Error("Asset was not created.");
  const response = await requestJson<JsonRecord>(
    ctx.config,
    "PATCH",
    `/projects/${ctx.projectId}/assets/${ctx.assetId}/visibility`,
    { visibility }
  );
  const asset = nestedRecord(response, "asset");
  assertEqual(asset.visibility, visibility, `${visibility} toggle`);
  assertStorageFields(asset, `${visibility} toggle`);
  console.log(`set asset ${visibility}`);
  return asset;
}

async function findDiscoveredAsset(ctx: SmokeContext): Promise<JsonRecord> {
  if (!ctx.assetId) throw new Error("Asset was not created.");
  const response = await requestJson<JsonRecord>(
    ctx.config,
    "GET",
    "/discover/assets?limit=100",
    undefined,
    false
  );
  const assets = arrayField(response, "assets");
  const asset = assets.find((candidate) => candidate.id === ctx.assetId);
  if (!asset) {
    throw new Error(
      `Published asset ${ctx.assetId} was not returned by /discover/assets.`
    );
  }
  return asset;
}

async function expectFetchStatus(
  url: string,
  expectedStatus: number,
  label: string
): Promise<void> {
  const response = await fetch(url, { redirect: "manual" });
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label}: expected HTTP ${expectedStatus}, got ${response.status} for ${url}`
    );
  }
  console.log(`${label}: HTTP ${response.status}`);
}

async function assertPublicUrl(ctx: SmokeContext): Promise<void> {
  const discovered = await findDiscoveredAsset(ctx);
  const url = extractUrl(discovered);
  if (!url) {
    throw new Error("Published discovery asset is missing a stable media URL.");
  }
  ctx.publicUrl = url;
  await expectFetchStatus(url, ctx.config.publicFetchStatus, "public stable URL");
}

async function assertPrivateUrl(ctx: SmokeContext): Promise<void> {
  if (!ctx.projectId || !ctx.assetId) throw new Error("Asset was not created.");
  if (ctx.publicUrl) {
    await expectFetchStatus(
      ctx.publicUrl,
      ctx.config.privateFetchStatus,
      "old public URL after privatize"
    );
  }

  const response = await requestJson<JsonRecord>(
    ctx.config,
    "GET",
    `/projects/${ctx.projectId}/assets/${ctx.assetId}`
  );
  const asset = nestedRecord(response, "asset");
  const signedUrl = extractUrl(asset);
  if (!signedUrl) {
    throw new Error("Private authenticated asset response is missing a signed media URL.");
  }
  await expectFetchStatus(signedUrl, 200, "private signed URL");
}

async function main(): Promise<void> {
  const config = readConfig();
  const ctx: SmokeContext = { config };

  console.log(`storage smoke against ${config.apiBaseUrl}`);
  console.log(`source mode: ${config.sourceMode}`);

  await createProject(ctx);
  await createAsset(ctx);
  await setVisibility(ctx, "public");
  await assertPublicUrl(ctx);
  await setVisibility(ctx, "private");
  await assertPrivateUrl(ctx);

  console.log("storage smoke passed");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
