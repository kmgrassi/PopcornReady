import assert from "node:assert/strict";
import test from "node:test";

import { isWorkspaceAdminRole } from "../store";

test("workspace admin role accepts owner and admin only", () => {
  assert.equal(isWorkspaceAdminRole("owner"), true);
  assert.equal(isWorkspaceAdminRole("admin"), true);
  assert.equal(isWorkspaceAdminRole("member"), false);
  assert.equal(isWorkspaceAdminRole(null), false);
  assert.equal(isWorkspaceAdminRole(undefined), false);
});
