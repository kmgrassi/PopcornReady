import assert from "node:assert/strict";
import test from "node:test";
import { isE2ePosterGenerationEnabled } from "./inspiration-poster-generation";

test("only enables E2E poster generation for the explicit true string", () => {
  assert.equal(isE2ePosterGenerationEnabled(undefined), false);
  assert.equal(isE2ePosterGenerationEnabled("false"), false);
  assert.equal(isE2ePosterGenerationEnabled("true"), true);
});
