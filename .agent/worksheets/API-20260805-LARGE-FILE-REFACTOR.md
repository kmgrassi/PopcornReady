# API-20260805-LARGE-FILE-REFACTOR

<!-- agent-summary: This worksheet records the daily large-file refactor target. -->
<!-- agent-summary: The target is the API V1 store's read-oriented asset catalog. -->
<!-- agent-summary: The selected functions move to a focused discovery module. -->
<!-- agent-summary: Existing store exports and route contracts remain stable. -->
<!-- agent-summary: API typecheck and focused tests are required before handoff. -->
<!-- agent-summary: Repository lint repair and agent validation are required. -->
<!-- agent-summary: Commit, worksheet, and documentation travel together. -->

## Goal

Extract the read-oriented asset catalog and storyboard persistence from
`apps/api/src/lib/api/v1/store.ts` into focused modules without changing the
public store API.

## Research

- Target: `apps/api/src/lib/api/v1/store.ts` (7,032 lines at start).
- Prior automation run refactored the dashboard collections page; this run uses
  a distinct API boundary.
- Selected slice: workspace asset listing, project watch media, dashboard
  aggregation, public discovery, and character-anchor listing.
- Follow-up slice: storyboard row mapping, hydration, validation, and save.

## Plan

1. Move the selected functions to `store-asset-discovery.ts`.
2. Move the storyboard workflow to `store-storyboard.ts`.
3. Preserve the existing named exports through the store module.
4. Run focused API tests, lint repair, typecheck, and agent validation.
5. Update the existing open PR with the follow-up extraction.

## Validation log

| Check | Result |
| --- | --- |
| Targeted tests | passed: store (2 passed, 14 skipped); semantic/media (14 passed) |
| Typecheck | passed: `pnpm --filter @popcorn/api typecheck` |
| `pnpm agent:lint:fix` | passed |
| `pnpm agent:validate -- --scope api` | passed |

Follow-up validation: storyboard/keyframe tests passed (25); combined store,
semantic-search, and media-url tests passed (16 passed, 14 skipped); final API
typecheck and scoped agent validation passed.

## Conflict resolution

The branch was merged with the updated `origin/main` after PR #895 reported a
conflict in `store.ts`. The only overlapping hunk was the asset mapper: main's
`mapAssetEmbeddingSourceRow` projection was retained alongside the refactor's
exported async `mapAsset` used by discovery reads. The merged tree passed API
typecheck, embedding tests (11), storyboard/keyframe tests (25), and
`pnpm agent:validate -- --scope api`.

## Decisions and blockers

- `store.ts` is now 6,574 lines (down from 7,032); the new discovery module is
  494 lines.
- After the storyboard extraction, `store.ts` is 5,596 lines and
  `store-storyboard.ts` is 1,001 lines.
- No behavior or route contract changes are intended.
- Independent reviewer was unavailable; local diff review covered the
  implementation and validation evidence.

## Changed files

- `apps/api/src/lib/api/v1/store.ts`
- `apps/api/src/lib/api/v1/store-asset-discovery.ts`
- `apps/api/src/lib/api/v1/store-storyboard.ts`
- `docs/repository-structure.md`
- `.agent/feedback/API-20260805-LARGE-FILE-REFACTOR.md`
