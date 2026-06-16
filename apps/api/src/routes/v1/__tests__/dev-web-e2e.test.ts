import assert from "node:assert/strict";
import test from "node:test";

import { isWebE2EHarnessEnabled } from "../dev-web-e2e";

test("web e2e harness is opt-in outside production", () => {
  assert.equal(
    isWebE2EHarnessEnabled({ ENABLE_WEB_E2E_HARNESS: "1", NODE_ENV: "development" }),
    true
  );
  assert.equal(
    isWebE2EHarnessEnabled({ ENABLE_WEB_E2E_HARNESS: "true", NODE_ENV: "test" }),
    true
  );
});

test("web e2e harness is disabled by default and in production", () => {
  assert.equal(isWebE2EHarnessEnabled({ NODE_ENV: "development" }), false);
  assert.equal(
    isWebE2EHarnessEnabled({ ENABLE_WEB_E2E_HARNESS: "1", NODE_ENV: "production" }),
    false
  );
});
