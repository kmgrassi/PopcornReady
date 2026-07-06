import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectUploadInput,
  projectUploadDescription,
  projectUploadStatusMessage,
} from "./projectUpload";
import type { SelectedFootage } from "./upload";

function selectedFootage(
  filename: string,
  mimeType: string,
  kind: SelectedFootage["kind"],
): SelectedFootage {
  return {
    file: new File(["media"], filename, { type: mimeType }),
    name: filename,
    sizeBytes: 5,
    durationSec: kind === "image" ? 4 : 12,
    kind,
    requiresTranscode: false,
  };
}

test("project upload input registers media against the current project path", () => {
  const input = buildProjectUploadInput(
    selectedFootage("clip.mp4", "video/mp4", "video"),
    "bWVkaWE=",
    "project_view",
  );

  assert.deepEqual(input.source, {
    type: "multipart_upload",
    dataBase64: "bWVkaWE=",
    mimeType: "video/mp4",
  });
  assert.equal(input.kind, "video");
  assert.equal(input.filename, "clip.mp4");
  assert.equal(input.durationSec, 12);
  assert.deepEqual(input.userContext?.intendedUse, ["primary_footage"]);
  assert.equal(
    input.userContext?.description,
    "Added from the project dashboard: clip.mp4",
  );
});

test("project upload helper rejects audio so add-more matches landing validation", () => {
  assert.throws(
    () =>
      buildProjectUploadInput(
        selectedFootage("voiceover.mp3", "audio/mpeg", "audio"),
        "bWVkaWE=",
        "project_media_gallery",
      ),
    /not a supported video or image file/,
  );
});

test("project upload status message prioritizes upload and processing states", () => {
  assert.equal(
    projectUploadStatusMessage({
      uploadingCount: 2,
      refreshing: true,
      processingCount: 1,
    }),
    "Uploading 2 files...",
  );
  assert.equal(
    projectUploadStatusMessage({
      uploadingCount: 0,
      refreshing: true,
      processingCount: 1,
    }),
    "Refreshing media status...",
  );
  assert.equal(
    projectUploadStatusMessage({
      uploadingCount: 0,
      refreshing: false,
      processingCount: 1,
    }),
    "1 asset is processing.",
  );
});

test("project upload descriptions distinguish dashboard and gallery entry points", () => {
  assert.equal(
    projectUploadDescription("project_view", "clip.mov"),
    "Added from the project dashboard: clip.mov",
  );
  assert.equal(
    projectUploadDescription("project_media_gallery", "clip.mov"),
    "Added from the project media gallery: clip.mov",
  );
});
