# Worksheet: WEBAPI-20260802-STORYBOARD-ORCHESTRATION

<!-- agent-summary: Make Create Storyboard satisfy its own planning prerequisites through the orchestrator. -->
<!-- agent-summary: Keep storyboard before generated shots in the creator-facing sequence. -->
<!-- agent-summary: Replace the project overview's low-level storyboard job call with a run entrypoint. -->
<!-- agent-summary: Surface automatic scene-and-moment planning without exposing internal shot-plan machinery. -->
<!-- agent-summary: Correct missing-plan error taxonomy and model-readable recovery. -->
<!-- agent-summary: Prevent unknown legacy tools from falsely completing creator pipeline stages. -->
<!-- agent-summary: Ship tests, documentation, feedback, reviews, validation, and a ready pull request together. -->

## Goal and acceptance criteria

- “Create storyboard” starts or returns the relevant orchestrated production run and stops after the storyboard review boundary.
- Missing scene/beat planning is satisfied by the agent before storyboard panels are generated.
- The project overview explains that planning happens automatically, offers truthful loading/error/retry behavior on desktop and mobile, and does not expose a misleading “Generate again” shortcut.
- The low-level storyboard endpoint reports a plan-specific precondition and model recovery points to `plan_shots`.
- Legacy or unknown tool names cannot make the Brief or Script groups appear complete.
- Targeted API, web, and Playwright coverage passes; the changed route is exercised at desktop and mobile widths.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`, `docs/ui-interaction-model.md`
- `docs/NORTH_STAR.md`, `docs/scopes/storyboard-scenes.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`
- Impeccable product, layout, type, interaction, clarity, and responsive guidance

## Decisions

- Keep the existing Popcorn Ready visual system; this is a workflow-state repair, not a new visual direction or asset exercise.
- Use the orchestrator’s mandatory `after:generate_storyboard` boundary instead of teaching the creator about a low-level shot-plan prerequisite.
- Reuse an already-active Creative Director run only when it carries the storyboard boundary; unrelated creator-direct asset runs do not qualify.
- Remove creator-facing “Generate again”; revisions continue through the existing object-scoped Request Changes flow.

## Changes

- Added a project-scoped storyboard generation entrypoint that checks project access, returns a qualifying active Creative Director root, or creates an idempotent run with the mandatory `after:generate_storyboard` boundary.
- Serialized that find-or-create decision with a project-keyed Postgres advisory transaction, and skip dispatch when an idempotency replay returns the existing run.
- Added a composite gate-stage/newest-first index for the lightweight two-second boundary lookup.
- Kept poster dispatch out of this entrypoint and made the orchestration objective explicitly continue from the active brief through scene-and-moment planning.
- Replaced the project overview's direct storyboard job mutation/polling with the orchestrated run mutation, run navigation, automatic-planning copy, no-brief prerequisite state, and responsive retry/progress behavior.
- Added `plan_missing` as a distinct 409 precondition and taught orchestrator recovery to satisfy it with `plan_shots`.
- Added an explicit Poster progress group and restricted broad fallbacks to stages without tool identity, preventing known and unknown legacy tools from impersonating Brief or Script.
- Projected poster work as asset generation at the API boundary, kept unknown actions out of creator stages while preserving their operator diagnostics, and added a one-boundary GET status endpoint so the project overview never polls full run history.
- Updated the API contract, creator interaction model, storyboard scope, North Star clarification, and E2E inventory.

## Validation evidence

- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/api exec tsx --test src/lib/supabase/__tests__/storyboard-boundary-index-migration.test.ts src/lib/postgres/__tests__/storyboard-entrypoint.test.ts src/lib/api/v1/__tests__/workspace-lists.test.ts src/routes/v1/__tests__/orchestrator-runs.test.ts src/routes/v1/__tests__/storyboards.test.ts src/lib/orchestrator/tool-errors.test.ts` — 56 passed.
- `pnpm exec playwright test e2e/storyboard-orchestration.spec.ts --project=chromium --project=mobile-safari --project=mobile-chrome` from `apps/web` — 12 passed.
- `pnpm exec playwright test e2e/storyboard-orchestration.spec.ts e2e/run-progress.spec.ts --project=chromium --project=mobile-safari --project=mobile-chrome` from `apps/web` — 42 passed before the status endpoint was narrowed; the final 12-test storyboard pass covers the narrowed endpoint and bounded polling contract.
- `pnpm exec playwright test e2e/run-progress.spec.ts --grep "legacy poster" --project=chromium --project=mobile-safari --project=mobile-chrome` from `apps/web` — 3 passed.
- The first broad E2E invocation unintentionally ran the wider Chromium/mobile suites; it caught and drove the fix for Poster consuming generic asset-stage fallbacks. The directly affected legacy progress checks passed after the repair.
- Manual local browser inspection at the real `/projects/manual-storyboard` entry point verified desktop automatic-planning copy, the enabled Create storyboard CTA, POST-to-run navigation, and active Plan shots progress. A 390×844 pass verified the same CTA, expandable planning explanation, run navigation, and the `/projects/manual-no-brief` Finish brief prerequisite state; the viewport was restored afterward.
- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope all` — passed on the final tree after the status endpoint, operator diagnostics, and index migration changes.
- `pnpm db:migrations:validate` — passed with 99 migrations. `pnpm db:local:status` could not complete because Docker container health inspection was unresponsive and was canceled; the migration's exact access-path index is covered by the focused migration test and repository migration validator.
- PR #877 dispatch-recovery follow-up: the focused orchestrator route suite
  passed 38 tests, `@popcorn/api` typecheck passed, and
  `pnpm agent:validate -- --scope all` passed on the follow-up tree.

## Independent reviews

- Research: `/root/research_review` confirmed the missing `plan_shots` action, misleading CTA/error taxonomy, and orchestration-first remedy before implementation.
- Plan: `/root/research_review` approved the storyboard-bounded entrypoint with narrow root reuse, idempotency, explicit no-brief behavior, no poster dispatch, and explicit legacy-stage mapping.
- Implementation: `/root/research_review` identified and then confirmed fixes for concurrent duplicate roots, replay dispatch, overbroad client run inference, stale terminal polling, poster/unknown projection, low-level route coverage, operator provenance, heavyweight full-history polling, and its supporting database index.
- Wrap-up: `/root/research_review` approved the implementation, migration, source-of-truth docs, feedback entry, auth ordering, performance shape, and test evidence with no remaining correctness issue.
- PR follow-up research/plan: `/root/research_review` confirmed the review
  finding and selected queued-plus-pending reuse and queued replay as the safe
  repair boundary; running, waiting, and reached-gate runs must not be woken.
- PR follow-up implementation/wrap-up: `/root/research_review` approved the
  serialized retry repair, gate-aware wake boundary, idempotency replay handling,
  focused regression, contract update, and validation with no blocking finding.

## Blockers and risks

- No open blocker. The status read deliberately returns only the latest run that owns the storyboard boundary; the creator CTA still resolves reuse under the serialized POST contract.

## Next action / handoff

- PR #877 review follow-up: re-wake queued reused and idempotently replayed
  storyboard runs so a failed initial dispatch cannot strand a committed run.
  Keep running, waiting, reached-gate, and terminal replays untouched. Focused
  regression coverage, independent review, and full validation pass; commit and
  push the follow-up.
