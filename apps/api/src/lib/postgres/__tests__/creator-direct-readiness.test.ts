import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  createCreatorDirectDatabaseReadiness,
} from "../creator-direct-readiness.js";
import type { TransactionRunner } from "../creator-direct-confirmation.js";

function readinessRunner(
  overrides: Record<string, unknown> = {}
): {
  runner: TransactionRunner;
  calls: () => number;
  params: () => readonly unknown[];
  sql: () => string;
} {
  let calls = 0;
  let observedParams: readonly unknown[] = [];
  let observedSql = "";
  const runner: TransactionRunner = async (_operation, callback) => {
    calls += 1;
    return callback({
      async query(sql: string, params: readonly unknown[] = []) {
        observedSql = sql;
        observedParams = params;
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
              lifecycle_access_exact: true,
              lifecycle_routine_boundary: true,
              projects_read: true,
              runs_read: true,
              runs_lock: true,
              gates_read: true,
              gates_update: true,
              idempotency_read: true,
              idempotency_insert: true,
              reserve_execute: true,
              wake_execute: true,
              policy_count: 26,
              ...overrides,
            },
          ],
          rowCount: 1,
        };
      },
    } as unknown as PoolClient);
  };
  return {
    runner,
    calls: () => calls,
    params: () => observedParams,
    sql: () => observedSql,
  };
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

test("production readiness audits the complete retired lifecycle routine family", async () => {
  const fixture = readinessRunner();
  const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://configured",
  });
  await readiness();
  const routines = fixture.params()[3] as string[];
  assert.equal(routines.length, 16);
  assert.ok(routines.some((routine) =>
    routine.includes("approve_rerun_proposal")));
  assert.ok(routines.some((routine) =>
    routine.includes("reserve_rerun_child_budget")));
  assert.ok(routines.some((routine) =>
    routine.includes("recover_rerun_execution")));
});

test("production readiness tolerates but does not require the transitional root profile grant", async () => {
  const fixture = readinessRunner();
  const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://configured",
  });
  await readiness();

  const requiredPrivileges = JSON.parse(fixture.params()[2] as string) as {
    orchestrator_runs: {
      SELECT: string[];
      INSERT: string[];
    };
  };
  assert.ok(!requiredPrivileges.orchestrator_runs.SELECT.includes(
    "root_execution_profile"
  ));
  assert.ok(!requiredPrivileges.orchestrator_runs.INSERT.includes(
    "root_execution_profile"
  ));
  assert.match(
    fixture.sql(),
    /'orchestrator_runs'.*'root_execution_profile'/s
  );
  assert.match(
    fixture.sql(),
    /expected_table\.key = 'orchestrator_runs'\s+and actual\.column_name = 'root_execution_profile'\s+and actual\.privilege_type in \('SELECT', 'INSERT'\)/
  );
  assert.doesNotMatch(
    fixture.sql(),
    /expected_table\.key <> 'orchestrator_runs'/
  );
});

test("Railway health fails closed when DATABASE_URL is absent", async () => {
  const fixture = readinessRunner();
  const readiness = createCreatorDirectDatabaseReadiness(fixture.runner, {
    RAILWAY_ENVIRONMENT_ID: "environment-id",
  });

  assert.deepEqual(await readiness(), { ready: false, checked: false });
  assert.equal(fixture.calls(), 0);
});
