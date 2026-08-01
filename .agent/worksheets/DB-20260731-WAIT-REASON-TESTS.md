# Worksheet: DB-20260731-WAIT-REASON-TESTS

<!-- agent-summary: Durable record for real-Postgres finite-run wait-reason regression coverage. -->
<!-- agent-summary: The merged runtime fix is verified against the actual local database constraint. -->
<!-- agent-summary: The matrix covers finite Visuals and Audio runs plus Creative Director roots. -->
<!-- agent-summary: Store updates and resume claims exercise the TypeScript-to-Postgres boundary. -->
<!-- agent-summary: Invalid cross-field lifecycle shapes must fail with the named database constraint. -->
<!-- agent-summary: This PR adds tests only and does not alter production schema behavior. -->
<!-- agent-summary: Link reviews, validation, feedback, and the ready PR here. -->

## Goal and acceptance criteria

Add observable local-Postgres regression tests for `orchestrator_runs_wait_reason_shape` and the production store seam. Prove finite Visuals/Audio waits require and round-trip semantic reasons, roots preserve their narrower compatibility rules, non-waiting runs reject retained reasons, and resume claims atomically clear the reason. Publish the tests in a separate ready PR based on the merge of PR #861.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, `docs/repository-structure.md`
- `docs/supabase-identity-and-rls.md`, `docs/scopes/database-access-boundary.md`
- `docs/scopes/orchestrator-step-durability.md`
- `docs/agent-system/testing-policy.md`, `docs/agent-system/false-confidence-audits.md`

## Decisions

- Keep this PR test-only; broader lease/status constraints require a separately reviewed schema change.
- Exercise both raw database constraint behavior and the public orchestrator-store update/claim functions.
- Add a dedicated serial local-Supabase command; do not represent the opt-in test as automatic CI coverage.

## Changes

- Created this worksheet on a clean branch from merged PR #861.
- Added a focused local-Postgres matrix for Visuals, Audio, and Creative Director wait-reason shapes.
- Added production store round-trips and atomic resume/CAS assertions.
- Documented and scripted the exact opt-in local command.
- Addressed the PR review by adding the documentation contract's seven durable
  `agent-summary` lines to the materially updated orchestrator scope.

## Validation evidence

- `pnpm --filter @popcorn/api typecheck` — passed.
- Normal test discovery — both local-Postgres cases skipped without the opt-in flag.
- `pnpm db:local:reset` — applied the full local migration chain successfully.
- `pnpm db:test:orchestrator-wait-reasons:local` — 2/2 passed against local Postgres.
- False-confidence audit — temporarily dropped the mapped wait reason; the finite-run
  test failed with SQLSTATE `23514` and `orchestrator_runs_wait_reason_shape`.
  Restored production code and reran the suite 2/2 passing.
- Local API application path — started on port 4012 with local Supabase and
  `GET /api/v1/health` returned `status: ok`.
- `pnpm agent:lint:fix` — passed for all five changed files.
- `pnpm agent:validate -- --scope api` — passed, including agent lint, workflow
  policy, migration, RPC/relation-boundary, and API typecheck checks.
- PR comment follow-up: `pnpm agent:lint:fix` passed for the three documentation
  files, then `pnpm agent:validate -- --scope api` passed again. The local database
  suite was not rerun because product behavior, tests, and schema are unchanged.

## Independent reviews

- Research/plan: `/root/wait_reason_db_test_review` approved the focused boundary and required explicit local-command reachability, persisted-row assertions, named `23514` failures, unchanged-state checks, both domain roles, and cleanup verification.
- Implementation: `/root/wait_reason_impl_review` requested a truly concurrent
  resume race and partial-fixture cleanup. Both were added; re-review approved
  with no remaining findings.
- Wrap-up: `/root/wait_reason_wrap_review` approved the test-only scope,
  constraint/store/CAS coverage, cleanup, documentation, and validation evidence
  with no actionable findings.
- PR comment research/plan: `/root/wait_reason_db_test_review` approved adding
  exactly seven system-contract summaries and keeping validation comment-scoped.
- PR comment implementation: `/root/wait_reason_impl_review` approved the exact
  seven summaries and the worksheet/feedback updates with no findings.
- PR comment wrap-up: `/root/wait_reason_wrap_review` approved the three-file
  documentation-only diff for commit, push, and thread resolution.

## Blockers and risks

- Local database integration tests require a healthy local Supabase stack and opt-in environment variables.

## Next action / handoff

- Ready PR: https://github.com/kmgrassi/PopcornReady/pull/862
