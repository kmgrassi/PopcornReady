# API large-file refactor — project poster workflow

<!-- agent-summary: Extracts the cohesive project-poster workflow from the V1 store. -->
<!-- agent-summary: Keeps the store facade and public poster exports stable. -->
<!-- agent-summary: Moves lookup, reuse matching, selection, and fallback logic into one module. -->
<!-- agent-summary: Covers API-only validation with focused tests and typechecking. -->
<!-- agent-summary: Records skipped database cases when local integration is disabled. -->
<!-- agent-summary: Requires lint repair and scoped agent validation before handoff. -->
<!-- agent-summary: Captures commit, tag, branch, and ready-for-review PR handoff steps. -->

- Goal: extract the project-poster persistence workflow from the oversized V1 store.
- Scope: poster asset lookup, reuse matching, selection, and first-frame fallback.
- Source: `apps/api/src/lib/api/v1/store.ts`.
- Destination: `apps/api/src/lib/api/v1/store-poster.ts`.
- Compatibility: `store.ts` preserves the existing public poster exports.
- Validation: focused API tests, API typecheck, lint repair, and scoped agent validation.
- Review: local independent review because no configured reviewer command was available.

## Research and decision

`store.ts` was 5,758 lines and contained a cohesive 430-line poster workflow. The
workflow already had focused generation tests and was a safer extraction target
than the legacy global CSS monolith or test-only files. Projection assembly stays
in `store.ts`; the new module owns poster selection and generation context logic.

## Changed files

- `apps/api/src/lib/api/v1/store-poster.ts`
- `apps/api/src/lib/api/v1/store.ts`
- this worksheet and the matching feedback entry

## Verification

- Focused tests: `pnpm --filter @popcorn/api exec tsx --test src/lib/api/v1/__tests__/poster-generation.test.ts src/lib/api/v1/__tests__/store.test.ts` — 8 passed, 14 skipped because local database integration is disabled.
- API typecheck: `pnpm --filter @popcorn/api typecheck` — passed.
- `git diff --check` — passed.
- Browser/manual verification: not applicable; this is an API-only refactor with no route or UI behavior change.
- Required final checks: run `pnpm agent:lint:fix`, then `pnpm agent:validate -- --scope api`.

## Review notes

The extracted module imports the store for existing persistence helpers, matching
the repository's established `store-storyboard.ts` pattern. Public callers still
import poster functions from `store.ts`, and the retained `setProjectPoster` and
projection paths use the extracted helpers.

## Handoff

Commit the implementation, worksheet, and feedback entry together, tag
`worksheet/API-20260811-LARGE-FILE-REFACTOR`, push the branch, and open a ready
for review (non-draft) PR.
