import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(testDir, "../../../../../../supabase/migrations/20260728140000_creator_direct_proposal_safety.sql"),
  "utf8"
);

test("creator-direct confirmations require a queued run before reserving budget", () => {
  assert.match(migration, /v_run\.status <> 'queued'/);
  assert.match(migration, /creator_direct_gate_run_not_queued/);
  assert.match(migration, /reserve_orchestrator_run_budget/);
});

test("creator-direct proposal gates accept preallocated stable identities", () => {
  assert.match(migration, /create_creator_direct_proposal_gate_with_id/);
  assert.match(migration, /p_gate_id uuid/);
  assert.match(migration, /set id = p_gate_id/);
  assert.match(migration, /grant execute on function public\.create_creator_direct_proposal_gate_with_id/);
});
