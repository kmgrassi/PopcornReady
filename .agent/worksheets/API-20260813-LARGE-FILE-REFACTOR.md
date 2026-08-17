# Worksheet: API-20260813-LARGE-FILE-REFACTOR

<!-- agent-summary: Durable record for the storyboard media extraction. -->
<!-- agent-summary: The refactor keeps the store-storyboard facade exports stable. -->
<!-- agent-summary: Media lineage resolution is isolated from storyboard persistence and mapping. -->
<!-- agent-summary: Validation covers API typechecking, focused storyboard-adjacent tests, and agent validation. -->
<!-- agent-summary: No product behavior or database contract should change. -->
<!-- agent-summary: Independent review availability is recorded explicitly. -->
<!-- agent-summary: This worksheet ships with the implementation and feedback record. -->

## Goal and acceptance criteria

Refactor one source file over 1,000 lines into smaller cohesive modules without changing the V1 store contract. The original storyboard module should remain a stable facade for existing imports, and the extracted media helper should have no dependency on that facade.

## Context and source-of-truth documents

- `AGENT_WORKFLOW.md`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/agent-system/worksheets-and-feedback.md`

## Decisions

- Targeted `apps/api/src/lib/api/v1/store-storyboard.ts` because it was 1,001 lines and had a distinct media-lineage resolver used by both panel and scene hydration.
- Extracted only media URL and prompt resolution; kept mapping, hydration orchestration, validation, and persistence in the original module to keep scope behavior-preserving.
- Preserved `assetGenerationPrompt` as a re-export from `store-storyboard.ts` for compatibility.

## Changes

- Added `apps/api/src/lib/api/v1/store-storyboard-media.ts`.
- Updated `apps/api/src/lib/api/v1/store-storyboard.ts` to delegate media resolution and re-export the prompt helper.
- Added this worksheet and the matching task-scoped feedback record.

## Validation evidence

- `pnpm install --no-frozen-lockfile` completed successfully because the fresh worktree had no dependencies.
- `pnpm --filter @popcorn/api exec tsx --test src/lib/api/v1/__tests__/store.test.ts src/lib/api/v1/__tests__/storyboards.test.ts src/lib/api/v1/__tests__/asset-media-urls.test.ts`: 17 passed, 14 skipped local-database cases, 0 failed.
- `pnpm --filter @popcorn/api typecheck`: passed.
- `pnpm agent:lint:fix`: passed; only repository hygiene formatting was repaired.
- `pnpm agent:validate -- --scope api`: passed, including API typecheck and database-boundary checks.
- `git diff --check`: passed.
- `store-storyboard.ts` decreased from 1,001 to 927 lines; the extracted helper is 82 lines.

## Independent reviews

`AGENT_REVIEW_COMMAND` was not configured at the research or implementation checkpoints. Local review confirmed the extracted helper has no import of the facade, preserves the existing query/signing logic, and keeps `assetGenerationPrompt` available from the original module.

## Blockers and risks

The media helper calls the existing asset URL signer and service Supabase client exactly as before. Focused database-backed tests may skip when local integration is unavailable.

## Next action / handoff

Commit the implementation, worksheet, and feedback record, tag the worksheet, push the branch, and open a non-draft PR.
