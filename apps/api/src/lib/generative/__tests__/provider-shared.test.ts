import assert from "node:assert/strict";
import test from "node:test";
import { mimeForPath } from "../providers/shared";

test("mimeForPath preserves supported video edit MIME types", () => {
  assert.equal(mimeForPath("clip.mpeg"), "video/mpeg");
  assert.equal(mimeForPath("clip.mpg"), "video/mpeg");
  assert.equal(mimeForPath("clip.flv"), "video/x-flv");
});
