import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migration = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../../supabase/migrations/20260727183000_claimed_storyboard_bundle.sql"
  ),
  "utf8"
);

test("claimed storyboard bundle commit fences identity, claim, and project CAS state", () => {
  assert.match(migration, /create or replace function public\.commit_claimed_storyboard_bundle/);
  assert.match(migration, /v_job\.action_id is distinct from p_action_id/);
  assert.match(migration, /v_job\.session_claim_generation is distinct from p_session_claim_generation/);
  assert.match(migration, /v_action\.orchestrator_run_id is distinct from p_run_id/);
  assert.match(migration, /v_session\.active_run_id is distinct from p_run_id/);
  assert.match(migration, /v_session\.claim_generation is distinct from p_session_claim_generation/);
  assert.match(migration, /current_story_blueprint_id is distinct from p_expected_current_storyboard_id/);
  assert.match(migration, /v_plan_selection\.seq is distinct from p_expected_plan_selection_seq/);
  assert.match(migration, /v_plan_selection\.active_asset_id is distinct from p_plan_asset_id/);
});

test("claimed storyboard bundle revalidates preserved panels and commits atomically", () => {
  assert.match(migration, /sp\.id = \(v_item ->> 'panelId'\)::uuid/);
  assert.match(migration, /sp\.image_asset_id = \(v_item ->> 'assetId'\)::uuid/);
  assert.match(migration, /sp\.is_selected/);
  assert.match(migration, /params -> 'provenance' ->> 'beatId'/);
  assert.match(migration, /insert into public\.assets/);
  assert.match(migration, /insert into public\.story_blueprints/);
  assert.match(migration, /insert into public\.story_beats/);
  assert.match(migration, /insert into public\.story_panels/);
  assert.match(migration, /set current_story_blueprint_id = p_storyboard_id/);
  assert.match(migration, /update public\.jobs[\s\S]*status = 'succeeded'/);
});

test("claimed storyboard bundle validates complete plan-to-panel integrity before inserts", () => {
  const integrity = migration.indexOf("Reconstruct the complete active-plan beat manifest");
  const firstInsert = migration.indexOf("insert into public.assets");
  assert.ok(integrity >= 0 && integrity < firstInsert);
  assert.match(migration, /v_submitted_beats/);
  assert.match(migration, /v_submitted_scenes/);
  assert.match(migration, /complete active-plan scene manifest/);
  assert.match(migration, /scene rows do not match the active plan/);
  assert.match(migration, /storyboard rows do not cover the complete active plan/);
  assert.match(migration, /storyboard row coordinates do not match the active plan/);
  assert.match(migration, /storyboard panel asset does not match its active-plan beat/);
  assert.match(migration, /each new storyboard asset must back exactly one plan beat/);
  assert.match(migration, /each preserved storyboard asset must back exactly one plan beat/);
  assert.match(migration, /asset_graph_canonical_jsonb_text/);
  assert.match(migration, /require exactly one active-plan input edge/);
  assert.match(migration, /inputs fingerprint is invalid/);
});

test("claimed storyboard bundle replay is durable, exact, and service-role-only", () => {
  const replay = migration.indexOf("Replay is checked before active ownership");
  const activeCheck = migration.indexOf("v_job.status not in ('queued', 'running')");
  assert.ok(replay >= 0 && replay < activeCheck);
  assert.match(migration, /bundleFingerprint/);
  assert.match(migration, /provenance -> 'assetIds'/);
  assert.match(migration, /storyboard bundle replay does not match the committed payload/);
  assert.match(
    migration,
    /revoke all on function public\.commit_claimed_storyboard_bundle[\s\S]*from public, anon, authenticated/
  );
  assert.match(
    migration,
    /grant execute on function public\.commit_claimed_storyboard_bundle[\s\S]*to service_role/
  );
});
