import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_UPLOAD_MAX_DURATION_SEC,
  MOBILE_UPLOAD_MAX_BASE64_BYTES,
  MOBILE_UPLOAD_MAX_FILES,
  MOBILE_UPLOAD_MAX_VIDEO_BYTES,
  inferMobileUploadKind,
  validateMobileUploadCandidate,
  validateMobileUploadCount,
} from "@popcorn/shared/mobile-upload-policy";

test("mobile upload policy accepts current iPhone media types", () => {
  const mov = validateMobileUploadCandidate({
    filename: "IMG_2042.MOV",
    mimeType: "video/quicktime",
    sizeBytes: 90 * 1024 * 1024,
    durationSec: 38,
  });
  assert.equal(mov.ok, true);
  assert.equal(mov.kind, "video");
  assert.equal(mov.requiresTranscode, true);

  const heic = validateMobileUploadCandidate({
    filename: "IMG_2043.HEIC",
    mimeType: "image/heic",
    sizeBytes: 4 * 1024 * 1024,
  });
  assert.equal(heic.ok, true);
  assert.equal(heic.kind, "image");
  assert.equal(heic.requiresTranscode, true);

  assert.equal(inferMobileUploadKind("IMG_2044.HEIF", ""), "image");
  assert.equal(inferMobileUploadKind("IMG_2045.heif", "video/heif"), "video");
});

test("mobile upload policy rejects unsupported, oversize, and too-long media", () => {
  assert.equal(inferMobileUploadKind("notes.pdf", "application/pdf"), null);

  const unsupported = validateMobileUploadCandidate({
    filename: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.issue?.code, "unsupported_media_type");

  const oversize = validateMobileUploadCandidate({
    filename: "large.mp4",
    mimeType: "video/mp4",
    sizeBytes: MOBILE_UPLOAD_MAX_VIDEO_BYTES + 1,
    durationSec: 30,
  });
  assert.equal(oversize.ok, false);
  assert.equal(oversize.issue?.code, "file_too_large");
  assert.equal(oversize.issue?.limit, MOBILE_UPLOAD_MAX_VIDEO_BYTES);

  const tooLong = validateMobileUploadCandidate({
    filename: "long.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10 * 1024 * 1024,
    durationSec: MOBILE_UPLOAD_MAX_DURATION_SEC + 1,
  });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.issue?.code, "clip_too_long");
});

test("mobile upload policy applies the lower base64 JSON transport cap", () => {
  const directUpload = validateMobileUploadCandidate({
    filename: "phone.mov",
    mimeType: "video/quicktime",
    sizeBytes: 90 * 1024 * 1024,
    durationSec: 30,
    transport: "direct_upload",
  });
  assert.equal(directUpload.ok, true);

  const base64Upload = validateMobileUploadCandidate({
    filename: "phone.mov",
    mimeType: "video/quicktime",
    sizeBytes: MOBILE_UPLOAD_MAX_BASE64_BYTES + 1,
    durationSec: 30,
    transport: "base64_json",
  });
  assert.equal(base64Upload.ok, false);
  assert.equal(base64Upload.issue?.code, "file_too_large");
  assert.equal(base64Upload.issue?.limit, MOBILE_UPLOAD_MAX_BASE64_BYTES);
});

test("mobile upload policy preserves explicit kind for legacy multipart callers", () => {
  const explicitKind = validateMobileUploadCandidate({
    filename: "upload.bin",
    mimeType: "application/octet-stream",
    sizeBytes: 1024,
    kind: "video",
    transport: "base64_json",
  });
  assert.equal(explicitKind.ok, true);
  assert.equal(explicitKind.kind, "video");
});

test("mobile upload policy caps files per mobile selection", () => {
  assert.equal(validateMobileUploadCount(MOBILE_UPLOAD_MAX_FILES), null);

  const issue = validateMobileUploadCount(MOBILE_UPLOAD_MAX_FILES + 1);
  assert.equal(issue?.code, "too_many_files");
  assert.equal(issue?.limit, MOBILE_UPLOAD_MAX_FILES);
  assert.equal(issue?.actual, MOBILE_UPLOAD_MAX_FILES + 1);
});
