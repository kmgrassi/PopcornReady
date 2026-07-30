import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../../../supabase/migrations/20260730173000_settle_measured_orchestrator_cost.sql",
    import.meta.url
  ),
  "utf8"
);

test("measured cost settlement records overages instead of stranding reservations", () => {
  assert.match(
    migration,
    /create or replace function public\.settle_orchestrator_run_budget/
  );
  assert.match(migration, /set status = 'settled', actual_usd = p_actual_usd/);
  assert.match(migration, /set spent_usd = spent_usd \+ p_actual_usd/);
  assert.doesNotMatch(migration, /p_actual_usd > v_reservation\.estimated_usd/);
  assert.match(migration, /budget_settlement_replay_mismatch/);
});

test("domain completion cannot apply an active proposal work dispatch", () => {
  assert.match(
    migration,
    /create or replace function public\.preserve_active_rerun_work_dispatch/
  );
  assert.match(migration, /old\.tool = 'rerun_work_item_dispatch'/);
  assert.match(migration, /work\.status in \('reserved', 'running'\)/);
  assert.match(migration, /new\.status := old\.status/);
  assert.match(
    migration,
    /before update of status, output_asset_ids, error on public\.actions/
  );
});
