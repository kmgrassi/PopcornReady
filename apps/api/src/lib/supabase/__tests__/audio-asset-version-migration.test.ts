import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260727190000_audio_asset_version_rpc.sql"
  ),
  "utf8"
);

test("audio revisions preserve lineage, serialize version allocation, and require a source edge", () => {
  assert.match(migration, /create or replace function public\.mint_audio_asset_version/);
  assert.match(
    migration,
    /v_source\.media <> 'audio'[\s\S]*v_source\.kind <> 'audio_track'[\s\S]*v_source\.status <> 'ready'/
  );
  assert.match(migration, /item->>'assetId' = p_source_asset_id::text[\s\S]*item->>'role' = 'source'/);
  assert.match(
    migration,
    /pg_advisory_xact_lock\(hashtextextended\(v_source\.lineage_id::text, 0\)\)[\s\S]*select \* into v_source[\s\S]*for update/
  );
  assert.match(migration, /where lineage_id = v_source\.lineage_id[\s\S]*max\(version\)/);
  assert.match(migration, /\(p_asset->>'id'\)::uuid/);
  assert.match(migration, /v_source\.lineage_id,\s+v_next_version/);
  assert.match(migration, /created_by_action_id[\s\S]*p_action_id/);
});

test("audio revision minting never moves selections and is service-role-only", () => {
  assert.doesNotMatch(migration, /insert into public\.selections/i);
  assert.doesNotMatch(migration, /update public\.selections/i);
  assert.match(
    migration,
    /revoke all on function public\.mint_audio_asset_version[\s\S]*from public, anon, authenticated/
  );
  assert.match(
    migration,
    /grant execute on function public\.mint_audio_asset_version[\s\S]*to service_role/
  );
});

test("audio revision minting preserves subtype, role, and spoken copy under the source lock", () => {
  assert.match(
    migration,
    /v_source\.params #>> '\{provenance,providerSettings,audioMode\}'/
  );
  assert.match(
    migration,
    /audio_revision_subtype_change_forbidden/
  );
  assert.match(
    migration,
    /audio_revision_role_change_forbidden/
  );
  assert.match(
    migration,
    /audio_revision_spoken_words_change_forbidden/
  );
  assert.match(
    migration,
    /v_source\.params #>> '\{provenance,providerPrompt\}'[\s\S]*p_asset #>> '\{params,provenance,providerPrompt\}'/
  );
  assert.match(
    migration,
    /for update[\s\S]*Re-evaluate the trusted source subtype[\s\S]*audio_revision_locked_source_constraint_failed/
  );
  assert.match(
    migration,
    /audio_revision_locked_spoken_words_change_forbidden/
  );
});
