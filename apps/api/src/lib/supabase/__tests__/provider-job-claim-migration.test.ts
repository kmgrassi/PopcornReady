import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(testDir, "../../../../../../supabase/migrations/20260716120000_provider_job_claim.sql"),
  "utf8"
);

test("provider job claims are token-fenced and service-role-only", () => {
  assert.match(migration, /add column if not exists provider_claim_token uuid/);
  assert.match(migration, /add column if not exists provider_claimed_at timestamptz/);
  assert.match(migration, /create or replace function public\.claim_provider_job_execution/);
  assert.match(migration, /for update/);
  assert.match(migration, /v_job\.status = 'running'/);
  assert.match(migration, /provider_claimed_at <= p_stale_before/);
  assert.match(migration, /provider_claim_reconciliation_required/);
  assert.match(migration, /was not replayed automatically/);
  assert.match(migration, /status = 'running'/);
  assert.match(migration, /create or replace function public\.complete_provider_job_execution/);
  assert.match(migration, /j\.provider_claim_token = p_claim_token/);
  assert.match(migration, /p_status not in \('succeeded', 'failed', 'canceled'\)/);
  assert.match(migration, /p_action_output_asset_ids uuid\[\] default null/);
  assert.match(migration, /update public\.actions a/);
  assert.match(migration, /return next v_job/);
  assert.match(migration, /create or replace function public\.renew_provider_job_execution/);
  assert.match(migration, /set provider_claimed_at = clock_timestamp\(\)/);
  assert.match(migration, /progress = coalesce\(j\.progress, '\{\}'::jsonb\)[\s\S]*lastProgressAt/);
  assert.match(migration, /return coalesce\(v_renewed, false\)/);
  assert.match(migration, /revoke all on function public\.claim_provider_job_execution[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.complete_provider_job_execution[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.renew_provider_job_execution[\s\S]*to service_role/);
});
