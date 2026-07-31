import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260731113000_pooled_image_regeneration_inputs.sql"
);

test("pooled image regeneration persists approved inputs behind the domain claim fence", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const oldSignature = /drop function if exists public\.regenerate_asset_version_pooled\(\s*uuid, uuid, text, text, text, jsonb, text, double precision, uuid, uuid, bigint\s*\);/;
  const newSignature = /public\.regenerate_asset_version_pooled\(\s*uuid, uuid, text, text, text, jsonb, text, double precision, uuid, uuid, bigint, jsonb\s*\)/;
  assert.match(migration, oldSignature);
  assert.match(migration, /p_inputs jsonb default null/);
  assert.match(migration, /v_effective_inputs := coalesce\(p_inputs, v_old\.inputs/);
  assert.match(migration, /s\.claim_generation = p_session_claim_generation/);
  assert.match(migration, /v_old\.content, v_effective_params, v_effective_inputs/);
  assert.match(migration, /from jsonb_array_elements\(v_effective_inputs\)/);
  assert.match(migration, new RegExp(`revoke all on function ${newSignature.source}[\\s\\S]*from public, anon, authenticated`));
  assert.match(migration, new RegExp(`grant execute on function ${newSignature.source}[\\s\\S]*to service_role`));
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:public|anon|authenticated)/);
});
