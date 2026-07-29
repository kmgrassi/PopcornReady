import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(testDir, "../../../../../../supabase/migrations/20260727180000_domain_run_failure_finalization.sql"),
  "utf8"
);
const replayMigration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260729141000_replay_domain_run_failure_finalization.sql"
  ),
  "utf8"
);

function assertSafeDomainFinalizer(sql: string, label: string) {
  assert.match(sql, /create or replace function public\.fail_domain_run_turn/, label);
  assert.match(sql, /returns table \(failed boolean\)/, label);
  assert.match(sql, /security definer/, label);
  assert.match(sql, /set search_path = public/, label);
  assert.match(sql, /from public\.orchestrator_runs r[\s\S]*?for update/, label);
  assert.match(sql, /from public\.agent_sessions s[\s\S]*?for update/, label);
  assert.match(sql, /stale_domain_failure[\s\S]*?errcode = '55000'/, label);
  assert.match(sql, /claim_generation = s\.claim_generation \+ 1/, label);
  assert.match(sql, /set status = 'failed'/, label);
  assert.match(sql, /set status = 'canceled'/, label);
  assert.match(sql, /wake_orchestrator_dispatch/, label);
  assert.match(
    sql,
    /revoke all on function public\.fail_domain_run_turn\(uuid, uuid, jsonb, bigint\)\s+from public, anon, authenticated/,
    label
  );
  assert.match(
    sql,
    /grant execute on function public\.fail_domain_run_turn\(uuid, uuid, jsonb, bigint\)\s+to service_role/,
    label
  );
}

function substantiveSql(sql: string) {
  const start = sql.indexOf("create or replace function");
  assert.notEqual(start, -1);
  return sql.slice(start).trim();
}

test("both domain finalizer migrations preserve claim fencing and least privilege", () => {
  assertSafeDomainFinalizer(migration, "original migration");
  assertSafeDomainFinalizer(replayMigration, "replay migration");
});

test("the fresh-version replay exactly matches the collided domain DDL", () => {
  assert.equal(substantiveSql(replayMigration), substantiveSql(migration));
});
