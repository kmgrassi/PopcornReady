import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260728160000_parallel_domain_dispatch.sql"
);

test("parallel dispatch migration atomically creates both domain children and defers fan-in", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create_domain_run_dispatch_batch/);
  assert.match(migration, /jsonb_array_length\(p_assignments\) <> 2/);
  assert.match(migration, /create_domain_run_dispatch\(/);
  assert.match(migration, /keep_parallel_delegation_join_open/);
  assert.match(migration, /child\.root_action_id = new\.id/);
  assert.match(migration, /new\.status := 'running'/);
});
