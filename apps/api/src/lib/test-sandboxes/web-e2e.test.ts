import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSandboxMatchesTeardownRequest,
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

test("web e2e teardown requires the sandbox row to match the guarded workspace", () => {
  const row = {
    workspace_id: "workspace_1",
    purpose: WEB_E2E_SANDBOX_PURPOSE,
    workspaces: {
      name: `${WEB_E2E_WORKSPACE_PREFIX}abc-123`,
      purpose: "internal_test",
    },
  };

  assert.doesNotThrow(() =>
    assertSandboxMatchesTeardownRequest(row, {
      workspaceId: "workspace_1",
      workspaceName: `${WEB_E2E_WORKSPACE_PREFIX}abc-123`,
      prefix: WEB_E2E_WORKSPACE_PREFIX,
      purpose: WEB_E2E_SANDBOX_PURPOSE,
    })
  );
  assert.throws(
    () =>
      assertSandboxMatchesTeardownRequest(row, {
        workspaceId: "workspace_2",
        workspaceName: `${WEB_E2E_WORKSPACE_PREFIX}abc-123`,
        prefix: WEB_E2E_WORKSPACE_PREFIX,
        purpose: WEB_E2E_SANDBOX_PURPOSE,
      }),
    /workspace id does not match/
  );
  assert.throws(
    () =>
      assertSandboxMatchesTeardownRequest(
        { ...row, purpose: "tool-test" },
        {
          workspaceId: "workspace_1",
          workspaceName: `${WEB_E2E_WORKSPACE_PREFIX}abc-123`,
          prefix: WEB_E2E_WORKSPACE_PREFIX,
          purpose: WEB_E2E_SANDBOX_PURPOSE,
        }
      ),
    /sandbox purpose does not match/
  );
});
