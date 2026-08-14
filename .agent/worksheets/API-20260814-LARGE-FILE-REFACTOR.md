# API-20260814-LARGE-FILE-REFACTOR

<!-- agent-summary: This worksheet records the script-draft store extraction. -->
<!-- agent-summary: The extraction preserves the public store facade exports. -->
<!-- agent-summary: Relational script scenes and dialogue remain persistence-backed. -->
<!-- agent-summary: Graph asset and action provenance behavior remains unchanged. -->
<!-- agent-summary: Focused script and orchestrator tests cover the affected path. -->
<!-- agent-summary: API typecheck and scoped agent validation are required gates. -->
<!-- agent-summary: Independent review is recorded when no reviewer command exists. -->

## Goal

Extract the script-draft persistence and reconstruction boundary from `apps/api/src/lib/api/v1/store.ts` into a focused module while preserving the store facade exports and behavior.

## Research

- `store.ts` is 5,758 lines and remains the largest active application module.
- Prior refactors extracted asset discovery, project catalog reads, poster handling, storyboard media, storyboard persistence, and composition/jobs while preserving `store.ts` as the compatibility facade.
- The script-draft block owns relational scene/dialogue persistence, graph asset creation, active selection, current-project pointer updates, and reconstruction of the active draft. It is a cohesive extraction boundary.
- `AGENT_REVIEW_COMMAND` is unset, so independent review is unavailable; local diff review will be recorded instead.

## Plan

1. Move script-draft row types, mappers, structure persistence, and public operations into `store-script-draft.ts` using explicit dependencies.
2. Keep `store.ts` wrappers and the existing public exports intact.
3. Run focused script/orchestrator tests, API typecheck, lint repair, diff checks, and scoped agent validation.
4. Commit this worksheet with the implementation and publish an open PR.

## Verification

- `pnpm --filter @popcorn/api exec tsc --noEmit` passed.
- Focused `tsx --test` run passed 26 tests; 14 database-backed store cases were skipped because local integration was not enabled.
- `pnpm agent:lint:fix` passed after adding the worksheet summaries.
- `pnpm agent:validate -- --scope api` passed, including API typecheck and database-boundary checks.
- `git diff --check` passed.
- Local review confirmed the extracted module has no import of the facade, the facade preserves both script-draft exports, and the dependency boundary contains only the existing store primitives. `AGENT_REVIEW_COMMAND` was unset, so no independent reviewer was available.

## Review and handoff

- Commit the implementation and worksheet together, add the `worksheet/API-20260814-LARGE-FILE-REFACTOR` tag, push `agent/daily-large-file-refactor-20260814`, and open a non-draft PR with `codex` and `codex-automation` labels when available.
