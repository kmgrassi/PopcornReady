# Worksheet: API-20260807-LARGE-FILE-REFACTOR

<!-- agent-summary: Durable record for the daily orchestrator refactor. -->
<!-- agent-summary: Extract durable job and delegation reconciliation from the engine. -->
<!-- agent-summary: Preserve the engine API and run behavior while reducing its size. -->
<!-- agent-summary: Validate focused orchestrator tests, API typecheck, lint repair, and agent validation. -->
<!-- agent-summary: Independent reviewer unavailable; local review records the evidence and limits. -->
<!-- agent-summary: Commit implementation, worksheet, feedback, and relevant documentation together. -->
<!-- agent-summary: Open a non-draft PR and record its URL for handoff. -->

## Goal and acceptance criteria

- Extract a cohesive reconciliation responsibility from a file over 1,000 lines.
- Preserve the engine's exports and runtime behavior.
- Add or retain focused test coverage for media-job and delegation reconciliation.
- Run targeted tests, typecheck, lint repair, and scoped agent validation.
- Commit the implementation records and open a non-draft PR.

## Context and source-of-truth documents

- `AGENT_WORKFLOW.md`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/NORTH_STAR.md`
- `docs/agent-system/README.md`
- `docs/agent-system/reviews.md`

## Decisions

- Target `apps/api/src/lib/orchestrator/engine.ts` because its job/delegation
  reconciliation block is a cohesive boundary with existing engine coverage.
- Keep reconciliation dependencies explicit through a small callback context so
  the extracted module does not import the engine or create a circular import.
- Do not change product behavior, persistence contracts, or public engine exports.
- Independent reviewer command is unavailable because `AGENT_REVIEW_COMMAND` is
  not configured; local review will inspect the diff and rerun focused checks.

## Changes

- Extracted durable media-job and delegated-child reconciliation into
  `apps/api/src/lib/orchestrator/reconciliation.ts`.
- Kept `engine.ts` as the orchestration boundary by injecting finish, park, and
  after-gate callbacks into the extracted module.
- Reduced `engine.ts` from 1,460 lines to 1,285 lines; the new module is 217
  lines.
- Preserved all existing engine exports and persistence behavior.

## Validation evidence

- `pnpm --filter @popcorn/api exec tsx --test src/lib/orchestrator/__tests__/engine.test.ts src/lib/orchestrator/__tests__/engine-delegation.test.ts src/lib/orchestrator/__tests__/engine-retry.test.ts` — 62 passed, 0 failed.
- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm agent:lint:fix` — passed; repository hygiene checks reported 4 changed files.
- `git diff --check` — passed.
- `pnpm agent:validate -- --scope api` — passed, including API typecheck and repository boundary checks.
- Local review confirmed the extracted module has no runtime import cycle: its
  engine imports are type-only, and callback seams keep terminalization in the
  engine.

## Independent reviews

- Research/plan/implementation/wrap-up external review: unavailable; no
  configured independent reviewer command in this environment.
- Local review: completed; no behavior, export, or dependency-boundary issue
  found. Existing focused tests cover the moved media-job/delegation paths.

## Blockers and risks

- This is backend-only, so browser manual exercise is not applicable.

## Next action / handoff

- Commit the validated refactor and records, push the branch, and open a
  non-draft PR. Open PR: https://github.com/kmgrassi/PopcornReady/pull/902
