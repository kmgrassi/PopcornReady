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

test("PR7A re-terminalizes only active legacy roots and their dispatches", () => {
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

test("PR7A preserves the profile schema for the later destructive deployment", () => {
  assert.doesNotMatch(migration, /drop column(?: if exists)? root_execution_profile/);
  assert.doesNotMatch(migration, /drop function public\.create_orchestrator_run_with_anonymous_quota/);
  assert.doesNotMatch(migration, /drop constraint orchestrator_runs_nonterminal_root_profile_check/);
});
