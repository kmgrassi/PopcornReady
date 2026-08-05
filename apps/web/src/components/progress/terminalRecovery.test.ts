import assert from "node:assert/strict";
import test from "node:test";

import { terminalRecoveryMode } from "./terminalRecovery";

test("credit recovery takes priority over generic project-change guidance", () => {
  assert.equal(
    terminalRecoveryMode(
      {
        code: "insufficient_credits",
        message: "Add credits to continue.",
        retryable: true,
      },
      true,
    ),
    "continue_after_credit",
  );
});

test("retryable failures without a direct continuation point to Request Changes", () => {
  assert.equal(
    terminalRecoveryMode(
      {
        code: "quality_review_failed",
        message: "Continuity check failed.",
        retryable: true,
      },
      false,
    ),
    "request_changes",
  );
  assert.equal(
    terminalRecoveryMode(
      {
        code: "insufficient_credits",
        message: "Add credits to continue.",
        retryable: true,
      },
      false,
    ),
    "request_changes",
  );
});

test("non-retryable failures do not invent a recovery path", () => {
  assert.equal(
    terminalRecoveryMode(
      {
        code: "content_policy",
        message: "The request was rejected.",
        retryable: false,
      },
      false,
    ),
    "none",
  );
});
