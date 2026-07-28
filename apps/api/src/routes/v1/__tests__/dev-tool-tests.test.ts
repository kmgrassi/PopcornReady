import assert from "node:assert/strict";
import test from "node:test";

import { wiredToolTestNames } from "../dev-tool-tests";

test("tool-test harness reports specialist-only Visuals wrappers as wired", () => {
  const wired = wiredToolTestNames();

  assert.equal(wired.has("generate_image_asset"), true);
  assert.equal(wired.has("generate_video_asset"), true);
});
