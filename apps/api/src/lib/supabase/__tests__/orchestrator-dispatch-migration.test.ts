import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260714143000_lease_safe_orchestrator_dispatch_wake.sql"
  ),
  "utf8"
);
const store = readFileSync(resolve(testDir, "../../api/v1/orchestrator-store.ts"), "utf8");

test("dispatch wake derives workspace from the run and is service-role only", () => {
  assert.match(
    migration,
    /from public\.orchestrator_runs r\s+join public\.projects p on p\.id = r\.project_id/,
    "workspace identity must come from the run's project"
  );
  assert.doesNotMatch(
    migration,
    /create or replace function public\.wake_orchestrator_dispatch\([\s\S]*?p_workspace_id/,
    "wake RPC must not accept caller-supplied tenancy"
  );
  assert.match(
    migration,
    /where public\.orchestrator_dispatches\.workspace_id = excluded\.workspace_id/,
    "an existing cross-workspace dispatch must be rejected rather than rewritten"
  );
  assert.match(
    migration,
    /revoke all on function public\.wake_orchestrator_dispatch\(uuid\) from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.wake_orchestrator_dispatch\(uuid\) to service_role;/
  );
  assert.match(
    migration,
    /revoke all on function public\.claim_orchestrator_dispatches\(integer, integer\)\s+from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.claim_orchestrator_dispatches\(integer, integer\) to service_role;/
  );
  assert.match(
    migration,
    /revoke all on function public\.release_orchestrator_dispatch\(uuid, uuid, integer, boolean\)\s+from public, anon, authenticated;/
  );
  assert.match(
    migration,
    /grant execute on function public\.release_orchestrator_dispatch\(uuid, uuid, integer, boolean\)\s+to service_role;/
  );
  assert.doesNotMatch(store, /p_workspace_id/);
});

test("release preserves a wake that arrives during an active lease", () => {
  assert.match(
    migration,
    /when p_completed and pending_wake_at is null[\s\S]*?then 'completed'/,
    "a completed worker may finish the dispatch only when no wake raced with its lease"
  );
  assert.match(
    migration,
    /when pending_wake_at is not null then pending_wake_at/,
    "the raced wake timestamp must become the next availability time"
  );
  assert.match(
    migration,
    /pending_wake_at = null/,
    "release must consume the pending wake marker exactly once"
  );
});
