import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWebE2ESandboxName,
  WEB_E2E_SANDBOX_PURPOSE,
  WEB_E2E_WORKSPACE_PREFIX,
} from "./web-e2e";

test("web e2e sandboxes use their own purpose and deletable prefix", () => {
  assert.equal(WEB_E2E_SANDBOX_PURPOSE, "web-e2e");
  assert.doesNotThrow(() => assertWebE2ESandboxName(`${WEB_E2E_WORKSPACE_PREFIX}abc-123`));
});

test("web e2e sandbox guard refuses shared or tool-test workspaces", () => {
  assert.throws(() => assertWebE2ESandboxName("dev_workspace"), /Refusing to delete/);
  assert.throws(() => assertWebE2ESandboxName("__tooltest__abc-123"), /Refusing to delete/);
});
