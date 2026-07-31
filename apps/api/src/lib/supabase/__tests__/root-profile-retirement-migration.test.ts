import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../../../supabase/migrations/20260730190000_retire_root_execution_profile.sql",
    import.meta.url
  ),
  "utf8"
);

test("PR7B classifies and structurally retires legacy families before dropping the profile", () => {
  const transaction = migration.indexOf("begin;");
  const lock = migration.indexOf(
    "lock table public.orchestrator_runs in access exclusive mode"
  );
  const snapshot = migration.indexOf("insert into pr7b_legacy_roots");
  const cancel = migration.indexOf(
    "perform public.cancel_orchestrator_run_family"
  );
  const rejectGates = migration.indexOf(
    "update public.orchestrator_run_gates gate"
  );
  const supersede = migration.indexOf(
    "update public.orchestrator_runs run"
  );
  const assertions = migration.indexOf(
    "PR7B active legacy family runs remain"
  );
  const dropColumn = migration.indexOf(
    "drop column root_execution_profile"
  );
  const commit = migration.lastIndexOf("commit;");
  assert.ok(
    transaction >= 0 &&
      lock > transaction &&
      snapshot > lock &&
      cancel > snapshot &&
      rejectGates > cancel &&
      supersede > rejectGates &&
      assertions > supersede &&
      dropColumn > assertions &&
      commit > dropColumn
  );
  assert.match(
    migration,
    /set status = 'superseded',[\s\S]*superseded_at = coalesce\(run\.superseded_at, now\(\)\)/
  );
  assert.match(
    migration,
    /gate\.status in \('pending', 'reached'\)/
  );
  assert.match(
    migration,
    /active legacy rerun executions remain[\s\S]*active legacy rerun work items remain[\s\S]*pending legacy rerun callbacks remain/
  );
});

test("PR7B makes supersession irreversible in the existing immutable guard", () => {
  assert.match(
    migration,
    /create or replace function public\.orchestrator_runs_guard_immutable\(\)[\s\S]*old\.status = 'superseded'[\s\S]*new\.status is distinct from 'superseded'[\s\S]*check_violation/
  );
  for (const field of [
    "project_id",
    "agent_role",
    "agent_session_id",
    "session_sequence",
    "task_kind",
    "task_params",
    "origin_kind",
    "parent_run_id",
    "root_action_id",
    "origin_actor_id",
    "origin_request",
    "continues_run_id",
    "pins",
  ]) {
    assert.match(migration, new RegExp(`old\\.${field}`));
  }
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf(
        "create or replace function public.orchestrator_runs_guard_immutable"
      ),
      migration.indexOf(
        "-- Restore the pre-profile anonymous RPC shape"
      )
    ),
    /root_execution_profile/
  );
});

test("PR7B replaces profile-bound routines, policies, and grants before a no-CASCADE drop", () => {
  assert.match(
    migration,
    /drop function public\.create_orchestrator_run_with_anonymous_quota\([\s\S]*uuid, text, double precision, timestamptz, integer, text, text, text/
  );
  assert.match(
    migration,
    /create function public\.create_orchestrator_run_with_anonymous_quota\([\s\S]*p_git_sha text default null\s*\)[\s\S]*insert into public\.orchestrator_runs \([\s\S]*deploy_id, git_sha\s*\)/
  );
  const reserveStart = migration.indexOf(
    "create or replace function public.reserve_rerun_proposal_execution"
  );
  const policyStart = migration.indexOf(
    "-- Remove profile-bearing RLS",
    reserveStart
  );
  assert.ok(reserveStart >= 0 && policyStart > reserveStart);
  assert.doesNotMatch(
    migration.slice(reserveStart, policyStart),
    /root_execution_profile/
  );
  const actionsPolicyStart = migration.indexOf(
    "drop policy if exists actions_popcorn_api_rerun_select",
    policyStart
  );
  const runPolicyStart = migration.indexOf(
    "drop policy if exists orchestrator_runs_popcorn_api_rerun_select",
    actionsPolicyStart
  );
  const dropColumn = migration.indexOf(
    "drop column root_execution_profile",
    runPolicyStart
  );
  assert.ok(
    actionsPolicyStart > policyStart &&
      runPolicyStart > actionsPolicyStart &&
      dropColumn > runPolicyStart
  );
  const actionsPolicyReplacement = migration.slice(
    actionsPolicyStart,
    runPolicyStart
  );
  assert.doesNotMatch(actionsPolicyReplacement, /root_execution_profile/);
  for (const causationPredicate of [
    "'rerun_proposal', 'rerun_proposal_approval', 'rerun_work_item_dispatch'",
    "'rerun_reconciliation', 'rerun_execution', 'domain_report'",
    "tool <> 'domain_report'",
    "status in ('running', 'applied')",
    "child.agent_role in ('visuals', 'audio')",
    "execution.root_run_id = child.parent_run_id",
    "work.dispatch_action_id = child.root_action_id",
    "child.id = actions.orchestrator_run_id",
    "child.project_id = actions.project_id",
    "{approvalContext,executionReservationId}",
    "{approvalContext,proposalActionId}",
  ]) {
    assert.ok(actionsPolicyReplacement.includes(causationPredicate));
  }
  assert.match(
    migration,
    /create policy orchestrator_runs_popcorn_api_rerun_select[\s\S]*using \(agent_role = 'creative_director'\)/
  );
  assert.match(
    migration,
    /grant select \([\s\S]*agent_role, budget_usd, spent_usd, origin_kind[\s\S]*grant insert \([\s\S]*agent_role\s*\)/
  );
  assert.match(
    migration,
    /drop trigger if exists orchestrator_runs_fill_root_profile[\s\S]*drop function if exists public\.fill_creative_director_root_profile/
  );
  assert.match(migration, /notify pgrst, 'reload schema'/);
  assert.doesNotMatch(
    migration,
    /drop (?:column|function|constraint|trigger|policy)[^;]*\bcascade\b/i
  );
});
