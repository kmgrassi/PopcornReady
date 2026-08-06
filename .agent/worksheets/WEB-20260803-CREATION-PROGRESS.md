# Worksheet: WEB-20260803-CREATION-PROGRESS

<!-- agent-summary: Durable record for the prominent creator-direct production loading experience. -->
<!-- agent-summary: The live active state and development preview must render the same UI. -->
<!-- agent-summary: Desktop gives the pixel crew visual priority while mobile remains contained. -->
<!-- agent-summary: Status, indeterminate progress, and the creative brief remain legible and truthful. -->
<!-- agent-summary: The preview route is development-only and excluded from production builds. -->
<!-- agent-summary: Browser evidence covers the real active route and the dedicated preview route. -->
<!-- agent-summary: Use worksheet/WEB-20260803-CREATION-PROGRESS as the completion tag. -->

## Goal and acceptance criteria

- Make the four-person studio crew the dominant active creation-loading visual on large screens.
- Place the status above the crew and keep progress plus the creative brief compact below it.
- Preserve terminal-state behavior, accessible status semantics, reduced motion, and mobile containment.
- Add a development-only route that renders the same production component with deterministic sample content.
- Add focused automated coverage and manually inspect the changed state at desktop and mobile widths.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/agent-system/performance-and-visual-regression.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- Impeccable product-register guidance and Browser skill instructions

## Decisions

- Apply the prominent hero treatment only to active queued/running/waiting work;
  terminal and actionable outcomes retain the quieter split presentation.
- Extract `CreationProgressExperience` so the live route, loading reservation,
  and development preview share production markup instead of duplicating a mock.
- Preserve the native creative-brief disclosure, but remove the nested-card look
  from its active desktop summary.
- Gate `/dev/creation-progress` with the existing development-only route harness
  while keeping all deterministic preview copy owned by the lazy dev route.

## Changes

- Created this worksheet.
- Added the shared creation-progress experience and vertical loading skeleton.
- Enlarged the prominent crew scene to a bounded 360–440px desktop height and
  scaled the fixed-frame pixel actors while preserving crisp rendering.
- Replaced the live active status markup with the shared experience and added a
  deterministic development preview route.
- Added relational desktop geometry and dev-route Playwright coverage.
- Updated the design signature, E2E inventory/README, and manual route inventory.
- Published the completed work as ready-for-review PR #882.
- Merged the latest `main` changes, preserving the split Asset Studio E2E suite
  and the new recovered-output preview behavior.
- Addressed both unresolved review findings by replacing the tablet offset with
  a spacing token and making prominent actor scale respond to the scene's
  container width rather than viewport width.

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web exec node --import tsx --test src/routes/dev/devHarness.test.ts`
  — passed, 4 tests.
- Focused Chromium Playwright on active production, dev preview, terminal
  outcomes, and reduced-motion mobile behavior — passed, 4 tests.
- Impeccable detector on the changed component, route, and CSS files — no findings.
- `pnpm --filter @popcorn/web build` — passed; the existing large-chunk advisory
  remained, and preview fixture copy was absent from the production output.
- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope web` — passed, including agent lint, workflow
  policy tests, migration tests/validation, and web typecheck.
- After the wrap-up breakpoint fix, the focused 767px reduced-motion/containment
  Playwright case passed and `pnpm agent:validate -- --scope web` passed again.
- Review follow-up adds a 960px authenticated-sidebar containment regression to
  the split `asset-studio-progress.spec.ts` suite.
- After merging `main`, all 8 Chromium cases in the split progress suite passed,
  including recovered output media, the 960px sidebar case, the development
  preview, terminal outcomes, polling, and reduced-motion mobile containment.
- `pnpm --filter @popcorn/web build` and
  `pnpm agent:validate -- --scope web` passed after conflict resolution.
- Manual in-app-browser inspection:
  - `/dev/creation-progress`, 1440×900 and 390×844: status above prominent crew,
    compact brief below, no horizontal overflow.
  - `/create/asset?projectId=demo&runId=run_demo`, local fixture, 1440×900:
    958×440 scene inside a 1000px experience; status → scene → 4px progress →
    brief ordering observed.
  - Same live route at 390×844: 210px scene, four contained actors, document
    width equaled the 390px viewport.
- Initial focused Playwright attempt on port 3100 was blocked by an unrelated
  listener; rerun on web/API ports 3190/4190 passed.

## Independent reviews

- Research/plan review by `/root/research_review` approved the shared active-only
  direction and required truthful terminal hierarchy, bounded 2:1-ish scene
  sizing, actor scaling, real-route browser evidence, and dev-route gating. All
  recommendations were incorporated.
- Implementation review by `/root/research_review` found four items: preview
  ownership in the production route, waiting-state documentation drift, missing
  terminal prominence coverage, and a 761–767px transformed-sprite edge. Resolved
  by moving the preview implementation/fixture into the dev route, documenting
  non-actionable waiting, asserting no terminal `data-prominent`, moving the
  tablet scale breakpoint to 768px, and testing actor containment at 767px.
- Initial wrap-up review found the loading skeleton still used the former 760px
  breakpoint, creating an 80px reservation-to-scene shift at 761–768px. Aligned
  the skeleton breakpoint to 768px before the final review rerun.
- Final wrap-up rerun by `/root/research_review` returned READY with no remaining
  code, test, documentation, validation, gating, or workflow findings.
- Conflict-resolution review by `/root/research_review` verified the recovered
  output integration and container-query fix, then identified merge-resurrected
  route CSS, lost desktop hierarchy assertions after the E2E split, and final
  unstaged records. Removed the dead CSS, restored real-route geometry coverage
  before the 960px containment check, and staged the complete validated result.
- The final conflict-resolution review rerun returned READY with no remaining
  code, test, documentation, or merge findings.

## Blockers and risks

- Enlarging a fixed-frame pixel sprite must preserve crisp scaling and keep all actors inside the scene at narrow widths.
- The development preview must not drift from the live state or ship in production.
- Recovered run outputs must continue replacing the crew visual after the
  upstream merge; the shared experience accepts that preview without applying
  the active crew's prominent layout.

## Next action / handoff

PR #882 is ready for review. The local development preview remains available at
`/dev/creation-progress` while the Vite server is running on port 3200.
