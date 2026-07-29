import assert from "node:assert/strict";
import test from "node:test";
import { creationKindFor } from "./agent-creations";

test("Asset Studio maps creator-facing goals to creator-direct task kinds", () => {
  assert.equal(creationKindFor("image"), "image_create");
  assert.equal(creationKindFor("video"), "video_create");
  assert.equal(creationKindFor("soundtrack"), "soundtrack_create");
});
