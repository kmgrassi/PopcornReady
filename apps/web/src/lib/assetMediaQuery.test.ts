import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSET_MEDIA_REFRESH_BUFFER_MS,
  assetMediaSeedIdentity,
  assetMediaRefreshDelay,
  assetMediaSessionKey,
  assetMediaStaleTime,
  createAssetMediaRetryState,
  isReusableAssetMedia,
  readPersistedAssetMedia,
  recordAssetMediaLoad,
  refreshAssetMediaAfterError,
  writePersistedAssetMedia,
} from "./assetMediaQuery";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

test("asset media session keys isolate auth identity and workspace", () => {
  assert.notEqual(
    assetMediaSessionKey("user-a", "workspace-a", "asset-1"),
    assetMediaSessionKey("user-b", "workspace-a", "asset-1"),
  );
  assert.notEqual(
    assetMediaSessionKey("user-a", "workspace-a", "asset-1"),
    assetMediaSessionKey("user-a", "workspace-b", "asset-1"),
  );
});

test("signed media is reusable only outside the refresh buffer", () => {
  const now = Date.parse("2026-08-02T12:00:00.000Z");
  const outsideBuffer = new Date(now + ASSET_MEDIA_REFRESH_BUFFER_MS + 1).toISOString();
  const atBuffer = new Date(now + ASSET_MEDIA_REFRESH_BUFFER_MS).toISOString();

  assert.equal(
    isReusableAssetMedia({ url: "https://s3.example/asset", expiresAt: outsideBuffer }, now),
    true,
  );
  assert.equal(
    isReusableAssetMedia({ url: "https://s3.example/asset", expiresAt: atBuffer }, now),
    false,
  );
  assert.equal(
    isReusableAssetMedia({ url: "https://cdn.example/asset", expiresAt: null }, now),
    true,
  );
});

test("stale time reaches zero at the five-minute refresh boundary", () => {
  const updatedAt = Date.parse("2026-08-02T12:00:00.000Z");
  const expiresAt = new Date(updatedAt + 60 * 60 * 1_000).toISOString();
  assert.equal(
    assetMediaStaleTime({ url: "https://s3.example/asset", expiresAt }, updatedAt),
    55 * 60 * 1_000,
  );
  assert.equal(
    assetMediaStaleTime({ url: "https://cdn.example/asset", expiresAt: null }, updatedAt),
    Number.POSITIVE_INFINITY,
  );
});

test("proactive refresh schedules at expiry minus five minutes and fires immediately inside it", () => {
  const now = Date.parse("2026-08-02T12:00:00.000Z");
  assert.equal(
    assetMediaRefreshDelay(new Date(now + 60 * 60 * 1_000).toISOString(), now),
    55 * 60 * 1_000,
  );
  assert.equal(
    assetMediaRefreshDelay(new Date(now + ASSET_MEDIA_REFRESH_BUFFER_MS).toISOString(), now),
    0,
  );
  assert.equal(assetMediaRefreshDelay(null, now), null);
});

test("session persistence keeps fresh media and evicts near-expiry entries", () => {
  const storage = memoryStorage();
  const key = "media";
  const now = Date.parse("2026-08-02T12:00:00.000Z");
  const fresh = {
    url: "https://s3.example/asset",
    thumbnailUrl: null,
    expiresAt: new Date(now + 60 * 60 * 1_000).toISOString(),
  };
  writePersistedAssetMedia(storage as Storage, key, fresh, "v1|private", now);
  assert.deepEqual(
    readPersistedAssetMedia(storage as Storage, key, "v1|private", now)?.media,
    fresh,
  );
  assert.equal(
    readPersistedAssetMedia(
      storage as Storage,
      key,
      "v1|private",
      now + 55 * 60 * 1_000,
    ),
    null,
  );
});

test("session persistence rejects a newer or visibility-changed list seed", () => {
  const storage = memoryStorage();
  const media = { url: "https://cdn.example/public", thumbnailUrl: null, expiresAt: null };
  writePersistedAssetMedia(storage as Storage, "media", media, "v1|public");

  assert.equal(
    readPersistedAssetMedia(storage as Storage, "media", "v2|private"),
    null,
  );
  assert.equal(
    assetMediaSeedIdentity({ updatedAt: "v2", visibility: "private" }),
    "v2|private",
  );
});

test("concurrent error recovery deduplicates and stops if the refreshed URL also fails", async () => {
  const state = createAssetMediaRetryState();
  let refreshCount = 0;
  let resolveRefresh!: (value: { url: string; thumbnailUrl: null; expiresAt: null }) => void;
  const refresh = () => {
    refreshCount += 1;
    return new Promise<{ url: string; thumbnailUrl: null; expiresAt: null }>((resolve) => {
      resolveRefresh = resolve;
    });
  };

  const first = refreshAssetMediaAfterError(state, "url-a", refresh);
  const concurrent = refreshAssetMediaAfterError(state, "url-a", refresh);
  assert.equal(refreshCount, 1);
  resolveRefresh({ url: "url-b", thumbnailUrl: null, expiresAt: null });
  await Promise.all([first, concurrent]);

  assert.equal(await refreshAssetMediaAfterError(state, "url-b", refresh), null);
  assert.equal(refreshCount, 1);
  recordAssetMediaLoad(state, "url-b");
  void refreshAssetMediaAfterError(state, "url-b", refresh);
  assert.equal(refreshCount, 2);
});

test("focused refresh failures reject and release the failed URL for a later retry", async () => {
  const state = createAssetMediaRetryState();
  let refreshCount = 0;
  const refresh = async () => {
    refreshCount += 1;
    if (refreshCount === 1) throw new Error("focused media unavailable");
    return { url: "url-b", thumbnailUrl: null, expiresAt: null };
  };

  await assert.rejects(
    refreshAssetMediaAfterError(state, "url-a", refresh),
    /focused media unavailable/,
  );
  assert.equal(state.blockedUrls.has("url-a"), false);

  assert.deepEqual(await refreshAssetMediaAfterError(state, "url-a", refresh), {
    url: "url-b",
    thumbnailUrl: null,
    expiresAt: null,
  });
  assert.equal(refreshCount, 2);
});
