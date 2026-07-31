# API-20260731-LARGE-FILE-REFACTOR

<!-- agent-summary: Extracts generated-asset coordination helpers from a large API module. -->
<!-- agent-summary: Preserves the generated-assets public compatibility exports. -->
<!-- agent-summary: Keeps provider execution and persistence in the owning module. -->
<!-- agent-summary: Records the research, implementation, validation, and handoff evidence. -->
<!-- agent-summary: Notes the unavailable independent reviewer checkpoint. -->
<!-- agent-summary: Requires targeted generated-asset tests and API typechecking. -->
<!-- agent-summary: Requires agent lint and validation before commit and PR handoff. -->

## Goal

Extract cohesive generated-asset coordination helpers from the oversized API
module while preserving its public exports and runtime behavior.

## Research and plan

- Selected `apps/api/src/lib/api/v1/generated-assets.ts` (1,786 lines before
  extraction) because its request/action metadata and progress contracts form a
  self-contained boundary.
- Extract those helpers to `generated-asset-support.ts` and re-export the
  compatibility helpers from `generated-assets.ts`.
- Independent reviewer unavailable in this session; record this at each review
  checkpoint and perform a focused diff/code review locally.

## Changes

- [x] Extract idempotency, revision context, cost scope, progress contracts, and
  action proposal helpers.
- [x] Run targeted API tests and typecheck.
- [x] Run repository lint/validation.
- [ ] Add feedback entry, commit, tag worksheet, and open PR.

## Validation log

Commands and results will be recorded here before handoff.

- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/api exec tsx --test src/lib/api/v1/__tests__/generated-assets.test.ts src/lib/api/v1/__tests__/llm-costs.test.ts` — 9 passed, 11 skipped because integration prerequisites were not enabled.
- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope api` — passed.

## Review notes

Local review must verify no behavior changes, no import cycles, and preserved
compatibility exports used by existing tests and routes.

Implementation review completed locally: the extracted module has no database
or provider side effects beyond the existing cost-metadata dependency, and the
original module retains compatibility exports. Independent reviewer was
unavailable at research, plan, implementation, and wrap-up checkpoints.
