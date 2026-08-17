# Worksheet: API-20260810-LARGE-FILE-REFACTOR

<!-- agent-summary: Durable record for the daily large-file refactor. -->
<!-- agent-summary: Extract project catalog and activity persistence from the V1 store. -->
<!-- agent-summary: Preserve the store module's public exports and tenancy filters. -->
<!-- agent-summary: Keep the extraction limited to read/list/activity boundaries. -->
<!-- agent-summary: Validate API tests, typecheck, lint repair, and scoped agent validation. -->
<!-- agent-summary: Commit the worksheet, feedback, and implementation together. -->
<!-- agent-summary: Publish an open, non-draft PR for review. -->

## Goal

Move the project catalog/activity functions out of `store.ts` so the remaining
store is easier to navigate without changing route-facing behavior.

## Research and plan

- `apps/api/src/lib/api/v1/store.ts` is the remaining production hotspot at
  5,758 lines after earlier asset-discovery and storyboard extractions.
- The extracted boundary owns project activity timestamps, workspace listings,
  public listings, and the public read-only bundle.
- Existing `store-storyboard.ts` imports selected store functions, so this
  extraction follows that established module boundary and keeps imports type-safe.

## Validation evidence

- `pnpm --filter @popcorn/api exec tsx --test src/lib/api/v1/__tests__/store.test.ts src/lib/api/v1/__tests__/workspace-lists.test.ts` — 10 passed, 14 database-backed cases skipped because local integration is disabled.
- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm agent:lint:fix` — passed.
- `git diff --check` — passed.
- `pnpm agent:validate -- --scope api` — passed, including API typecheck and database boundary checks.

## Reviews

- Research/plan: local review; no independent reviewer command was configured.
- Implementation: local diff review found no behavior, export, tenancy, or database-boundary regressions.
- Wrap-up: pending final commit and PR review.
- 2026-08-17 review follow-up: an independent reviewer confirmed the GitHub
  finding, the store-specific type import as the smallest fix, and a clean
  integration with current `main`. Their implementation/wrap-up re-review found
  no code or documentation blockers after the accuracy correction below.

## Handoff

PR: https://github.com/kmgrassi/PopcornReady/pull/906

## Review follow-up — 2026-08-17

- GitHub review identified that the extracted module imported the shared
  `V1Project`, whose optional projection fields widened the existing store API.
- Restored the store-specific `V1Project` import so `listProjects`,
  `listPublicProjects`, and `getPublicProjectBundle` retain their original
  required-field return contract.
- Targeted evidence: API typecheck proves the exported function signatures use
  the stricter store type. The focused store/workspace suites pass 10 checks;
  14 database-backed cases, including the runtime catalog cases, are skipped
  because local database integration is disabled.
- After merging current `main`, `pnpm agent:lint:fix`, `git diff --check`, and
  `pnpm agent:validate -- --scope api` all pass.
