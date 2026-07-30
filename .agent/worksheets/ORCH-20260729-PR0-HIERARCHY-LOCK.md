# Worksheet: ORCH-20260729-PR0-HIERARCHY-LOCK

<!-- agent-summary: Durable record for selective-regeneration roadmap PR 0. -->
<!-- agent-summary: Every new production root is pinned to the Creative Director hierarchy. -->
<!-- agent-summary: Flat and null-profile roots remain readable history but cannot execute or resume. -->
<!-- agent-summary: Project-scoped Request Changes replaces legacy history with a fresh hierarchy root. -->
<!-- agent-summary: Run-scoped continuation paths reject legacy roots without transplanting their state. -->
<!-- agent-summary: An additive replay-safe migration terminalizes only nonterminal legacy root runs. -->
<!-- agent-summary: Validation, independent reviews, commit, tag, and ready stacked PR are recorded here. -->

## Goal and acceptance criteria

Implement PR 0 of `docs/scopes/full-selective-regeneration-cutover-prs.md`:
remove environment-controlled flat-root creation, fail closed at every root
execution/resume boundary, and terminalize nonterminal flat/null root history
without mutating immutable execution profiles.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, `docs/repository-structure.md`.
- `docs/NORTH_STAR.md`, `docs/domain-agent-orchestration-contract.md`.
- `docs/scopes/full-selective-regeneration-cutover-prs.md`.
- `docs/supabase-identity-and-rls.md`.
- `apps/api/src/lib/tool-tests/README.md`.

## Decisions

- Use one fail-closed hierarchy-root predicate for engine, recovery, gate,
  retry, and revision boundaries.
- Do not mutate `root_execution_profile`; replace valid project-scoped creator
  intent with a fresh hierarchy root.
- Reject run-scoped continuation of flat/null roots because gates and actions
  cannot be safely transplanted.
- Preserve the live immediate-enqueue Request Changes flow until roadmap PR 6.
- Retain the profile column and flat registry implementation for PR 7 deletion.

## Changes

- Root creation and anonymous admission now always persist
  `root_execution_profile = 'creative_director'`; the retired environment
  switch no longer changes production behavior.
- A shared root predicate guards model start, continue, resume, recovery,
  approval/rejection, revision, credit retry, and stage restart boundaries.
- Project-scoped Request Changes reuses only a valid Creative Director root.
  When the newest root is legacy and live, its full causal family is canceled
  before a fresh hierarchy root is created.
- The replay-safe migration terminalizes every nonterminal legacy root through
  the canonical family-cancellation function, then recursively closes dispatch
  leases for the root and all descendants.
- A database constraint is installed before the cancellation sweep so an older
  API process in a rolling deploy cannot insert another nonterminal flat/null
  root. The recovery worker also causally cancels any refused legacy family
  before completing its claimed dispatch.
- Root-history selection filters domain children before choosing a reusable
  root, while the flat registry and profile column remain as historical
  compatibility surfaces until roadmap PR 7.
- North Star, orchestration contract, and rollout documentation now describe
  the hierarchy-only production invariant.

## Validation evidence

- Targeted hierarchy-lock, route, migration, recovery, and engine tests:
  74 passed, 0 failed.
- Broader engine/retry/delegation coverage: 48 passed before the final refusal
  regression was added; the final engine-inclusive targeted suite passed.
- `pnpm db:migrations:validate`: passed for 86 migrations.
- `pnpm --filter @popcorn/api typecheck`: passed.
- `pnpm --filter @popcorn/web typecheck`: passed.
- `pnpm agent:lint:fix`: passed.
- `pnpm agent:validate -- --scope all`: passed.
- Development API smoke on port 4329 returned a healthy response with the
  Creative Director hierarchy enabled and no fallback window.
- The full API suite reported 957 passed, 118 skipped, and 4 failures. Focused
  comparison against stacked base `b928242f` confirmed all four are existing
  base failures: two stale guest-retention migration filenames, a discover
  fixture affected by local `PUBLIC_PROJECT_IDS`, and a projection fixture
  missing the existing `delegate_domains` field.

## Independent reviews

- Research/plan: root coordinator independently approved the plan and required
  one centralized predicate, root-only migration filtering, consistent dispatch
  closure, and preservation of current Request Changes behavior.
- Implementation: reviewer requested full causal-family cancellation, recursive
  dispatch closure, root-first project-history filtering, and canonical family
  cancellation before project-level replacement. All findings were implemented
  with regression coverage.
- Wrap-up: independently approved with no blockers after the implementation
  findings were resolved and the full validation rerun passed.
- PR review follow-up identified a rolling-deploy race between the one-time
  cancellation sweep and older direct inserts. The database write fence plus
  runtime defense-in-depth cancellation close that race with focused coverage.

## Blockers and risks

- None.

## Next action / handoff

- Commit, tag, push, and open a ready stacked PR against
  `codex/full-selective-regeneration-scope`.
