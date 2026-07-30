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
  alsoFailAt?: "BEGIN" | "COMMIT" | "ROLLBACK";
  failureErrors?: Partial<
    Record<"connect" | "BEGIN" | "COMMIT" | "ROLLBACK", unknown>
  >;
}) {
  const steps: Step[] = [];
  const releasedWith: Array<Error | boolean | undefined> = [];
  const client = {
    async query(sql: string) {
      steps.push(sql);
      if (options.failAt === sql || options.alsoFailAt === sql) {
        throw options.failureErrors?.[
          sql as "BEGIN" | "COMMIT" | "ROLLBACK"
        ] ?? new Error(`${sql} failed`);
      }
      return { rows: [], rowCount: 0 };
    },
    release(error?: Error | boolean) {
      releasedWith.push(error);
      steps.push(error ? "release(error)" : "release");
    },
  };
  const pool = {
    async connect() {
      steps.push("connect");
      if (options.failAt === "connect") {
        throw options.failureErrors?.connect ?? new Error("connect failed");
      }
      return client;
    },
  };
  return {
    pool: pool as unknown as Pick<Pool, "connect">,
    client: client as unknown as PoolClient,
    releasedWith,
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

for (const primaryFailure of ["callback", "COMMIT"] as const) {
  test(`rollback failure evicts the client while preserving the original ${primaryFailure} error`, async () => {
    const original = new Error(`${primaryFailure} failed`);
    const rollbackError = new Error("ROLLBACK failed");
    const fixture = fakePool({
      failAt: primaryFailure === "COMMIT" ? "COMMIT" : "ROLLBACK",
      alsoFailAt: primaryFailure === "COMMIT" ? "ROLLBACK" : undefined,
      failureErrors: {
        COMMIT: original,
        ROLLBACK: rollbackError,
      },
    });
    await assert.rejects(
      createTransactionRunner(fixture.pool)("test.rollback", async () => {
        fixture.steps.push("callback");
        if (primaryFailure === "callback") throw original;
      }),
      (error: unknown) => error === original
    );
    assert.deepEqual(
      fixture.steps,
      [
        "connect",
        "BEGIN",
        "callback",
        "COMMIT",
        "ROLLBACK",
        "release(error)",
      ].filter(
        (step) => primaryFailure === "COMMIT" || step !== "COMMIT"
      )
    );
    assert.equal(fixture.releasedWith.length, 1);
    assert.equal(fixture.releasedWith[0], rollbackError);
  });
}

test("a non-Error rollback failure still evicts the client", async () => {
  const original = new Error("callback failed");
  const fixture = fakePool({
    failAt: "ROLLBACK",
    failureErrors: { ROLLBACK: "connection lost" },
  });
  await assert.rejects(
    createTransactionRunner(fixture.pool)("test.rollback.nonError", async () => {
      throw original;
    }),
    (error: unknown) => error === original
  );
  assert.equal(fixture.releasedWith[0], true);
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
