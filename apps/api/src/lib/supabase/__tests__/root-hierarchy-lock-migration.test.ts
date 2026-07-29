import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260729150000_lock_root_runs_to_creative_director.sql"
);
const cancellationMigrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260727170000_finite_run_runtime_controls.sql"
);

test("hierarchy lock migration causally cancels only nonterminal legacy root families", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(
    migration,
    /where agent_role = 'creative_director'[\s\S]*root_execution_profile is distinct from 'creative_director'[\s\S]*status in \('queued', 'running', 'waiting'\)/
  );
  assert.match(
    migration,
    /perform public\.cancel_orchestrator_run_family\(v_root\.project_id, v_root\.id\)/
  );
  assert.doesNotMatch(migration, /set root_execution_profile\s*=/);
});

test("the invoked family cancellation covers children, jobs, claims, and reservations", async () => {
  const [migration, cancellationMigration] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(cancellationMigrationPath, "utf8"),
  ]);
  assert.match(migration, /public\.cancel_orchestrator_run_family/);
  const start = cancellationMigration.indexOf(
    "create or replace function public.cancel_orchestrator_run_family"
  );
  const end = cancellationMigration.indexOf(
    "create or replace view public.orchestrator_runtime_recovery_projection",
    start
  );
  assert.ok(start >= 0 && end > start);
  const cancellation = cancellationMigration.slice(start, end);
  assert.match(
    cancellation,
    /r\.parent_run_id = c\.id or r\.continues_run_id = c\.id/
  );
  assert.match(cancellation, /update public\.jobs j set status = 'canceled'/);
  assert.match(
    cancellation,
    /update public\.agent_sessions s[\s\S]*set active_run_id = null/
  );
  assert.match(
    cancellation,
    /update public\.orchestrator_budget_reservations b[\s\S]*set status = 'canceled'/
  );
});

test("hierarchy lock migration replay-safely retires every family dispatch", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /with recursive legacy_family\(id\)/);
  assert.match(
    migration,
    /child\.parent_run_id = parent\.id or child\.continues_run_id = parent\.id/
  );
  assert.match(
    migration,
    /update public\.orchestrator_dispatches d[\s\S]*set status = 'completed'/
  );
  assert.match(migration, /lease_token = null/);
  assert.match(migration, /lease_expires_at = null/);
  assert.match(migration, /pending_wake_at = null/);
  assert.match(migration, /d\.orchestrator_run_id in \(select id from legacy_family\)/);
  assert.match(migration, /d\.status is distinct from 'completed'/);
});

test("anonymous admission accepts only the server-owned hierarchy profile", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /p_root_execution_profile text default 'creative_director'/);
  assert.match(
    migration,
    /p_root_execution_profile is distinct from 'creative_director'[\s\S]*raise exception 'creative_director root execution profile required'/
  );
  assert.match(
    migration,
    /p_deploy_id, p_git_sha, 'creative_director'/
  );
});
