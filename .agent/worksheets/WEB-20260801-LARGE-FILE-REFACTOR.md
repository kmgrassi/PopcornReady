# WEB-20260801-LARGE-FILE-REFACTOR

<!-- agent-summary: Refactors the oversized progress view into cohesive modules. -->
<!-- agent-summary: Preserves the ProgressView public props and UI behavior. -->
<!-- agent-summary: Extracts pure run-state calculations for focused reuse. -->
<!-- agent-summary: Extracts plan recap presentation from the orchestration view. -->
<!-- agent-summary: Extracts the pipeline-depth presentation shared by desktop and mobile. -->
<!-- agent-summary: Uses existing web tests and app build as validation evidence. -->
<!-- agent-summary: Records review checkpoints and final handoff commands. -->

## Goal

Refactor the oversized `apps/web/src/components/progress/ProgressView.tsx` into
cohesive helper modules without changing the run-progress UI behavior.

## Decisions

- Keep `ProgressView` as the public composition component and preserve its props.
- Extract pure status/progress calculations into `progress-view-helpers.ts`.
- Extract the plan recap into `PlanRecap.tsx` and the pipeline-depth/sidebar
  content into `PipelineDepth.tsx`.
- Reuse the existing CSS module and E2E coverage; no visual behavior changes are
  intended.

## Review checkpoints

- Research review: independent reviewer unavailable in this environment; checked
  existing run-progress specs and neighboring component boundaries locally.
- Plan review: independent reviewer unavailable; selected cohesive, low-risk
  extractions with no API or data-model changes.

## Changes

- Added `progress-view-helpers.ts` for pure run status, progress, stage grouping,
  and display formatting logic.
- Added `PlanRecap.tsx` and `PipelineDepth.tsx` for the two cohesive presentation
  boundaries shared by the desktop and mobile layouts.
- Reduced `ProgressView.tsx` from 1,024 lines to 652 lines without changing its
  public props or route behavior.

## Validation

- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web test` — 54 passed.
- `pnpm --filter @popcorn/web build` — passed; Vite emitted only the existing
  chunk-size warning.
- `pnpm --filter @popcorn/web test:e2e` — 105 passed, 5 skipped; this was the
  full suite because the package script forwarded the file argument as `--`.
  All run-progress desktop/mobile cases passed.
- `pnpm agent:lint:fix` and `pnpm agent:validate -- --scope web` — passed.

## Independent reviews

- Research, plan, implementation, and wrap-up independent reviewer: unavailable
  in this environment. Local diff review completed after typecheck, unit tests,
  build, and full web E2E.

## Files and next action

Ready for commit and open PR. No product documentation required because this is
an internal component-boundary refactor with unchanged behavior.
