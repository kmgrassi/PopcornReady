import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(testDir, "../../../../../../supabase/migrations/20260715170000_jobs_idempotency_unique.sql"),
  "utf8"
);
const store = readFileSync(resolve(testDir, "../../api/v1/store-composition-jobs.ts"), "utf8");

test("durable job idempotency is tenant-scoped and enforced atomically", () => {
  assert.match(
    migration,
    /partition by workspace_id, project_id, type, idempotency_key/,
    "the forward migration must neutralize pre-existing duplicate keys before adding uniqueness"
  );
  assert.match(
    migration,
    /unique index if not exists jobs_tenant_type_idempotency_uidx\s+on public\.jobs \(workspace_id, project_id, type, idempotency_key\)/
  );
  assert.match(store, /onConflict: "workspace_id,project_id,type,idempotency_key"/);
  assert.match(store, /ignoreDuplicates: true/);
  assert.match(store, /\.eq\("workspace_id", input\.workspaceId\)[\s\S]*?\.eq\("project_id", input\.projectId\)[\s\S]*?\.eq\("type", input\.type\)[\s\S]*?\.eq\("idempotency_key", input\.idempotencyKey\)/);
  assert.match(migration, /drop policy if exists jobs_owner on public\.jobs/);
  assert.match(migration, /drop policy if exists jobs_owner_read on public\.jobs/);
  assert.match(migration, /drop policy if exists jobs_public_read on public\.jobs/);
  assert.doesNotMatch(migration, /create policy jobs_\w+/);
  assert.match(migration, /create or replace function public\.update_active_job/);
  assert.match(migration, /j\.progress \|\| coalesce\(p_progress_patch, '\{\}'::jsonb\)/);
  assert.match(migration, /j\.status in \('queued', 'running'\)/);
  assert.match(migration, /j\.progress #>> '\{recoveryLease,ownerId\}' = p_recovery_lease_owner_id/);
  assert.match(migration, /grant execute on function public\.update_active_job[\s\S]*?to service_role/);
  assert.match(migration, /create or replace function public\.claim_job_recovery/);
  assert.match(migration, /j\.updated_at <= p_stale_before/);
  assert.match(migration, /grant execute on function public\.claim_job_recovery[\s\S]*?to service_role/);
  assert.doesNotMatch(store, /\.eq\("updated_at", input\.job\.updatedAt\)/);
  assert.match(store, /db\.rpc\("claim_job_recovery"/);
});
