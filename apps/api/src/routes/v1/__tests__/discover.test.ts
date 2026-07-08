import assert from "node:assert/strict";
import test from "node:test";

import { isPublicProjectId } from "../discover-ids";

test("public project ids must be uuid-shaped", () => {
  assert.equal(isPublicProjectId("not-a-real-project"), false);
  assert.equal(isPublicProjectId("123"), false);
  assert.equal(isPublicProjectId("7e6a21f8-9684-4f2d-a13d-985f92d98917"), false);
  assert.equal(isPublicProjectId("7e6a21f8-9684-4f2d-a13d-985f92d9891a"), true);
});
