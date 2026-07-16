import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ApiError } from "../errors";
import {
  runIdempotent,
  type IdempotencyStore,
} from "../idempotency";

type RecordState = {
  bodyHash: string;
  leaseToken?: string;
  leaseExpiresAt?: number;
  status?: number;
  responseBody?: unknown;
};

class FakeIdempotencyStore implements IdempotencyStore {
  readonly records = new Map<string, RecordState>();
  now = 0;
  renewCalls = 0;
  private nextToken = 1;

  private recordKey(scope: string, key: string) {
    return `${scope}\0${key}`;
  }

  async reserve(input: { scope: string; key: string; bodyHash: string; leaseSeconds: number }) {
    const key = this.recordKey(input.scope, input.key);
    const existing = this.records.get(key);
    if (!existing) {
      const leaseToken = `lease_${this.nextToken++}`;
      this.records.set(key, {
        bodyHash: input.bodyHash,
        leaseToken,
        leaseExpiresAt: this.now + input.leaseSeconds * 1_000,
      });
      return { state: "reserved" as const, leaseToken };
    }
    if (existing.bodyHash !== input.bodyHash) return { state: "conflict" as const };
    if (existing.status !== undefined) {
      return {
        state: "replay" as const,
        status: existing.status,
        responseBody: existing.responseBody,
      };
    }
    if ((existing.leaseExpiresAt ?? 0) <= this.now) {
      const leaseToken = `lease_${this.nextToken++}`;
      existing.leaseToken = leaseToken;
      existing.leaseExpiresAt = this.now + input.leaseSeconds * 1_000;
      return { state: "reserved" as const, leaseToken };
    }
    return { state: "pending" as const };
  }

  async complete(input: {
    scope: string;
    key: string;
    bodyHash: string;
    leaseToken: string;
    status: number;
    responseBody: unknown;
  }) {
    const record = this.records.get(this.recordKey(input.scope, input.key));
    if (!record || record.bodyHash !== input.bodyHash || record.leaseToken !== input.leaseToken) {
      return false;
    }
    record.status = input.status;
    record.responseBody = input.responseBody;
    record.leaseToken = undefined;
    record.leaseExpiresAt = undefined;
    return true;
  }

  async renew(input: {
    scope: string;
    key: string;
    bodyHash: string;
    leaseToken: string;
    leaseSeconds: number;
  }) {
    this.renewCalls += 1;
    const record = this.records.get(this.recordKey(input.scope, input.key));
    if (!record || record.bodyHash !== input.bodyHash || record.leaseToken !== input.leaseToken) {
      return false;
    }
    record.leaseExpiresAt = this.now + input.leaseSeconds * 1_000;
    return true;
  }

  async abandon(input: { scope: string; key: string; bodyHash: string; leaseToken: string }) {
    const key = this.recordKey(input.scope, input.key);
    const record = this.records.get(key);
    if (!record || record.bodyHash !== input.bodyHash || record.leaseToken !== input.leaseToken) {
      return false;
    }
    this.records.delete(key);
    return true;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("concurrent same-key requests run the producer exactly once", async () => {
  const store = new FakeIdempotencyStore();
  let runs = 0;
  const produce = async () => {
    runs += 1;
    await delay(10);
    return { status: 201, body: { runs } };
  };

  const [a, b] = await Promise.all([
    runIdempotent("scope", "key", "hash", produce, { store }),
    runIdempotent("scope", "key", "hash", produce, { store }),
  ]);

  assert.equal(runs, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(a, { status: 201, body: { runs: 1 } });
});

test("a long-running producer renews its active reservation", async () => {
  const store = new FakeIdempotencyStore();
  let renew: (() => void) | undefined;

  await runIdempotent(
    "scope",
    "renewal",
    "hash",
    async () => {
      renew?.();
      await Promise.resolve();
      return { status: 201, body: { renewed: true } };
    },
    {
      store,
      scheduleRenewal: (callback) => {
        renew = callback;
        return {} as ReturnType<typeof setInterval>;
      },
      clearRenewal: () => undefined,
    }
  );

  assert.equal(store.renewCalls, 1);
});

test("a replay with the same key and body returns the completed response", async () => {
  const store = new FakeIdempotencyStore();
  let runs = 0;
  const produce = async () => ({ status: 201, body: { id: "proj_1", runs: ++runs } });

  const first = await runIdempotent("scope", "key", "hash", produce, { store });
  const second = await runIdempotent("scope", "key", "hash", produce, { store });

  assert.equal(runs, 1);
  assert.deepEqual(first, second);
});

test("a replay preserves a JSON null response body", async () => {
  const store = new FakeIdempotencyStore();
  await runIdempotent("scope", "null", "hash", async () => ({ status: 204, body: null }), { store });
  const replay = await runIdempotent(
    "scope",
    "null",
    "hash",
    async () => ({ status: 204, body: { shouldNotRun: true } }),
    { store }
  );
  assert.equal(replay.body, null);
});

test("a same key with a different body hash is a conflict", async () => {
  const store = new FakeIdempotencyStore();
  await runIdempotent("scope", "key", "hash-a", async () => ({ status: 201, body: {} }), {
    store,
  });

  await assert.rejects(
    () => runIdempotent("scope", "key", "hash-b", async () => ({ status: 201, body: {} }), { store }),
    (err: unknown) => err instanceof ApiError && err.code === "idempotency_conflict"
  );
});

test("non-success results and thrown producers release the reservation", async () => {
  const store = new FakeIdempotencyStore();
  let runs = 0;
  const failed = async () => ({ status: 400, body: { runs: ++runs } });

  await runIdempotent("scope", "key", "hash", failed, { store });
  await runIdempotent("scope", "key", "hash", failed, { store });
  assert.equal(runs, 2);

  await assert.rejects(
    () =>
      runIdempotent(
        "scope",
        "throws",
        "hash",
        async () => {
          throw new Error("boom");
        },
        { store }
      ),
    /boom/
  );
  const retried = await runIdempotent(
    "scope",
    "throws",
    "hash",
    async () => ({ status: 201, body: { recovered: true } }),
    { store }
  );
  assert.deepEqual(retried.body, { recovered: true });
});

test("a live reservation waits boundedly instead of rerunning the producer", async () => {
  const store = new FakeIdempotencyStore();
  await store.reserve({ scope: "scope", key: "key", bodyHash: "hash", leaseSeconds: 60 });
  let producerRuns = 0;

  await assert.rejects(
    () =>
      runIdempotent(
        "scope",
        "key",
        "hash",
        async () => ({ status: 201, body: { runs: ++producerRuns } }),
        {
          store,
          maxWaitMs: 10,
          pollIntervalMs: 5,
          now: () => store.now,
          sleep: async (ms) => {
            store.now += ms;
          },
        }
      ),
    (err: unknown) => err instanceof ApiError && err.code === "idempotency_in_progress"
  );
  assert.equal(producerRuns, 0);
});

test("an expired reservation is reclaimed, while stale tokens cannot complete it", async () => {
  const store = new FakeIdempotencyStore();
  const first = await store.reserve({ scope: "scope", key: "key", bodyHash: "hash", leaseSeconds: 1 });
  assert.equal(first.state, "reserved");
  store.now = 1_001;

  const result = await runIdempotent(
    "scope",
    "key",
    "hash",
    async () => ({ status: 201, body: { reclaimed: true } }),
    { store }
  );
  assert.deepEqual(result.body, { reclaimed: true });
  assert.equal(
    await store.complete({
      scope: "scope",
      key: "key",
      bodyHash: "hash",
      leaseToken: first.leaseToken!,
      status: 201,
      responseBody: { stale: true },
    }),
    false
  );
});

const SUPABASE_CONFIGURED = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);
const dbTest: typeof test = SUPABASE_CONFIGURED ? test : (test.skip as typeof test);

dbTest("Postgres reservation permits one producer and replays across concurrent callers", async () => {
  const scope = `idempotency-test:${randomUUID()}`;
  const key = randomUUID();
  let runs = 0;
  const produce = async () => {
    runs += 1;
    await delay(25);
    return { status: 201, body: { runs } };
  };

  const [first, second] = await Promise.all([
    runIdempotent(scope, key, "body-hash", produce),
    runIdempotent(scope, key, "body-hash", produce),
  ]);

  assert.equal(runs, 1);
  assert.deepEqual(first, second);
});
