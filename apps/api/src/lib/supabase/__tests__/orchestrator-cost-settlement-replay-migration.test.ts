import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../../../supabase/migrations/20260730175000_harden_orchestrator_cost_settlement_replay.sql",
    import.meta.url
  ),
  "utf8"
);

test("cost settlement persists and revalidates the complete billing tuple", () => {
  assert.match(
    migration,
    /billing_user_id = p_billing_user_id,\s+billable_usd = p_billable_usd/
  );
  assert.match(
    migration,
    /v_reservation\.billing_user_id is distinct from p_billing_user_id/
  );
  assert.match(
    migration,
    /v_reservation\.billable_usd is distinct from p_billable_usd/
  );
  assert.match(migration, /budget_settlement_replay_mismatch/);
  assert.match(migration, /budget_settlement_billing_mismatch/);
});

test("billable settlement requires an attributable user", () => {
  assert.match(
    migration,
    /p_billable_usd > 0 and p_billing_user_id is null/
  );
});
