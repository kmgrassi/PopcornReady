# Worksheet: DB-20260731-PR7B-MIGRATION-HOTFIX

<!-- agent-summary: Hotfix the unapplied PR 7B production migration after its first deployment attempt rolled back. -->
<!-- agent-summary: The failure is a PostgreSQL dependency from actions_popcorn_api_rerun_select to root_execution_profile. -->
<!-- agent-summary: Replace every profile-bearing policy before dropping the retired column without using CASCADE. -->
<!-- agent-summary: Preserve the policy's rerun causation checks while switching its child-run predicate to role-only routing. -->
<!-- agent-summary: Validate both a full migration-chain replay and the production-shaped PR 7A to PR 7B transition. -->
<!-- agent-summary: Production remains on the transactional PR 7A bridge until this migration succeeds. -->
<!-- agent-summary: Commit this worksheet, feedback, documentation, migration fix, and targeted regression coverage together. -->

## Goal and acceptance criteria

Create a ready-for-review hotfix PR that allows the unapplied
`20260730190000_retire_root_execution_profile.sql` migration to complete in
production. The migration must remove all profile-bearing dependencies before
dropping the column, retain the existing RLS causation boundary, avoid
`CASCADE`, and prove the profile compatibility surface is absent afterward.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/supabase-identity-and-rls.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `.agent/feedback/ORCH-20260730-PR7B-SCHEMA-RETIREMENT.md`

## Decisions

- Amend migration `20260730190000` in place because production rolled back the
  transaction and did not record that migration version as applied.
- Keep the explicit transaction and dependency-safe non-`CASCADE` column drop.
- Treat the production migration ledger and schema dump as the rollout source
  of truth.
- Preserve the action policy's tool allowlist, Visuals/Audio role boundary, and
  execution/work/project/run/approval-context causation chain; remove only its
  obsolete null-profile predicate.
- Broaden the final catalog assertion to reject profile references in any
  public policy, not only policies on `orchestrator_runs`.

## Changes

- Recreate `actions_popcorn_api_rerun_select` before the profile column drop
  with role-only specialist routing and the original causal fences.
- Add static ordering and predicate coverage plus a post-upgrade catalog
  assertion for the replacement policy.
- Preserve the causation-fenced specialist branch in the role-only
  `orchestrator_runs` select policy so nested action-policy checks can see the
  child run without widening run writes.
- Add positive and negative `SET LOCAL ROLE popcorn_api` visibility probes for
  a causally tied specialist primitive and an unrelated root primitive.
- Record the transactional production rollback and retry boundary in the
  authoritative cutover scope.

## Validation evidence

- Production migration `20260730180000` is recorded and its bridge trigger is
  present.
- Production migration `20260730190000` is not recorded; its first attempt
  failed on policy `actions_popcorn_api_rerun_select` and rolled back.
- Focused static retirement tests pass 3/3, including policy ordering,
  authorization fences, and the no-`CASCADE` drop.
- Migration validation passes for all 97 migration files.
- A clean local stack replay applies the fixed PR 7B migration and the two later
  migrations successfully.
- The production-shaped boundary upgrade applied PR 7B over seeded PR 7A data;
  its legacy/current hierarchy assertions, replacement-policy catalog check,
  and live API route smoke completed before a combined integration invocation
  encountered local PostgREST transaction-pool interference.
- Rerunning the profile-retirement integration alone passed 1/1. Rerunning the
  lifecycle integration serially passed 8/8, including concurrency, refresh,
  budget, stale-pin, callback, blocked-work, recovery, and fan-in coverage.
- The upgrade harness now invokes those integration files sequentially to keep
  their intentional error-path transactions isolated.
- A final clean 97-migration reset completed. Direct catalog checks reported
  `profile_column=false`, `profile_policy=false`, and
  `role_only_action_policy=true`.
- A second end-to-end harness run completed the seeded boundary upgrade, live
  API smoke, and both sequential integration suites, then applied and seeded all
  97 migrations during its final clean replay. Supabase returned a local Docker
  `502` only while restarting containers after the replay.
- `pnpm agent:lint:fix` passes for all seven changed files.
- `pnpm agent:validate -- --scope all` passes workflow policy, migration, RPC
  and relation boundaries, and web/API typechecks.
- Production health still reports API commit `2db09b81`, so the PR 7A-or-newer
  application precondition is not yet satisfied despite the PR merges.
- The amended seeded upgrade applied PR 7B and the real
  `supabase_admin -> popcorn_api` role probe returned `1|1|0`: the causally tied
  specialist run and primitive action were visible, while an unrelated applied
  primitive action on a root remained hidden.
- The live legacy/current API smoke and retirement integration passed with the
  restored run policy. A Docker-loaded lifecycle invocation passed 6/8 and hit
  statement timeouts in two cases; its immediate isolated rerun passed 8/8 in
  2.8 seconds.

## Independent reviews

- Research checkpoint from `pr2_complete` identified the action policy as the
  only dependency not already handled by PR 7B.
- Plan checkpoint approved the policy replacement ordering and authorization
  equivalence, and recommended the runtime catalog assertion now included.
- Implementation review approved the SQL and authorization shape, then asked
  for explicit tool/status-fence assertions; those assertions were added.
- Wrap-up review approved commit/push/ready-PR publication with no remaining
  implementation blocker and confirmed the local Docker `502` occurred after
  the migration replay completed.
- PR review on commit `63a98553` found that the action policy's nested run read
  would fail under the creative-director-only replacement run policy. The
  follow-up plan review approved restoring the original specialist causation
  branch without either retired profile predicate.
- Follow-up implementation review approved the least-privilege run policy and
  confirmed the positive/negative role probe genuinely exercises nested RLS.
- Follow-up wrap-up review approved commit/push with no remaining SQL, RLS,
  fixture, test, or documentation blocker.

## Blockers and risks

- The PR 7B application commit is already deploying while the database remains
  on the PR 7A bridge. This overlap is compatible by design, but the destructive
  cleanup remains incomplete until this hotfix migration succeeds.
- The production API deploy check failed and production still serves commit
  `2db09b81`, older than PR 7A. Merging this hotfix would immediately trigger
  the destructive migration, so the PR must remain unmerged until Railway is
  confirmed on PR 7A (`13adeb69`) or newer everywhere.

## Next action / handoff

Commit, push, and open a ready-for-review PR. Before merge, repair or redeploy
Railway and verify production reports PR 7A (`13adeb69`) or newer. After that
precondition is true, merge the hotfix and verify migration `20260730190000` is
recorded remotely and the retired profile column is absent.
