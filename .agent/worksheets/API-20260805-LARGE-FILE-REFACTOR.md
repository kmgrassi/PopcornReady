# API-20260805-LARGE-FILE-REFACTOR

<!-- agent-summary: This worksheet records the daily large-file refactor target. -->
<!-- agent-summary: The target is the API V1 store's read-oriented asset catalog. -->
<!-- agent-summary: The selected functions move to a focused discovery module. -->
<!-- agent-summary: Existing store exports and route contracts remain stable. -->
<!-- agent-summary: API typecheck and focused tests are required before handoff. -->
<!-- agent-summary: Repository lint repair and agent validation are required. -->
<!-- agent-summary: Commit, worksheet, and documentation travel together. -->

## Goal

Extract the read-oriented asset catalog from `apps/api/src/lib/api/v1/store.ts`
into a focused module without changing the public store API.

## Research

- Target: `apps/api/src/lib/api/v1/store.ts` (7,032 lines at start).
- Prior automation run refactored the dashboard collections page; this run uses
  a distinct API boundary.
- Selected slice: workspace asset listing, project watch media, dashboard
  aggregation, public discovery, and character-anchor listing.

## Plan

1. Move the selected functions to `store-asset-discovery.ts`.
2. Preserve the existing named exports through the store module.
3. Run focused API tests, lint repair, typecheck, and agent validation.
4. Request review evidence, commit, push, and open a non-draft PR.

## Validation log

| Check | Result |
| --- | --- |
| Targeted tests | passed: store (2 passed, 14 skipped); semantic/media (14 passed) |
| Typecheck | passed: `pnpm --filter @popcorn/api typecheck` |
| `pnpm agent:lint:fix` | passed |
| `pnpm agent:validate -- --scope api` | passed |

## Decisions and blockers

- `store.ts` is now 6,574 lines (down from 7,032); the new discovery module is
  494 lines.
- No behavior or route contract changes are intended.
- Independent reviewer was unavailable; local diff review covered the
  implementation and validation evidence.

## Changed files

- `apps/api/src/lib/api/v1/store.ts`
- `apps/api/src/lib/api/v1/store-asset-discovery.ts`
- `docs/repository-structure.md`
- `.agent/feedback/API-20260805-LARGE-FILE-REFACTOR.md`
