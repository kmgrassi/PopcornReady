import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  createCreatorDirectDatabaseReadiness,
} from "../creator-direct-readiness.js";
import type { TransactionRunner } from "../creator-direct-confirmation.js";

function readinessRunner(
  overrides: Record<string, unknown> = {}
): { runner: TransactionRunner; calls: () => number } {
  let calls = 0;
  const runner: TransactionRunner = async (_operation, callback) => {
    calls += 1;
    return callback({
      async query() {
        return {
          rows: [
            {
              correct_role: true,
              no_bypass_rls: true,
              no_superuser: true,
              safe_role_attributes: true,
              no_role_memberships: true,
              owns_no_protected_tables: true,
              no_table_wide_privileges: true,
              no_forbidden_column_privileges: true,
              projects_read: true,
              runs_read: true,
              runs_lock: true,
              gates_read: true,
              gates_update: true,
              idempotency_read: true,
              idempotency_insert: true,
              reserve_execute: true,
              wake_execute: true,
              policy_count: 7,
              ...overrides,
            },
          ],
          rowCount: 1,
        };
      },
    } as unknown as PoolClient);
  };
  return { runner, calls: () => calls };
}

test("production readiness requires the role capabilities and caches success", async () => {
  const fixture = readinessRunner();
  const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://configured",
  });

  assert.deepEqual(await readiness(), { ready: true, checked: true });
  assert.deepEqual(await readiness(), { ready: true, checked: true });
  assert.equal(fixture.calls(), 1);
});

test("production readiness stays unavailable when a migration capability is missing", async () => {
  const fixture = readinessRunner({ gates_update: false });
  const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://configured",
  });

  assert.deepEqual(await readiness(), { ready: false, checked: true });
  assert.deepEqual(await readiness(), { ready: false, checked: true });
  assert.equal(fixture.calls(), 2);
});

test("production readiness rejects roles that can bypass RLS through superuser or ownership", async () => {
  for (const overrides of [
    { no_superuser: false },
    { owns_no_protected_tables: false },
  ]) {
    const fixture = readinessRunner(overrides);
    const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://configured",
    });

    assert.deepEqual(await readiness(), { ready: false, checked: true });
    assert.equal(fixture.calls(), 1);
  }
});

test("production readiness rejects unsafe role attributes, memberships, and extra privileges", async () => {
  for (const overrides of [
    { safe_role_attributes: false },
    { no_role_memberships: false },
    { no_table_wide_privileges: false },
    { no_forbidden_column_privileges: false },
  ]) {
    const fixture = readinessRunner(overrides);
    const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://configured",
    });

    assert.deepEqual(await readiness(), { ready: false, checked: true });
    assert.equal(fixture.calls(), 1);
  }
});

test("Railway health checks the database when NODE_ENV is absent", async () => {
  const fixture = readinessRunner();
  const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
    RAILWAY_ENVIRONMENT_NAME: "production",
    DATABASE_URL: "postgresql://configured",
  });

  assert.deepEqual(await readiness(), { ready: true, checked: true });
  assert.equal(fixture.calls(), 1);
});

test("non-production health remains live without direct database configuration", async () => {
  const fixture = readinessRunner();
  const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
    NODE_ENV: "development",
  });

  assert.deepEqual(await readiness(), { ready: true, checked: false });
  assert.equal(fixture.calls(), 0);
});

test("production health fails closed when DATABASE_URL is absent", async () => {
  const fixture = readinessRunner();
  const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
    NODE_ENV: "production",
  });

  assert.deepEqual(await readiness(), { ready: false, checked: false });
  assert.equal(fixture.calls(), 0);
});

test("Railway health fails closed when DATABASE_URL is absent", async () => {
  const fixture = readinessRunner();
  const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
    RAILWAY_ENVIRONMENT_ID: "environment-id",
  });

  assert.deepEqual(await readiness(), { ready: false, checked: false });
  assert.equal(fixture.calls(), 0);
});
