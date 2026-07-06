import test from "node:test";
import assert from "node:assert/strict";
import { isActiveUploadStatus } from "./uploadQueue";

test("upload queue treats only in-flight states as active", () => {
  assert.equal(isActiveUploadStatus("queued"), true);
  assert.equal(isActiveUploadStatus("uploading"), true);
  assert.equal(isActiveUploadStatus("processing"), true);
  assert.equal(isActiveUploadStatus("ready"), false);
  assert.equal(isActiveUploadStatus("failed"), false);
});
