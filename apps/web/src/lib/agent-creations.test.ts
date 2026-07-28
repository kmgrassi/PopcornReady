import assert from "node:assert/strict";
import test from "node:test";
import { isStandaloneCreationEnabled } from "./agent-creations";

test("Asset Studio stays opt-in until its standalone flag is enabled", () => {
  assert.equal(isStandaloneCreationEnabled(undefined), false);
  assert.equal(isStandaloneCreationEnabled("false"), false);
  assert.equal(isStandaloneCreationEnabled("true"), true);
});
