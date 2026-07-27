import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260727170000_finite_run_runtime_controls.sql"
  ),
  "utf8"
);

test("finite-run budget admission serializes a root family and is replay-safe", () => {
  assert.match(migration, /create table public\.orchestrator_budget_reservations/);
  assert.match(migration, /unique \(project_id, reservation_key\)/);
  assert.match(migration, /create or replace function public\.reserve_orchestrator_run_budget/);
  assert.match(migration, /for update/);
  assert.match(migration, /budget_reservation_replay_mismatch/);
  assert.match(migration, /root_family_budget_exhausted/);
  assert.match(migration, /reservation_scope in \('operation', 'run_ceiling'\)/);
  assert.match(migration, /create or replace function public\.settle_orchestrator_run_budget/);
  assert.match(migration, /budget settlement exceeds reserved maximum/);
  assert.match(migration, /apply_credit_transaction\(/);
  assert.match(migration, /budget-settlement-credit:/);
  assert.match(migration, /budget_settlement_replay_mismatch/);
  assert.match(migration, /spent_usd = spent_usd \+ p_actual_usd/);
  assert.match(migration, /orchestrator_run_family_budget_projection/);
  assert.match(migration, /model_cost_usd/);
});

test("creator-direct confirmation is hashed, one-use, and does not enqueue before approval", () => {
  assert.match(migration, /approval_token_hash text/);
  assert.match(migration, /token_consumed_at timestamptz/);
  assert.match(migration, /create_creator_direct_proposal_gate/);
  assert.match(migration, /encode\(digest\(p_approval_token, 'sha256'\), 'hex'\)/);
  assert.match(migration, /creator_direct_confirmation_already_consumed/);
  assert.match(migration, /creator_direct_rejection_invalid/);
  assert.match(migration, /token_consumed_at is null/);
  assert.match(migration, /reserve_orchestrator_run_budget\(/);
  assert.match(migration, /wake_orchestrator_dispatch\(v_run\.id\)/);
  assert.match(migration, /creator-direct-confirm:/);
});

test("cancellation stays causal and recovery identifies only durable repair states", () => {
  assert.match(migration, /create or replace function public\.cancel_orchestrator_run_family/);
  assert.match(migration, /r\.parent_run_id = c\.id or r\.continues_run_id = c\.id/);
  assert.match(migration, /j\.status in \('queued', 'running'\)/);
  assert.match(migration, /status = 'canceled'/);
  assert.match(migration, /orchestrator_runtime_recovery_projection/);
  assert.match(migration, /recover_orchestrator_runtime_controls/);
  assert.match(migration, /terminal_job_without_recorded_cost/);
  assert.match(migration, /unacknowledged_domain_wait/);
  assert.match(migration, /parent_wakes integer/);
});
