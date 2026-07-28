import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260728170000_root_execution_profile.sql"
);

test("root execution profile is constrained and cannot change after a run starts", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /add column root_execution_profile text/);
  assert.match(migration, /root_execution_profile in \('flat', 'creative_director'\)/);
  assert.match(migration, /agent_role = 'creative_director' or root_execution_profile is null/);
  assert.match(migration, /old\.root_execution_profile is not null[\s\S]*new\.root_execution_profile is distinct from old\.root_execution_profile/);
  assert.match(migration, /old\.root_execution_profile is null[\s\S]*old\.started_at is not null/);
  assert.match(migration, /drop function public\.create_orchestrator_run_with_anonymous_quota/);
  assert.match(migration, /p_root_execution_profile text default 'creative_director'/);
  assert.match(migration, /p_root_execution_profile is null[\s\S]*not in \('flat', 'creative_director'\)/);
  assert.match(migration, /root_execution_profile\s*\) values[\s\S]*p_root_execution_profile/);
});
