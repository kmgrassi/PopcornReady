# Worksheet: ORCH-20260730-PR7B-SCHEMA-RETIREMENT

<!-- agent-summary: PR 7B is the destructive schema retirement stacked on PR 7A head 06c4b363. -->
<!-- agent-summary: Deployment is forbidden until every production application instance runs PR 7A or newer. -->
<!-- agent-summary: Historical flat/null roots must become structurally non-resumable before profile metadata is dropped. -->
<!-- agent-summary: The migration terminalizes active legacy families and closes legacy gate and credit-retry reopen paths. -->
<!-- agent-summary: The migration removes root_execution_profile and every dependent compatibility database surface. -->
<!-- agent-summary: Validation requires clean reset, PR 7A-to-PR 7B upgrade, real API smoke, and full repository checks. -->
<!-- agent-summary: This PR is published ready for review but is never deployed or merged by the implementing agent. -->

## Goal and acceptance criteria

Complete only the destructive second phase of the selective-regeneration
cutover:

- fence historical flat/null roots so gate approval and credit retry cannot
  reopen them after profile metadata disappears;
- safely terminalize any remaining active legacy root family and dispatch;
- drop the PR 7A compatibility trigger/function, profile-bound constraints,
  policies, grants, routine signatures, and `root_execution_profile`;
- reload the PostgREST schema cache;
- remove the PR 7A transitional readiness allowance and update tests;
- prove both a clean migration replay and an upgrade from the PR 7A schema;
- run API health and retired-route smokes; and
- update authoritative docs and feedback with an explicit rollout precondition.

## Stack and rollout boundary

Branch: `codex/selective-regen-pr7b-schema-retirement`

Base: PR 7A head `06c4b363`

PR target: `codex/selective-regen-pr7-cleanup`

PR 7B may merge only after PR 7A is fully deployed. Rolling back after the
column drop must use a forward deploy of a PR 7A-compatible application; an
older binary that reads or writes the removed profile is not safe.

## Research notes

- The profile column owns three checks, the PR 7A fill trigger/function, two
  `popcorn_api` column grants, and three rerun policies.
- `orchestrator_runs_guard_immutable()` reads the profile and must be replaced
  while preserving every other assignment-identity fence.
- Anonymous quota admission currently has one eight-argument profile-bearing
  signature. PR 7B must replace it with the unambiguous seven-argument RPC the
  PR 7A application already calls.
- The retired service-role
  `reserve_rerun_proposal_execution(uuid,uuid,uuid,text,text,double
  precision,text)` body still inserts/selects the profile. Preserve its
  signature and ACL but replace its body with role-only root logic so the
  destructive drop cannot leave a latent broken routine.
- Storyboard approval can reopen a succeeded run with a reached after-gate.
  Credit retry can reopen a failed run if either the run or its last failed
  action records `insufficient_credits`.
- The irreversible structural marker is `status='superseded'` paired with
  `superseded_at`. Unresolved gates for the complete legacy family must also be
  rejected before the profile is removed.
- The migration must classify legacy roots while holding an exclusive run-table
  lock, then assert no active family work, unresolved gates, live dispatches,
  session claims, jobs, or reservations remain.
- PR 7A readiness intentionally tolerates the temporary profile grants. PR 7B
  removes the allowance and resumes exact privilege auditing.

## Plan

1. Add a forward-only `20260730190000` migration. Take an `ACCESS EXCLUSIVE`
   run-table lock; snapshot legacy root identities and their recursive family;
   causally cancel each family; reject unresolved family gates; supersede
   legacy succeeded/failed roots; complete dispatches; and fail with actionable
   ids if any active run, gate, dispatch, job, session claim, budget reservation,
   rerun execution/work item, or callback remains.
2. Replace the immutable guard, anonymous quota RPC, service-role rerun
   reservation RPC, exact `popcorn_api` grants, and rerun policies without
   profile references.
3. Fold a permanent `superseded`-status reopen fence into the replacement
   immutable guard, while allowing metadata-only updates that preserve
   `superseded`. Keep the old profile fence until cleanup assertions pass.
4. Drop the PREP bridge, three profile checks, and profile column without
   `CASCADE`; assert the retired catalog objects are absent and notify PostgREST
   to reload its schema.
5. Add static migration/readiness tests and update profile-bearing integration
   fixtures. Prove clean replay and a seeded PR 7A-to-PR 7B upgrade locally.
   The upgrade includes legacy and valid hierarchy controls: legacy storyboard
   approval may return 202 but cannot change superseded status or enqueue;
   legacy credit retry fails validation; valid hierarchy approval/retry still
   work; direct SQL cannot reopen a superseded row; and both the seven-argument
   anonymous RPC and role-only reserve RPC execute after retirement.
6. Run the API health and retired-route smoke, focused lifecycle tests,
   typecheck, lint, full validation, and all four independent review checkpoints.

## Implementation and validation

- Added `20260730190000_retire_root_execution_profile.sql` with locked legacy
  classification, canonical family cancellation, unresolved-gate closure,
  active rerun callback/work/execution cancellation, root supersession,
  actionable pre-drop assertions, role-only routine/policy/grant replacement,
  no-`CASCADE` profile removal, catalog assertions, and PostgREST reload.
- Added the irreversible superseded-state fence to
  `orchestrator_runs_guard_immutable()` while retaining every assignment field.
- Creator-direct readiness now rejects every unexpected run-column privilege;
  the PR 7A transitional profile allowance is gone.
- Updated the lifecycle integration fixtures for the profile-free schema and
  added static plus local-database retirement tests.
- Added `pnpm db:test:pr7b-upgrade`, an executable destructive-local harness
  that resets to the PR 7A boundary, seeds legacy and current hierarchy
  controls, applies PR 7B, exercises the live approval/retry and retired-route
  APIs, runs both profile-free database integration suites, and finishes with a
  clean reset.
- Updated North Star, domain contract, rollout, cutover scope, testing
  inventory, worksheet, and feedback.
- Static migration/readiness tests pass 13/13.
- The focused suite passes 13 tests with nine local-database tests correctly
  skipped before the Supabase stack is available.
- API typecheck passes.
- Migration filename/version validation passes for 95 migrations.
- `pnpm agent:lint:fix` passes.
- Full `pnpm agent:validate` passes.
- Docker Desktop briefly reported engine `29.0.1`, but the first clean reset
  stalled for more than three minutes and a concurrent `docker ps` also
  blocked. The harness was terminated cleanly without removing a container,
  image, or volume. Per the bounded-runtime fallback, clean reset, upgrade,
  local integrations, and API smoke remain pending on a healthy Docker runtime;
  the ready PR must obtain its required GitHub smoke before handoff.

## Independent reviews

- Research review found the profile-bound guard, anonymous and reserve RPCs,
  exact grants/policies, and both terminal reopen paths.
- Plan review approved after requiring the permanent superseded fence to live
  in the existing immutable guard, retention of the service-role reserve RPC,
  pre-drop active rerun assertions, and valid hierarchy positive controls.
- Implementation re-review found and resolved two harness issues: the live API
  now disables the recovery worker, and legacy approval must leave its dispatch
  exactly `completed|0`.
- Wrap-up review found no remaining static code or documentation issue. It
  withheld merge/deploy approval only until the executable upgrade harness (or
  equivalent GitHub database smoke) passes on a healthy runtime.

## Handoff

Do not deploy or merge. Verify the rollout precondition first.
