import assert from "node:assert/strict";
import test from "node:test";

import type { OrchestratorEngineStore } from "../engine";
import { withRetry, withStoreRetry } from "../retry";

const noSleep = async () => {};

test("withRetry returns on first success without retrying", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    return "ok";
  }, { sleep: noSleep });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry recovers after a transient failure", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return "ok";
    },
    { attempts: 3, sleep: noSleep }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry throws the last error once attempts are exhausted", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error(`fail ${calls}`);
      },
      { attempts: 3, sleep: noSleep }
    ),
    /fail 3/
  );
  assert.equal(calls, 3);
});

test("withRetry stops immediately when shouldRetry returns false", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new Error("non-transient");
      },
      { attempts: 5, sleep: noSleep, shouldRetry: () => false }
    ),
    /non-transient/
  );
  assert.equal(calls, 1, "a non-retryable error must not be retried");
});

test("withRetry uses exponential backoff delays (capped)", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withRetry(
    async () => {
      calls += 1;
      if (calls < 4) throw new Error("transient");
      return "ok";
    },
    {
      attempts: 4,
      baseDelayMs: 50,
      maxDelayMs: 120,
      sleep: async (ms) => {
        delays.push(ms);
      },
    }
  );
  // 50 * 2^0, 50 * 2^1, then capped at 120 (would be 200).
  assert.deepEqual(delays, [50, 100, 120]);
});

test("withStoreRetry retries idempotent reads and reserved invocations", async () => {
  let listCalls = 0;
  let recordCalls = 0;
  const base: OrchestratorEngineStore = {
    async getOrchestratorRun() {
      throw new Error("unused");
    },
    async updateOrchestratorRun() {
      throw new Error("unused");
    },
    async listRunGates() {
      return [];
    },
    async markGateReached() {
      return null;
    },
    async listRunActions() {
      listCalls += 1;
      if (listCalls < 2) throw new Error("transient read");
      return [];
    },
    async recordInvocation() {
      recordCalls += 1;
      throw new Error("append failed");
    },
    async markInvocation() {},
  };

  const wrapped = withStoreRetry(base, { attempts: 3, sleep: noSleep });

  // Idempotent read recovers after a transient failure.
  assert.deepEqual(await wrapped.listRunActions("run1"), []);
  assert.equal(listCalls, 2);

  // A caller-reserved action id makes invocation persistence safe to retry.
  await assert.rejects(
    wrapped.recordInvocation({
      actionId: "action-1",
      projectId: "p",
      orchestratorRunId: "run1",
      tool: "plan_shots",
      status: "running",
      params: {},
      outputAssetIds: [],
      jobIds: [],
    }),
    /append failed/
  );
  assert.equal(recordCalls, 3, "recordInvocation should use the bounded retry policy");
});
