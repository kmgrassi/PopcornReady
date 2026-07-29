import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  closePool,
  closePostgresPool,
  createTransactionRunner,
  postgresPoolConfig,
  withTransaction,
} from "../transactions.js";

type Step = string;

function fakePool(options: {
  failAt?: "connect" | "BEGIN" | "COMMIT" | "ROLLBACK";
  callbackError?: Error;
}) {
  const steps: Step[] = [];
  const client = {
    async query(sql: string) {
      steps.push(sql);
      if (options.failAt === sql) throw new Error(`${sql} failed`);
      return { rows: [], rowCount: 0 };
    },
    release() {
      steps.push("release");
    },
  };
  const pool = {
    async connect() {
      steps.push("connect");
      if (options.failAt === "connect") throw new Error("connect failed");
      return client;
    },
  };
  return {
    pool: pool as unknown as Pick<Pool, "connect">,
    client: client as unknown as PoolClient,
    steps,
  };
}

test("transaction uses one client and commits before releasing it", async () => {
  const fixture = fakePool({});
  const result = await createTransactionRunner(fixture.pool)(
    "test.commit",
    async (client) => {
      assert.equal(client, fixture.client);
      fixture.steps.push("callback");
      return "done";
    }
  );
  assert.equal(result, "done");
  assert.deepEqual(fixture.steps, [
    "connect",
    "BEGIN",
    "callback",
    "COMMIT",
    "release",
  ]);
});

for (const failure of ["callback", "COMMIT"] as const) {
  test(`${failure} failure rolls back and releases the client`, async () => {
    const original = new Error(`${failure} failed`);
    const fixture = fakePool({
      failAt: failure === "COMMIT" ? "COMMIT" : undefined,
    });
    await assert.rejects(
      createTransactionRunner(fixture.pool)("test.failure", async () => {
        fixture.steps.push("callback");
        if (failure === "callback") throw original;
      }),
      failure === "callback"
        ? (error: unknown) => error === original
        : /COMMIT failed/
    );
    assert.deepEqual(fixture.steps, [
      "connect",
      "BEGIN",
      "callback",
      "COMMIT",
      "ROLLBACK",
      "release",
    ].filter((step) => failure === "COMMIT" || step !== "COMMIT"));
  });
}

test("BEGIN failure releases without issuing rollback", async () => {
  const fixture = fakePool({ failAt: "BEGIN" });
  await assert.rejects(
    createTransactionRunner(fixture.pool)("test.begin", async () => undefined),
    /BEGIN failed/
  );
  assert.deepEqual(fixture.steps, ["connect", "BEGIN", "release"]);
});

test("rollback failure preserves the original callback error object", async () => {
  const original = new Error("callback failed");
  const fixture = fakePool({ failAt: "ROLLBACK" });
  await assert.rejects(
    createTransactionRunner(fixture.pool)("test.rollback", async () => {
      fixture.steps.push("callback");
      throw original;
    }),
    (error: unknown) => error === original
  );
  assert.deepEqual(fixture.steps, [
    "connect",
    "BEGIN",
    "callback",
    "ROLLBACK",
    "release",
  ]);
});

test("pool acquisition failure has no client to release", async () => {
  const fixture = fakePool({ failAt: "connect" });
  await assert.rejects(
    createTransactionRunner(fixture.pool)("test.connect", async () => undefined),
    /connect failed/
  );
  assert.deepEqual(fixture.steps, ["connect"]);
});

test("pool close is observable and null is a no-op", async () => {
  let closes = 0;
  await closePool({
    async end() {
      closes += 1;
    },
  } as Pick<Pool, "end">);
  await closePool(null);
  assert.equal(closes, 1);
});

test("pool configuration is lazy and validates bounded settings", async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousMax = process.env.DATABASE_POOL_MAX;
  try {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_POOL_MAX;
    await closePostgresPool();
    await assert.rejects(
      withTransaction("test.missing", async () => undefined),
      /DATABASE_URL is required/
    );

    process.env.DATABASE_URL =
      "postgresql://example.invalid/database?sslmode=require";
    process.env.DATABASE_POOL_MAX = "21";
    assert.throws(() => postgresPoolConfig(), /between 1 and 20/);
    process.env.DATABASE_POOL_MAX = "3";
    const config = postgresPoolConfig();
    assert.equal(config.max, 3);
    assert.equal(config.connectionString, process.env.DATABASE_URL);
    assert.equal(config.application_name, "popcornready-api");
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousMax === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = previousMax;
  }
});
