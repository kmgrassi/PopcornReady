import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260729160000_rerun_proposal_lifecycle.sql"
);
const roleMigrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260730170000_rerun_lifecycle_postgres_role.sql"
);
const graphRoleMigrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260730174000_rerun_atomic_graph_role.sql"
);

test("rerun lifecycle migration fences approval, successor, execution, and work identity", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create or replace function public\.approve_rerun_proposal/);
  assert.match(migration, /for update;[\s\S]*insert into public\.actions[\s\S]*set status = 'approved'/);
  assert.match(migration, /create table public\.rerun_proposal_successors/);
  assert.match(migration, /proposal_superseded/);
  assert.match(migration, /unique \(execution_reservation_id, work_item_id\)/);
  assert.match(migration, /lease_token uuid/);
  assert.match(migration, /lease_generation integer/);
  assert.match(migration, /root_run_id uuid not null references public\.orchestrator_runs/);
  assert.match(migration, /create or replace function public\.renew_rerun_execution_lease/);
  assert.match(migration, /create or replace function public\.record_rerun_executor_callback/);
  assert.match(migration, /create or replace function public\.cancel_rerun_execution/);
  assert.match(migration, /rerun_work_item_replay_mismatch/);
  assert.match(migration, /owns_materialized_root boolean/);
  assert.match(migration, /callback\.status <> 'pending'/);
  assert.match(migration, /callback\.expires_at <= now\(\)/);
  assert.match(migration, /story_blueprints provenance/);
  assert.match(migration, /binding_subset jsonb not null/);
  assert.match(migration, /cardinality\(callback\.job_ids\) > 0/);
  assert.match(migration, /parked boolean/);
  assert.match(
    migration,
    /status <> 'running'[\s\S]*lease_expires_at <= now\(\)/
  );
  assert.match(
    migration,
    /select \* into v_execution[\s\S]*for update;[\s\S]*select \* into v_work[\s\S]*for update;[\s\S]*select \* into v_callback[\s\S]*for update;/
  );
  assert.match(
    migration,
    /Recovery never reuses a worker fence[\s\S]*lease_generation = lease_generation \+ 1/
  );
});

test("popcorn_api gets exact lifecycle columns and no workflow-routine authority", async () => {
  const migration = await readFile(roleMigrationPath, "utf8");
  assert.doesNotMatch(
    migration,
    /grant\s+(?:select|insert|update)(?:\s*,\s*(?:select|insert|update))*\s+on table public\.(?:actions|assets|rerun_|orchestrator_budget)/i
  );
  assert.match(migration, /grant select \([\s\S]*\) on table public\.actions/);
  assert.match(
    migration,
    /grant select \([\s\S]*\) on table public\.rerun_execution_reservations/
  );
  assert.match(
    migration,
    /grant execute on function public\.assert_rerun_proposal_pins_fresh/
  );
  assert.match(
    migration,
    /revoke all on function public\.finalize_rerun_execution[\s\S]*from popcorn_api/
  );
  assert.match(migration, /assets_popcorn_api_rerun_select/);
  assert.match(
    migration,
    /tool <> 'domain_report'[\s\S]*status in \('running', 'applied'\)[\s\S]*child\.id = actions\.orchestrator_run_id/
  );
  assert.match(
    migration,
    /work\.dispatch_action_id = orchestrator_runs\.root_action_id[\s\S]*approvalContext,executionReservationId/
  );
});

test("atomic graph role grants append and a bounded story-pointer function", async () => {
  const migration = await readFile(graphRoleMigrationPath, "utf8");
  assert.match(migration, /grant insert \([\s\S]*\) on table public\.selections/);
  assert.doesNotMatch(migration, /grant update\s+on table public\.selections/i);
  assert.match(migration, /revoke update on table public\.story_blueprints/);
  assert.match(migration, /create or replace function public\.apply_rerun_story_pointer/);
  assert.match(migration, /security definer/);
  assert.match(migration, /work\.status = 'completed'/);
  assert.match(migration, /binding->>'assetId' = p_new_asset_id::text/);
  assert.match(migration, /snapshot = v_destination\.content/);
  assert.match(migration, /story beat snapshot omitted its stable row identity/);
  assert.match(migration, /intent = coalesce\(v_semantic->>'intent', intent\)/);
  assert.match(migration, /p_row_kind not in \('story_blueprint', 'story_beat'\)/);
  assert.doesNotMatch(migration, /story_scene pointer changed/);
  assert.match(migration, /grant execute on function public\.apply_rerun_story_pointer/);
  assert.match(migration, /actions\.tool = 'rerun_execution'/);
  assert.match(migration, /actions\.status = 'running'/);
});

test("proposal ceilings use the canonical budget ledger without double-counting settled children", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /reservation_scope in \('operation', 'run_ceiling', 'proposal_ceiling'\)/);
  assert.match(migration, /parent_reservation_id uuid/);
  assert.match(migration, /proposal_action_id uuid/);
  assert.match(
    migration,
    /greatest\(parent\.estimated_usd - coalesce\(children\.actual_usd, 0\), 0\)/
  );
  assert.match(migration, /child\.parent_reservation_id = parent\.id/);
  assert.match(migration, /proposal_ceiling_exhausted/);
  assert.match(migration, /root_family_budget_exhausted_with_proposals/);
  assert.match(migration, /create or replace function public\.reserve_rerun_child_budget/);
  assert.match(migration, /select coalesce\(sum\(actual_usd\), 0\) into v_actual_cost_usd/);
});

test("terminalization validates exact bindings and records one execution action", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /report binding must appear exactly once/);
  assert.match(migration, /report claimed a binding outside its task/);
  assert.match(migration, /report\.params #> '\{outcome,outputs\}' = p_binding_results/);
  assert.match(migration, /applied rerun requires terminal root reconciliation/);
  assert.match(migration, /a\.tool = 'rerun_reconciliation'/);
  assert.match(migration, /approvalContext,proposalActionId/);
  assert.match(migration, /bound output lacks primitive action and budget causation/);
  assert.match(migration, /declared work causation differs from durable reservation/);
  assert.match(migration, /executor step child report causation mismatch/);
  assert.match(migration, /aggregate bindings differ from durable executor steps/);
  assert.match(migration, /budget\.orchestrator_run_id = coalesce/);
  assert.match(migration, /blocked_precondition/);
  assert.match(migration, /'schemaVersion', 'RerunExecution\.v1'/);
  assert.match(migration, /insert into public\.action_assets/);
  assert.match(migration, /execution_result_action_id/);
  assert.match(migration, /create or replace function public\.recover_rerun_execution/);
  assert.match(migration, /status = 'released', released_at = now\(\)/);
});
