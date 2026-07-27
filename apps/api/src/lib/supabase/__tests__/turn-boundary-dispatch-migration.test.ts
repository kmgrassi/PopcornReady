import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260727153000_turn_boundary_domain_dispatch.sql"
  ),
  "utf8"
);

test("turn-boundary reports expose complete blocked/question recovery to the root", () => {
  assert.match(migration, /'domainReport', p_report/);
  assert.match(migration, /'unmetRequirements'/);
  assert.match(migration, /'suggestedNextTools'/);
  assert.match(
    migration,
    /set status = case when v_delegation_error is null then 'applied'::public\.action_status\s+else 'failed'::public\.action_status end/
  );
  assert.match(migration, /p_report ->> 'schemaVersion' is distinct from 'DomainReport\.v1'/);
});

test("retry limits are exact, replay-safe, and cancellation is transactional", () => {
  assert.match(migration, /if found then[\s\S]*?return;[\s\S]*?p_continues_run_id is not null/);
  assert.match(migration, /predecessor\.id = p_continues_run_id/);
  assert.match(migration, /into v_retry_requirement[\s\S]*?domain_requirement_retry_limit/);
  assert.match(migration, /create or replace function public\.cancel_domain_run/);
  assert.match(migration, /from public\.orchestrator_runs r[\s\S]*?for update/);
  assert.match(migration, /from public\.agent_sessions s[\s\S]*?for update/);
  assert.match(migration, /claim_generation = s\.claim_generation \+ 1/);
  assert.match(migration, /update public\.jobs j[\s\S]*?j\.status in \('queued', 'running'\)/);
  assert.match(migration, /grant execute on function public\.cancel_domain_run\(uuid, uuid\)\s+to service_role/);
});
