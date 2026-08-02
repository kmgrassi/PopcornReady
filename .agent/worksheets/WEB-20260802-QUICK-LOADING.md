# Worksheet: WEB-20260802-QUICK-LOADING

<!-- agent-summary: Durable record for replacing flashing route-level crew loaders. -->
<!-- agent-summary: Quick data loads should use content-shaped or compact indicators. -->
<!-- agent-summary: The studio crew remains reserved for known long-running creative work. -->
<!-- agent-summary: Route loading must remain accessible and stable at mobile and desktop widths. -->
<!-- agent-summary: E2E coverage distinguishes quick route loading from long generation loading. -->
<!-- agent-summary: Validation includes the affected browser entry points and reduced motion. -->
<!-- agent-summary: Link the ready PR and independent review outcomes before completion. -->

## Goal and acceptance criteria

Replace route-level studio crew animation with restrained loading feedback that does not flash awkwardly on quick page loads. Preserve the crew animation for known long-running creation/generation work. Keep accessible loading semantics, layout stability, reduced-motion behavior, and targeted E2E coverage.

## Context and source-of-truth documents

- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- Impeccable product-register guidance

## Decisions

- Use the studio crew only as active progress feedback for known queued/running creative production. An idle crew frame may remain as context after that production finishes, but it is not a generic loading indicator.
- Ordinary route/data fetches use `QuickLoadingState`, which waits 180ms before revealing and never delays ready content.
- Existing content-shaped skeletons become visible loading reservations. Routes without useful geometry use a compact progress line; Watch overlays that compact state on its full media-frame reservation.
- Keep exactly one polite `role="status"` with `aria-busy="true"`; skeleton geometry and the visual progress track remain hidden from assistive technology.

## Changes

- Added `QuickLoadingState` and co-located module styles with delayed reveal, compact/reservation modes, and reduced-motion behavior.
- Replaced ordinary route-level crew loaders across Home, Activity, Library collections, Uploads, Inspiration, Anchors, project overview/steps/storyboard/media/watch, and the initial Asset Studio status fetch.
- Removed the obsolete `StudioCrewLoadingState`; retained `StudioCrewLoader` for the creation production presentation.
- Updated the design-system loading contract, E2E inventory, browser-test README, and focused Library/Watch coverage.
- Addressed PR review feedback by recording every `quick-loading` DOM appearance from before navigation, with the delayed branch as a positive control and the cache-fast branch asserting that no transient insertion occurred.

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web test` — passed, 54 tests.
- Focused `library-collections.spec.ts` quick/slow loading run — passed, 3 tests.
- Focused `asset-studio.spec.ts` active crew reduced-motion/mobile run — passed, 1 test.
- PR feedback rerun: focused delayed and cache-fast Library loading coverage — passed, 2 tests; typecheck passed.
- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope web` — passed.
- Manual visual inspection, `/library/projects`, 390×844: the first 180ms remained calm, then content-shaped cards appeared without a crew scene or horizontal overflow; loaded content replaced them directly.
- Manual visual inspection, `/projects/proj-alpha/watch`, 1280×720: the compact progress treatment stayed centered inside the full media-frame reservation, then transitioned directly to the render without a vertical geometry collapse.
- In-app Browser, `/library/projects`, 1280×720 cache-fast/failing local API path: no quick indicator or crew flashed; viewport and scroll width both measured 1280px.

## Independent reviews

- Research: mapped the wholesale crew-loader rollout and recommended content skeletons for route data, compact fallbacks where geometry is unavailable, and crew only for creative production.
- Plan: approved the 180ms reveal-only threshold, single-status semantics, reduced-motion coverage, stable reservations, and explicit long-running boundary.
- Implementation: found a potentially flaky gated fast-path test and insufficient Watch media geometry. Resolved by using an immediate fixture for the fast branch and a full Watch placeholder reservation with compact overlay. Clarified that terminal idle crew artwork is contextual, not loading feedback.
- Wrap-up: approved with no unresolved implementation, UX, accessibility, testing, documentation, or validation blockers.
- PR feedback research/plan review: confirmed the original post-load assertion could miss a transient flash and recommended a pre-navigation observer that inspects added nodes plus a delayed-state positive control.
- PR feedback implementation/wrap-up: approved; the pre-navigation observer detects retained added nodes and attribute changes, the delayed case prevents a vacuous harness, and the fast case covers transient and late appearances.

## Blockers and risks

- Local Playwright API servers log expected orchestrator-worker warnings when Supabase service credentials are absent; route fixtures and all scoped assertions pass.
- No unresolved implementation blocker.

## Next action / handoff

Ready-for-review PR: https://github.com/kmgrassi/PopcornReady/pull/875

Monitor CI and review feedback on PR #875.
