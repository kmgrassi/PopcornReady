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

test("domain engine failures are claim-fenced and release their owned session", () => {
  assert.match(migration, /create or replace function public\.fail_domain_run_turn/);
  assert.match(migration, /from public\.orchestrator_runs r[\s\S]*?for update/);
  assert.match(migration, /from public\.agent_sessions s[\s\S]*?for update/);
  assert.match(migration, /stale_domain_failure[\s\S]*?errcode = '55000'/);
  assert.match(migration, /claim_generation = s\.claim_generation \+ 1/);
  assert.match(migration, /set status = 'failed'/);
  assert.match(migration, /set status = 'canceled'/);
  assert.match(migration, /wake_orchestrator_dispatch/);
  assert.match(migration, /grant execute on function public\.fail_domain_run_turn\(uuid, uuid, jsonb, bigint\)\s+to service_role/);
});
