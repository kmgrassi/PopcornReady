# Worksheet: API-20260809-LARGE-FILE-REFACTOR

<!-- agent-summary: Durable record for the daily large-file refactor. -->
<!-- agent-summary: Work reservation and callback transactions are separated by responsibility. -->
<!-- agent-summary: Existing public imports remain compatible through re-exports. -->
<!-- agent-summary: Validation covers direct lifecycle behavior and API repository checks. -->
<!-- agent-summary: The task includes an open pull request for review. -->
<!-- agent-summary: No browser-facing behavior changed. -->
<!-- agent-summary: Independent external reviewer availability is recorded below. -->

## Goal and acceptance criteria

Refactor the >1,000-line rerun transaction module into smaller cohesive files
without changing its public behavior. Preserve existing imports, run focused
tests and API validation, commit the worksheet and feedback, and open a
non-draft pull request.

## Context and source-of-truth documents

- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/scopes/database-access-boundary.md`
- `docs/agent-system/worksheets-and-feedback.md`

## Decisions

- Keep reservation, parking, completion, and failure in
  `rerun-work-transactions.ts`.
- Move callback recording and child-budget admission to
  `rerun-callback-transactions.ts`.
- Move canonical JSON comparison into the shared rerun lifecycle helper.
- Re-export moved functions from the original module to avoid widening the
  caller diff.

## Changes

- [x] Extract callback and child-budget transactions.
- [x] Update validation evidence and feedback after checks.
- [ ] Commit, tag, push, and open the PR.

## Validation evidence

- `wc -l`: original work module is now 834 lines; the new callback module is
  185 lines.
- `pnpm --filter @popcorn/api exec tsx --test --test-concurrency=1
  src/lib/postgres/__tests__/rerun-lifecycle-direct.integration.test.ts`:
  loaded 2 tests; both were skipped because local database integration was not
  enabled.
- `pnpm --filter @popcorn/api typecheck`: passed.
- `pnpm agent:lint:fix`: passed.
- `pnpm agent:validate -- --scope api`: passed, including API typecheck,
  migration, RPC-boundary, relation-boundary, and workflow checks.
- `git diff --check`: passed after lint repair.

## Independent reviews

`pnpm agent:review -- implementation API-20260809-LARGE-FILE-REFACTOR` was
attempted, but `AGENT_REVIEW_COMMAND` is not configured (exit 3). Local review
covered the diff, compatibility re-exports, dependency direction, and API
typecheck; no behavior or cycle issue was found.

## Blockers and risks

The direct Postgres integration test may be environment-gated by local
database credentials; record the exact result rather than treating a skipped
integration as a passing runtime proof.

## Next action / handoff

Commit the implementation, worksheet, and feedback, tag the worksheet, push
the branch, and publish an open PR.
