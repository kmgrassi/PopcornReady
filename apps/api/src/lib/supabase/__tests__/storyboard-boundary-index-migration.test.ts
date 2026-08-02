import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260802123000_storyboard_boundary_status_index.sql"
  ),
  "utf8"
);

test("storyboard boundary polling has a stage and newest-first gate index", () => {
  assert.match(
    migration,
    /create index orchestrator_run_gates_stage_created_run_idx\s+on public\.orchestrator_run_gates\s+\(stage, created_at desc, orchestrator_run_id\)/i
  );
});
