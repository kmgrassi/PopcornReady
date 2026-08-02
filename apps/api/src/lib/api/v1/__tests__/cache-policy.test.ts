import assert from "node:assert/strict";
import test from "node:test";
import { SIGNED_MEDIA_JSON_HEADERS } from "../cache-policy";

test("signed media list JSON is private and never stored", () => {
  assert.deepEqual(SIGNED_MEDIA_JSON_HEADERS, {
    "Cache-Control": "private, no-store",
  });
});
