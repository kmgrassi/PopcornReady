# Worksheet: WEB-20260729-CHOICE-CARD-PADDING

<!-- agent-summary: Durable record for restoring Asset Studio choice-card padding. -->
<!-- agent-summary: The route must not override shared ChoiceCard component spacing. -->
<!-- agent-summary: Direct form fields retain their existing layout and typography. -->
<!-- agent-summary: Image, Video, and Soundtrack cards use the shared 16px padding. -->
<!-- agent-summary: Browser coverage guards the rendered padding against CSS cascade regressions. -->
<!-- agent-summary: Desktop and mobile browser inspection are required before handoff. -->
<!-- agent-summary: Link reviews, validation evidence, feedback, and the ready PR here. -->

## Goal and acceptance criteria

Restore comfortable internal padding on the Image, Video, and Soundtrack cards
in the standalone Asset Studio without changing the shared card component or the
layout of direct form fields.

## Context and source-of-truth documents

`AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`,
`docs/repository-structure.md`, `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`,
`docs/ui-interaction-model.md`,
`docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`, and the
Impeccable `layout` and `product` guidance.

## Decisions

- Narrow the route-level form-label selector to direct children so the shared
  `ChoiceCard` remains the owner of its padding, border, internal gap, and copy
  weight.
- Guard the observable computed padding in the existing Asset Studio Playwright
  flow.

## Changes

- Scoped route-level fieldset and label styling to direct form children so the
  nested shared choice cards retain their component-owned padding.
- Added token-aware desktop and mobile Playwright assertions for all three card
  paddings.
- Updated the E2E README and inventory to describe the regression coverage.

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web exec playwright test
  e2e/asset-studio.spec.ts --project=chromium --project=mobile-chrome` — 3/3
  passed.
- Manual browser inspection at 1280-by-720 and 390-by-844 confirmed all three
  cards have 16px padding and internal gap, selected and unselected borders
  render correctly, and neither layout has document-level horizontal overflow.
- The local browser API requests could not reach the stopped API server, but the
  complete form and choice cards rendered; the behavior-focused Playwright flow
  mocked its API fixtures and passed without provider spend.
- `pnpm agent:lint:fix` — passed for six changed files after the feedback record
  was brought into the seven-summary-line documentation contract.
- `pnpm agent:validate -- --scope web` — passed repository lint, migration
  validation, and the web typecheck.

## Independent reviews

- Research review confirmed the broad descendant label selector overrides the
  component-owned padding and recommended a direct-child selector.
- Plan review approved the minimal selector change and recommended comparing
  computed inline padding to the design token at desktop and mobile widths.
- Implementation review approved the CSS scope, token-aware regression,
  desktop/mobile coverage, and E2E documentation with no findings.
- Wrap-up review approved the scoped final diff, validation evidence,
  documentation records, and non-draft PR readiness with no findings.

## Blockers and risks

- No remaining blockers. Browser inspection confirmed the selector correction's
  intended padding, gap, border, copy weight, and responsive behavior.

## Next action / handoff

Commit, tag, push, and open a ready pull request.
