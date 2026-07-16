import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(testDir, "../../../../../../supabase/migrations/20260716110000_atomic_http_idempotency.sql"),
  "utf8"
);

test("HTTP idempotency reservations are atomic and service-role-only", () => {
  assert.match(migration, /add column if not exists lease_token uuid/);
  assert.match(migration, /add column if not exists lease_expires_at timestamptz/);
  assert.match(migration, /create or replace function public\.reserve_idempotency_record/);
  assert.match(migration, /for update/);
  assert.match(migration, /exception when unique_violation/);
  assert.match(migration, /body_hash is distinct from p_body_hash/);
  assert.match(migration, /lease_expires_at <= clock_timestamp\(\)/);
  assert.match(migration, /set lease_expires_at = clock_timestamp\(\)/);
  assert.match(migration, /create or replace function public\.complete_idempotency_record/);
  assert.match(migration, /lease_token = p_lease_token/);
  assert.match(migration, /create or replace function public\.renew_idempotency_record/);
  assert.match(migration, /create or replace function public\.abandon_idempotency_record/);
  assert.match(migration, /revoke all on function public\.reserve_idempotency_record[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.reserve_idempotency_record[\s\S]*to service_role/);
});
