import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "validate-supabase-migrations.mjs"
);

async function migrationDirectory(t, fileNames) {
  const directory = await mkdtemp(join(tmpdir(), "popcornready-migrations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all(fileNames.map((fileName) => writeFile(join(directory, fileName), "-- test\n")));
  return directory;
}

test("CLI accepts unique 14-digit migration versions and ignores non-SQL files", async (t) => {
  const directory = await migrationDirectory(t, [
    "20260727180500_generic_image_asset_kind_enum.sql",
    "20260727181000_generic_image_asset_kind.sql",
    "README.md",
  ]);

  const result = spawnSync(process.execPath, [scriptPath, directory], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /validation passed \(2 migrations\)/);
});

test("CLI rejects malformed names and duplicate versions before a database connection", async (t) => {
  const directory = await migrationDirectory(t, [
    "20260727180000_domain_run_failure_finalization.sql",
    "20260727180000_generic_image_asset_kind_enum.sql",
    "2026072718100_malformed.sql",
  ]);

  const result = spawnSync(process.execPath, [scriptPath, directory], { encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid Supabase migration filenames/);
  assert.match(result.stderr, /2026072718100_malformed\.sql/);
  assert.match(result.stderr, /Duplicate Supabase migration versions/);
  assert.match(result.stderr, /20260727180000/);
  assert.match(result.stderr, /20260727180000_domain_run_failure_finalization\.sql/);
  assert.match(result.stderr, /20260727180000_generic_image_asset_kind_enum\.sql/);
});
