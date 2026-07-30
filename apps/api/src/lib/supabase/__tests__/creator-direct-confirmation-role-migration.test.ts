import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260730131500_creator_direct_confirmation_role.sql"
  ),
  "utf8"
);
const roles = readFileSync(
  resolve(testDir, "../../../../../../supabase/roles.sql"),
  "utf8"
);

test("creator-direct role remains RLS-bound with column-scoped grants", () => {
  assert.match(roles, /create role popcorn_api[\s\S]*nologin[\s\S]*nobypassrls/i);
  assert.match(migration, /create role popcorn_api[\s\S]*nobypassrls/i);
  assert.match(migration, /grant select \(id, workspace_id\)[\s\S]*public\.projects/i);
  assert.match(migration, /grant update \(updated_at\)[\s\S]*public\.orchestrator_runs/i);
  assert.match(migration, /grant update \(status, token_consumed_at, decided_at, updated_at\)[\s\S]*public\.orchestrator_run_gates/i);
  assert.match(migration, /grant insert \(scope, key, body_hash, status, response_body\)[\s\S]*public\.idempotency/i);
  assert.doesNotMatch(migration, /grant all/i);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete) on table public\.[a-z_]+ to popcorn_api/i);
});

test("creator-direct role policies and routine grants stay workflow-scoped", () => {
  assert.match(migration, /origin_kind = 'creator_direct'/);
  assert.match(migration, /gate_kind = 'creator_direct_proposal'/);
  assert.match(migration, /scope like 'creator-direct-confirm:%'/);
  assert.match(migration, /grant execute on function public\.reserve_orchestrator_run_budget/);
  assert.match(migration, /grant execute on function public\.wake_orchestrator_dispatch/);
});
