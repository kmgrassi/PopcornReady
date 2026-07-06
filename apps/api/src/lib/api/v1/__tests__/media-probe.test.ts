import assert from "node:assert/strict";
import test from "node:test";
import { probeUploadedMedia } from "../media-probe";

test("probeUploadedMedia accepts server-readable media bytes", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
  assert.doesNotThrow(() =>
    probeUploadedMedia({ bytes: png, kind: "image", filename: "poster.png" })
  );

  const mp4Header = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.alloc(16),
  ]);
  assert.doesNotThrow(() =>
    probeUploadedMedia({ bytes: mp4Header, kind: "video", filename: "clip.mp4" })
  );
});

test("probeUploadedMedia rejects non-media bytes", () => {
  assert.throws(
    () =>
      probeUploadedMedia({
        bytes: Buffer.from("not a video"),
        kind: "video",
        filename: "clip.mp4",
      }),
    /not readable media/
  );
});
