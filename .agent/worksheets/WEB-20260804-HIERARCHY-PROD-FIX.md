# Worksheet: WEB-20260804-HIERARCHY-PROD-FIX

<!-- agent-summary: Fix two production regressions found after the hierarchy UI rollout. -->
<!-- agent-summary: Empty terminal hierarchies must describe their terminal outcome, not active planning. -->
<!-- agent-summary: Active empty hierarchies keep the Creative Director planning language. -->
<!-- agent-summary: Mobile breadcrumbs must remain readable without overlap or page overflow. -->
<!-- agent-summary: Add observable unit and browser coverage for both production findings. -->
<!-- agent-summary: Manually inspect the run-detail route at desktop and mobile widths. -->
<!-- agent-summary: Commit implementation, tests, documentation, worksheet, and feedback together. -->

## Goal and acceptance criteria

Correct the two regressions observed during the production verification of PR
#884. A hierarchy root with no specialist sessions uses copy appropriate to its
terminal state, while an active empty hierarchy continues to explain that the
Creative Director is planning. At phone widths, long run-detail breadcrumbs do
not overlap or create horizontal page overflow, and the current location
remains understandable.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`
- Impeccable product, responsive-adaptation, and UX-copy guidance

## Decisions

- Centralize zero-session copy by root state so header and panel language cannot
  independently fall back to active planning.
- Limit planning language to queued/active roots. Waiting and blocked roots use
  neutral attention language; failed, canceled, and complete roots use terminal
  language.
- Override the API's generic root message for empty non-active roots because the
  current production projection still says the director is guiding every
  non-decision run.
- Keep the existing horizontal breadcrumb interaction on phones, but prevent
  flex shrinking and clip long linked labels so overflow stays inside the row.

## Changes

- Added state-aware empty-hierarchy copy for current work, progress, director
  description, and empty-panel detail.
- Reused the state-aware copy in the hierarchy panel so stale generic API copy
  cannot make terminal runs look active.
- Made mobile breadcrumb items non-shrinking and ellipsized long linked labels.
- Added a root-state unit matrix and a production-shaped canceled hierarchy
  browser fixture with a genuinely long project name.
- Updated the design, interaction, and E2E source-of-truth documents.

## Validation evidence

- `pnpm --filter @popcorn/web test` — passed, 77 tests.
- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web exec playwright test e2e/run-progress.spec.ts
  --project=chromium` — passed, 15 tests before the production-shaped fixture
  strengthening; the strengthened regression then passed in Chromium, mobile
  Chrome, and mobile Safari (3 tests).
- Impeccable detector on the affected UI/test files — no findings.
- Manual local run-detail inspection used deterministic browser API data with
  the production-shaped stale `guiding this production` root message. At the
  default 1265px content width and a 390px browser override (375px CSS content
  width), the stale message was absent, canceled copy was visible, page
  `scrollWidth` equaled `clientWidth`, the breadcrumb scrolled internally
  (`549 > 343`), and the long link ellipsized (`303 > 201`).
- `pnpm agent:lint:fix` — passed, 11 changed files checked.
- `pnpm agent:validate -- --scope web` — passed, including agent lint,
  workflow-policy tests, migration tests/validation, and web typecheck.

## Independent reviews

- Research checkpoint confirmed empty-copy helpers ignored terminal state and
  mobile breadcrumb items shrank while link glyphs painted outside their boxes.
- Plan checkpoint required separate waiting/blocked language, a full root-state
  matrix, internal breadcrumb scrolling, document containment, and observable
  long-link clipping.
- Implementation checkpoint found that the API's generic root message could
  preserve the contradiction even after fixing header/empty copy. The panel now
  overrides that stale message for empty non-active roots, and the E2E fixture
  intentionally retains the production-shaped API payload.
- Wrap-up checkpoint approved the narrow zero-session override, factual copy
  matrix, real long-label overflow proof, authoritative documentation, and
  recorded validation with no blocker.

## Blockers and risks

- Production did not contain a safe existing run with populated Visuals/Audio
  lanes; this fix is scoped to the two states directly observed.
- The deterministic manual browser server intentionally mocked only the affected
  run/project/auth reads, so unrelated background reads produced a local
  `Could not load data` toast. The affected route content and layout remained
  directly inspectable. Existing React Router future-flag warnings were the only
  browser console warnings.

## Next action / handoff

Commit and tag the completed worksheet, push the branch, and open a ready PR.
