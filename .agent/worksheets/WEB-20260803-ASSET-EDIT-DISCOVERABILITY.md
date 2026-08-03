# Worksheet: WEB-20260803-ASSET-EDIT-DISCOVERABILITY

<!-- agent-summary: Make the asset viewer's AI edit path visually unmistakable. -->
<!-- agent-summary: Keep Request Changes as the only creator-facing edit workflow. -->
<!-- agent-summary: Preserve exact-asset targeting, approval, execution, and focus restoration. -->
<!-- agent-summary: Explain non-ready edit unavailability instead of silently hiding it. -->
<!-- agent-summary: Keep project, anchor, and visibility actions visually secondary. -->
<!-- agent-summary: Verify ready and non-ready states at desktop and mobile widths. -->
<!-- agent-summary: Ship implementation, tests, documentation, feedback, and a ready pull request together. -->

## Goal and acceptance criteria

The canonical Library asset viewer presents Request Changes as its clear primary
creator action for owned, ready assets. Project navigation, anchor publishing,
and visibility controls remain available without competing for attention.
Owned non-ready assets explain when Request Changes becomes available rather
than silently removing the affordance. Public-library assets remain read-only.
The existing exact-target proposal lifecycle, keyboard focus restoration, and
deep-link behavior remain unchanged.

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
- Impeccable product-register guidance

## Research

- Production inspection on 2026-08-03 reproduced a ready asset viewer at
  `/library/assets?assetId=6777bdbf-851d-450c-a14e-a73cdef98405`.
- The existing ghost-style **Suggest an edit** control rendered in a narrow
  footer alongside three equally weighted utility actions, making the sole edit
  path easy to overlook.
- The ready-state gate is correct, but non-ready owned assets currently omit the
  action without explaining why.
- The deployed production bundle already contains the merged feature; this is a
  hierarchy and state-communication defect, not deployment lag.

## Decisions

- Use the canonical **Request changes** label instead of introducing a parallel
  "Edit with AI" term.
- Promote Request Changes to the viewer's single gold CTA at the standard
  control size and separate it from project, anchor, and visibility utilities.
- Keep public-library assets read-only. For owned non-ready assets, render a
  disabled Request Changes control with concise readiness guidance so the state
  is explicit rather than silently absent.
- Preserve the existing dialog lifecycle, exact target, deep link, and focus
  restoration behavior; this change does not add a new mutation path.
- Make the primary action full-width on mobile and verify short/mobile viewport
  containment in addition to the default desktop state.

## Changes

- Replaced the muted **Suggest an edit** footer link with a standard-size gold
  **Request changes** CTA and supporting AI-specific helper copy.
- Grouped project navigation, anchor publishing, and visibility mutations as
  secondary utilities so they no longer compete with the creator action.
- Added an accessible disabled Request Changes state for processing and failed
  owned assets, with status-specific copy connected through
  `aria-describedby`; public assets render no action footer.
- Kept the existing exact-asset proposal dialog and focus restoration path,
  while updating its title to the canonical label.
- Constrained media to the viewer stage and added portrait/short-viewport
  responsive treatments so media cannot paint over the action footer.
- Followed up on two PR review findings by giving the shared dialog a definite
  safe-area-aware height, restoring the desktop inspection surface, and using a
  compact horizontal audio layout at short viewport heights so native playback
  controls remain reachable.
- Updated interaction documentation, the E2E coverage inventory, and the
  focused Library Playwright behavior checks.

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm agent:lint:fix` — passed for all nine changed files.
- `pnpm agent:validate -- --scope web` — passed agent lint, workflow-policy
  tests, migration tests and validation, and web type checking.
- `VITE_API_URL=http://127.0.0.1:4235 PLAYWRIGHT_WEB_PORT=3235
  POPCORN_E2E_API_PORT=4235 pnpm --filter @popcorn/web exec playwright test
  e2e/specs/library-collections.spec.ts` — 12 passed across desktop Chromium,
  mobile Safari, and mobile Chrome.
- Manual local Chrome verification through `/library/assets` with deterministic
  API fixtures — passed for ready, processing, and failed assets at the default
  desktop size, 390 × 844 portrait, and 844 × 390 short landscape.
- The first portrait inspection found that the media element could paint over
  the new footer despite passing bounding-box checks. Media is now constrained
  to its grid track, and the regression test verifies that Request Changes is
  the topmost element at its center point.
- PR review follow-up coverage asserts that a 1280 × 900 desktop viewer retains
  an image area taller than 500px and that, at 844 × 390, all four edges of the
  native audio control remain inside both the media stage and dialog and the
  control remains topmost at its center.
- Manual follow-up verification measured a 577px desktop image area and a
  476 × 54 short-landscape audio control fully contained in the stage and
  dialog.
- Follow-up `pnpm agent:validate -- --scope web` — passed agent lint,
  workflow-policy tests, migration tests and validation, and web type checking
  across the six-file review update.

## Independent reviews

- Research checkpoint: confirmed the control is a muted 30px ghost action in a
  bottom-right utility row while visibility mutation is visually stronger.
  Recommended one canonical Request Changes CTA, clear separation from
  utilities, full-width mobile treatment, and explicit non-ready guidance.
- Plan checkpoint: approved the route-local primary/utility split, canonical
  label, exact-target preservation, and responsive test scope. Required
  status-specific failed guidance, `aria-describedby` for disabled-state copy,
  and no empty footer node for public-library assets; the implementation plan
  incorporates all three.
- Implementation checkpoint: approved with no blocking functional,
  accessibility, responsive, or regression findings. The reviewer confirmed
  the hierarchy and state gates, public `actions={null}`, shared viewer sizing,
  focus lifecycle, and focused test contract. Optional future polish is to make
  failed-state recovery guidance more actionable when a consistent recovery
  path exists and to associate the ready helper through `aria-describedby`.
- Wrap-up checkpoint: approved for release with no code, test,
  documentation, accessibility, responsive, or regression blockers. The
  reviewer confirmed that the browser-found overlap is preserved in durable
  feedback and topmost-element regression coverage, and that validation is
  proportionate to the UI change.
- PR review follow-up research/plan checkpoint: approved both P2 findings and
  the definite-height plus compact-audio approach, with the adjustment that the
  dialog height resolve against the overlay's padded content box so iOS safe
  areas remain respected.
- PR review follow-up implementation checkpoint: approved after correcting the
  regression test to measure the actual inner clipped dialog. The reviewer
  confirmed the CSS is safe-area-aware and that the test now checks the stage
  and all audio-control edges against the right boundaries with no remaining
  implementation blocker.
- PR review follow-up wrap-up checkpoint: approved with no blocker. The
  reviewer confirmed both P2 regressions are fixed at the shared viewer
  boundary, the corrected tests and manual measurements directly cover them,
  the original CTA overlap protection remains intact, and the six-file release
  unit is documented and validated.

## Blockers and risks

- The viewer supports image, video, and audio assets and must retain responsive
  containment for each media type.
- The edit action must not imply direct mutation; it continues to open the
  reviewable Request Changes proposal lifecycle.

## Next action / handoff

Commit all six follow-up files together, push PR #883, then reply to and resolve
both addressed review threads.
