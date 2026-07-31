import assert from "node:assert/strict";
import test from "node:test";

import {
  getLatestRerunExecution,
  normalizeRerunExecutionFailure,
} from "../rerun-lifecycle-store";

test("execution failures preserve their durable kind and user-safe message", () => {
  assert.deepEqual(
    normalizeRerunExecutionFailure({
      schema_version: "action_error.v1",
      kind: "provider_quota",
      message: "The image provider quota was exhausted.",
    }),
    {
      code: "provider_quota",
      message:
        "A generation provider could not complete the requested changes right now.",
    }
  );
});

test("execution failures never expose raw durable diagnostics", () => {
  assert.deepEqual(
    normalizeRerunExecutionFailure({
      kind: "execution_canceled",
      reason: "creator_canceled",
    }),
    {
      code: "execution_canceled",
      message: "The requested changes were canceled.",
    }
  );
  assert.deepEqual(
    normalizeRerunExecutionFailure({
      kind: "executor_failed",
      failures: ["The visual executor timed out."],
    }),
    {
      code: "executor_failed",
      message: "A generation step could not complete the requested changes.",
    }
  );
});

test("latest execution reads failure from its linked result action", async () => {
  let requestedAction: { projectId: string; executionActionId: string } | null =
    null;
  const execution = await getLatestRerunExecution(
    { projectId: "project-1", proposalActionId: "proposal-1" },
    {
      getReservation: async () => ({
        id: "reservation-1",
        status: "failed",
        execution_result_action_id: "execution-1",
        updated_at: "2026-07-31T00:00:00.000Z",
      }),
      getExecutionAction: async (input) => {
        requestedAction = input;
        return {
          error: {
            kind: "executor_failed",
            failures: ["secret provider response"],
          },
        };
      },
    }
  );

  assert.deepEqual(requestedAction, {
    projectId: "project-1",
    executionActionId: "execution-1",
  });
  assert.deepEqual(execution?.failure, {
    code: "executor_failed",
    message: "A generation step could not complete the requested changes.",
  });
});

test("linked cancellation suppresses execution failure copy", async () => {
  const execution = await getLatestRerunExecution(
    { projectId: "project-1", proposalActionId: "proposal-1" },
    {
      getReservation: async () => ({
        id: "reservation-1",
        status: "canceled",
        execution_result_action_id: "execution-1",
        updated_at: "2026-07-31T00:00:00.000Z",
      }),
      getExecutionAction: async () => ({
        error: { kind: "execution_canceled", reason: "private reason" },
      }),
    }
  );

  assert.equal(execution?.status, "canceled");
  assert.equal(execution?.failure, null);
});
