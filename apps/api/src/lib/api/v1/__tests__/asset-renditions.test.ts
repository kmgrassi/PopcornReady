import assert from "node:assert/strict";
import test from "node:test";

import {
  assetThumbnailStorageKey,
  createThumbnailRendition,
  extractFirstFrameImage,
} from "../asset-renditions";

test("assetThumbnailStorageKey stores the thumbnail sidecar under the asset prefix", () => {
  assert.equal(
    assetThumbnailStorageKey({
      workspaceId: "ws_1",
      projectId: "proj_1",
      assetId: "asset_1",
    }),
    "ws_1/proj_1/asset_1/renditions/thumbnail.webp"
  );
});

test("createThumbnailRendition degrades to no thumbnail when ffmpeg is unavailable", async () => {
  const previous = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = "/definitely/missing/ffmpeg";
  try {
    const rendition = await createThumbnailRendition({
      workspaceId: "ws_1",
      projectId: "proj_1",
      assetId: "asset_1",
      kind: "image",
      filename: "poster.png",
      bytes: Buffer.from("not-real-image-bytes"),
      visibility: "public",
    });
    assert.equal(rendition, null);
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previous;
  }
});

test("extractFirstFrameImage degrades to no image when ffmpeg is unavailable", async () => {
  const previous = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = "/definitely/missing/ffmpeg";
  try {
    const frame = await extractFirstFrameImage({
      filename: "clip.mp4",
      bytes: Buffer.from("not-real-video-bytes"),
    });
    assert.equal(frame, null);
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previous;
  }
});
