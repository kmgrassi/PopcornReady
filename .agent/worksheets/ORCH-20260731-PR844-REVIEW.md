# Worksheet: ORCH-20260731-PR844-REVIEW

<!-- agent-summary: Follow-up record for the four review findings on PR 844. -->
<!-- agent-summary: Rerun evidence reads are limited to causally bound specialist work. -->
<!-- agent-summary: Concurrent refresh replay returns the persisted successor envelope. -->
<!-- agent-summary: Late cancellation preserves the already-persisted terminal outcome. -->
<!-- agent-summary: Focused tests and the API validation gate are recorded below. -->
<!-- agent-summary: The PR branch is rebased onto current main before handoff. -->
<!-- agent-summary: Use worksheet/ORCH-20260731-PR844-REVIEW as the completion tag. -->

## Goal and acceptance criteria

Address all four unresolved Codex review threads on PR 844, prove the corrected
database and service behavior, rebase the branch onto current `origin/main`,
and push the updated ready-for-review PR branch.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`, `docs/NORTH_STAR.md`
- `docs/supabase-identity-and-rls.md`
- `docs/scopes/database-access-boundary.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `apps/api/src/lib/tool-tests/README.md`
- `.agent/worksheets/ORCH-20260729-PR2-LIFECYCLE.md`

## Decisions

- Grant `popcorn_api` visibility by durable rerun causation rather than a broad
  primitive-tool allowlist.
- Admit only Visuals/Audio children whose parent root, dispatch action, project,
  proposal, and execution reservation match a rerun work item.
- Reload the durable successor after a concurrent create reports replay.
- Return the existing terminal execution outcome when cancellation arrives too
  late, so the API never reports a successful execution as canceled.

## Changes

- Restricted direct-role primitive action and specialist child reads to rows
  whose project, parent root, dispatch action, proposal, and execution
  reservation match durable rerun work.
- Reloaded the persisted successor after concurrent successor creation replays
  another request's winner.
- Changed cancellation to project the persisted terminal execution outcome;
  successful work remains `applied` with `canceled: false` when cancellation is
  late.
- Added explicit UUID-array/run casts in primitive causation reads and removed
  an unnecessary `ON CONFLICT` clause that required broader `action_assets`
  read privileges.
- Added service race/late-cancel tests, static policy assertions, and a positive
  local `popcorn_api` integration path for child/report/primitive/budget/output
  causation.
- Updated the database boundary documentation and task-scoped feedback record.

## Validation evidence

- Focused API suite: 40 passed, including lifecycle service, semantic output,
  readiness, typed proposal transactions, migration policy, and HTTP contract.
- Exact local `popcorn_api` integration: 1 passed after a clean 90-migration
  Supabase reset; it covered the positive specialist/primitive path and late
  cancellation after successful finalization.
- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/shared typecheck` — passed.
- `pnpm db:migrations:validate` — passed with 90 migrations.
- RPC boundary test/validation — passed at 48 production targets across 47
  expressions.
- Relation boundary test/validation — passed at 424 literal calls and zero
  dynamic calls. An initial mistyped command name failed before the documented
  `db:relations:test` and `db:relations:validate` commands passed.
- Development API application path on port 4012 returned `status: ok` from
  `/api/v1/health` with local auth and the Creative Director hierarchy enabled.
  The background worker logged expected missing-Supabase configuration because
  this worktree has no local service credentials.
- `pnpm agent:lint:fix` — passed for 11 changed files.
- `pnpm agent:validate -- --scope api` — passed.
- Rebased all five branch commits cleanly onto the latest `origin/main` with no
  conflicts. On the rebased commit, the 40-test focused suite, API/shared
  typechecks, exact-role integration, and `pnpm agent:validate -- --scope api`
  all passed again. One parallel exact-role invocation timed out without a
  failure trace; an immediate isolated rerun passed in 2.8 seconds.

## Independent reviews

- Research/plan review confirmed all four findings and recommended causal RLS,
  persisted successor reload, direct database coverage, and late-cancel tests.
- Implementation review found the RLS dependency graph acyclic, confirmed the
  required reserve/complete reads remain visible, and found the persisted
  late-cancel projection safe, with no actionable findings.
- Final wrap-up review checked the complete diff, worksheet, feedback record,
  and validation claims and found no implementation, security, test,
  documentation, or artifact blocker.

## Blockers and risks

- None.

## Next action / handoff

- Amend this post-rebase evidence into the final commit, tag it, and push the PR
  branch with lease protection.
