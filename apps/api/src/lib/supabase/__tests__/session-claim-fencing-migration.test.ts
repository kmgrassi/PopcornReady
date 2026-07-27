import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260727120000_session_claim_and_job_fencing.sql"
  ),
  "utf8"
);

test("session claims are lock-serialized, generation-incrementing, and service-role-only", () => {
  assert.match(migration, /create or replace function public\.claim_agent_session_run/);
  assert.match(migration, /for update/);
  // Ownership change increments the durable generation in the same statement.
  assert.match(migration, /claim_generation = s\.claim_generation \+ 1/);
  // Idempotent re-claim by the current owner returns the unchanged generation.
  assert.match(migration, /if v_session\.active_run_id = p_run_id then/);
  assert.match(migration, /'held'::text, null::bigint/);
  assert.match(migration, /'terminal'::text, null::bigint/);
  // The claimed run must belong to the session (same project).
  assert.match(migration, /does not belong to session/);
  assert.match(migration, /create or replace function public\.release_agent_session_run/);
  assert.match(migration, /s\.active_run_id = p_run_id/);
  assert.match(
    migration,
    /revoke all on function public\.claim_agent_session_run[\s\S]*from public, anon, authenticated/
  );
  assert.match(
    migration,
    /grant execute on function public\.release_agent_session_run[\s\S]*to service_role/
  );
});

test("stale session-claim job finalization is fenced through canonical provenance", () => {
  assert.match(migration, /create or replace function public\.jobs_fence_session_claim/);
  // The recorded generation is immutable once launched.
  assert.match(migration, /session_claim_generation is immutable once launched/);
  // Only terminal transitions are fenced; canceled stays available for cleanup.
  assert.match(migration, /new\.status in \('succeeded', 'failed'\)/);
  assert.match(migration, /old\.status in \('queued', 'running'\)/);
  // Current generation derives via jobs.action_id -> actions.orchestrator_run_id
  // -> orchestrator_runs.agent_session_id (no redundant session columns).
  assert.match(migration, /join public\.orchestrator_runs r on r\.id = a\.orchestrator_run_id/);
  assert.match(migration, /join public\.agent_sessions s on s\.id = r\.agent_session_id/);
  assert.match(migration, /stale_session_claim/);
  assert.match(migration, /using errcode = '55000'/);
  // The trigger only evaluates jobs launched under a session claim.
  assert.match(migration, /when \(old\.session_claim_generation is not null\)/);
});
