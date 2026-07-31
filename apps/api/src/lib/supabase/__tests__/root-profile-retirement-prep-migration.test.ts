import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../../../supabase/migrations/20260730180000_prepare_root_profile_retirement.sql",
    import.meta.url
  ),
  "utf8"
);

test("PR7A installs a root-aware rolling compatibility trigger", () => {
  assert.match(
    migration,
    /before insert on public\.orchestrator_runs[\s\S]*fill_creative_director_root_profile/
  );
  assert.match(
    migration,
    /new\.agent_role = 'creative_director'[\s\S]*new\.root_execution_profile is null[\s\S]*new\.root_execution_profile := 'creative_director'/
  );
  assert.doesNotMatch(
    migration,
    /if new\.root_execution_profile is null then\s+new\.root_execution_profile/
  );
});

test("PR7A re-terminalizes active legacy roots and closes their dispatches", () => {
  assert.match(
    migration,
    /root_execution_profile is distinct from 'creative_director'[\s\S]*status in \('queued', 'running', 'waiting'\)[\s\S]*cancel_orchestrator_run_family/
  );
  assert.match(
    migration,
    /with recursive legacy_family[\s\S]*update public\.orchestrator_dispatches[\s\S]*status = 'completed'/
  );
  assert.doesNotMatch(migration, /update public\.orchestrator_runs[\s\S]*set root_execution_profile/);
});

test("PR7A closes terminal legacy review gates before role-only routing", () => {
  assert.match(
    migration,
    /update public\.orchestrator_run_gates g[\s\S]*from public\.orchestrator_runs r[\s\S]*r\.agent_role = 'creative_director'[\s\S]*r\.root_execution_profile is distinct from 'creative_director'[\s\S]*r\.status in \('succeeded', 'failed', 'canceled', 'timed_out', 'superseded'\)[\s\S]*g\.status = 'reached'/
  );
  assert.match(
    migration,
    /set status = 'rejected',[\s\S]*decided_at = coalesce\(g\.decided_at, now\(\)\)/
  );
});

test("PR7A makes legacy insufficient-credit failures ineligible for retry", () => {
  assert.match(
    migration,
    /update public\.orchestrator_runs r[\s\S]*set status = 'canceled',[\s\S]*r\.status = 'failed'[\s\S]*r\.error ->> 'kind' = 'insufficient_credits'/
  );
  assert.match(
    migration,
    /latest\.orchestrator_run_id = r\.id[\s\S]*latest\.status = 'failed'[\s\S]*latest\.superseded_at is null[\s\S]*order by latest\.created_at desc, latest\.id desc[\s\S]*a\.error ->> 'kind' = 'insufficient_credits'/
  );
  const store = readFileSync(new URL("../../api/v1/orchestrator-store.ts", import.meta.url), "utf8");
  assert.match(
    store,
    /store\.listRunActions[\s\S]*\.order\("created_at", \{ ascending: true \}\)[\s\S]*\.order\("id", \{ ascending: true \}\)/
  );
  assert.doesNotMatch(migration, /update public\.actions[\s\S]*set superseded_at/);
});

test("PR7A preserves the profile schema for the later destructive deployment", () => {
  assert.doesNotMatch(migration, /drop column(?: if exists)? root_execution_profile/);
  assert.doesNotMatch(migration, /drop function public\.create_orchestrator_run_with_anonymous_quota/);
  assert.doesNotMatch(migration, /drop constraint orchestrator_runs_nonterminal_root_profile_check/);
});
