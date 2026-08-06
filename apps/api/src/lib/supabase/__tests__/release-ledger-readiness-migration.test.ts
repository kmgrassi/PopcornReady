import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../../../../../supabase/migrations/20260804154000_release_ledger_readiness.sql",
  import.meta.url,
);

test("release readiness grants only migration-version metadata to popcorn_api", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /grant usage on schema supabase_migrations to popcorn_api/);
  assert.match(
    migration,
    /revoke all on table supabase_migrations\.schema_migrations from popcorn_api/,
  );
  assert.match(
    migration,
    /grant select \(version\)\s+on table supabase_migrations\.schema_migrations to popcorn_api/,
  );
  assert.doesNotMatch(migration, /grant select on table/);
  assert.doesNotMatch(migration, /grant .*\((?:name|statements)\)/i);
  assert.doesNotMatch(migration, /service_role|security definer/i);
});
