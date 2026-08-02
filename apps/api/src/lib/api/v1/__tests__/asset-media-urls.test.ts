import assert from "node:assert/strict";
import test from "node:test";

import { assetMediaUrlsForRow } from "../asset-media-urls";

const fixedNow = () => new Date("2026-06-11T12:00:00.000Z");

test("assetMediaUrlsForRow reuses image URLs as thumbnails", async () => {
  const media = await assetMediaUrlsForRow(
    {
      media: "image",
      kind: "keyframe",
      status: "ready",
      remote_url: "https://cdn.example/keyframe.png",
      storage_key: null,
    },
    { now: fixedNow }
  );

  assert.equal(media.url, "https://cdn.example/keyframe.png");
  assert.equal(media.thumbnailUrl, media.url);
  assert.equal(media.expiresAt, null);
});

test("assetMediaUrlsForRow serves legacy local storage keys from the local media origin", async () => {
  const previousBase = process.env.STORAGE_LOCAL_URL_BASE;
  process.env.STORAGE_LOCAL_URL_BASE = "http://localhost:4200";
  try {
    const media = await assetMediaUrlsForRow(
      {
        media: "video",
        kind: "clip",
        status: "ready",
        remote_url: null,
        storage_key: "media/uploads/ws1/p1/dev-only.mp4",
      },
      { now: fixedNow }
    );

    assert.equal(media.url, "http://localhost:4200/uploads/ws1/p1/dev-only.mp4");
    assert.equal(media.thumbnailUrl, null);
    assert.equal(media.expiresAt, null);
  } finally {
    if (previousBase === undefined) delete process.env.STORAGE_LOCAL_URL_BASE;
    else process.env.STORAGE_LOCAL_URL_BASE = previousBase;
  }
});

test("assetMediaUrlsForRow keeps remote URLs ahead of non-local storage keys", async () => {
  const media = await assetMediaUrlsForRow(
    {
      media: "video",
      kind: "clip",
      status: "ready",
      remote_url: "https://cdn.example/clip.mp4",
      storage_key: "uploads/ws1/p1/missing.mp4",
    },
    { now: fixedNow }
  );

  assert.equal(media.url, "https://cdn.example/clip.mp4");
  assert.equal(media.thumbnailUrl, null);
  assert.equal(media.expiresAt, null);
});

test("assetMediaUrlsForRow resolves stored thumbnail renditions for videos", async () => {
  const previousBase = process.env.STORAGE_LOCAL_URL_BASE;
  process.env.STORAGE_LOCAL_URL_BASE = "http://localhost:4200";
  try {
    const media = await assetMediaUrlsForRow(
      {
        media: "video",
        kind: "source_footage",
        status: "ready",
        remote_url: null,
        storage_key: "ws1/p1/asset_1/clip.mp4",
        storage_bucket: "assets-public",
        visibility: "public",
        context: {
          context: {
            renditions: {
              thumbnail: {
                schemaVersion: "assetRendition.v1",
                kind: "thumbnail",
                storageKey: "ws1/p1/asset_1/renditions/thumbnail.webp",
                storageBucket: "assets-public",
                contentType: "image/webp",
                generatedAt: "2026-06-11T12:00:00.000Z",
              },
            },
          },
        },
      },
      { now: fixedNow }
    );

    assert.equal(media.url, "http://localhost:4200/ws1/p1/asset_1/clip.mp4");
    assert.equal(
      media.thumbnailUrl,
      "http://localhost:4200/ws1/p1/asset_1/renditions/thumbnail.webp"
    );
    assert.equal(media.expiresAt, null);
  } finally {
    if (previousBase === undefined) delete process.env.STORAGE_LOCAL_URL_BASE;
    else process.env.STORAGE_LOCAL_URL_BASE = previousBase;
  }
});

test("assetMediaUrlsForRow withholds URLs for pending and data assets", async () => {
  const pending = await assetMediaUrlsForRow(
    {
      media: "audio",
      kind: "audio_track",
      status: "pending",
      remote_url: "https://cdn.example/audio.mp3",
      storage_key: null,
    },
    { now: fixedNow }
  );
  const data = await assetMediaUrlsForRow(
    {
      media: "data",
      kind: "plan",
      status: "ready",
      remote_url: "https://cdn.example/story.json",
      storage_key: null,
    },
    { now: fixedNow }
  );

  assert.deepEqual(pending, {
    url: null,
    thumbnailUrl: null,
    expiresAt: null,
  });
  assert.deepEqual(data, {
    url: null,
    thumbnailUrl: null,
    expiresAt: null,
  });
});

test("assetMediaUrlsForRow reports the real private signed URL expiry", async () => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    STORAGE_BACKEND: "s3",
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    S3_PUBLIC_BUCKET: "assets-public",
    S3_PRIVATE_BUCKET: "assets-private",
    S3_PUBLIC_URL_BASE: "https://cdn.example.com",
    AWS_ENDPOINT_URL_S3: "http://localhost:9000",
    S3_FORCE_PATH_STYLE: "true",
  });
  try {
    const media = await assetMediaUrlsForRow(
      {
        media: "image",
        kind: "image",
        status: "ready",
        remote_url: null,
        storage_key: "ws/proj/asset/poster.png",
        storage_bucket: "assets-private",
        visibility: "private",
      },
      { now: fixedNow }
    );

    assert.ok(media.url);
    assert.equal(new URL(media.url).searchParams.get("X-Amz-Expires"), "3600");
    assert.equal(media.expiresAt, "2026-06-11T13:00:00.000Z");
  } finally {
    process.env = previous;
  }
});

test("assetMediaUrlsForRow withholds a focused URL when managed bytes are missing", async () => {
  const media = await assetMediaUrlsForRow(
    {
      media: "image",
      kind: "image",
      status: "ready",
      remote_url: null,
      storage_key: "ws/proj/asset/missing.png",
      storage_bucket: "assets-private",
      visibility: "private",
    },
    {
      verifyManagedObjects: true,
      objectExists: async () => false,
      now: fixedNow,
    }
  );

  assert.deepEqual(media, { url: null, thumbnailUrl: null, expiresAt: null });
});

test("assetMediaUrlsForRow propagates ambiguous storage verification failures", async () => {
  await assert.rejects(
    assetMediaUrlsForRow(
      {
        media: "video",
        kind: "clip",
        status: "ready",
        remote_url: null,
        storage_key: "ws/proj/asset/forbidden.mp4",
        storage_bucket: "assets-private",
        visibility: "private",
      },
      {
        verifyManagedObjects: true,
        objectExists: async () => {
          throw new Error("access denied");
        },
      }
    ),
    /access denied/
  );
});

test("assetMediaUrlsForRow never falls back to remote_url for managed private media", async () => {
  await assert.rejects(
    assetMediaUrlsForRow(
      {
        media: "image",
        kind: "image",
        status: "ready",
        remote_url: "https://public.example/legacy.png",
        storage_key: "ws/proj/asset/private.png",
        storage_bucket: "assets-private",
        visibility: "private",
      },
      {
        resolveUrl: async () => {
          throw new Error("signing unavailable");
        },
      }
    ),
    /signing unavailable/
  );
});
