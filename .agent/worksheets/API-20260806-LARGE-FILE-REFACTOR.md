# Worksheet: API-20260806-LARGE-FILE-REFACTOR

<!-- agent-summary: Durable record for the generated-assets module refactor. -->
<!-- agent-summary: The public job lifecycle remains in generated-assets.ts. -->
<!-- agent-summary: Provider execution and asset persistence live in a dedicated module. -->
<!-- agent-summary: Existing exports and runtime behavior are preserved. -->
<!-- agent-summary: Focused API tests and typecheck provide regression evidence. -->
<!-- agent-summary: Independent review is required before PR handoff. -->
<!-- agent-summary: This worksheet ships with the implementation and feedback record. -->

## Goal and acceptance criteria

Refactor a production file over 1,000 lines into cohesive smaller modules without changing its public API or behavior. The original `generated-assets.ts` should be below 1,000 lines, targeted tests should pass, and an open PR should be created.

## Context and source-of-truth documents

- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/agent-system/README.md`
- `docs/agent-system/worksheets-and-feedback.md`

## Decisions

- Extracted the cohesive provider execution and generated-asset persistence path, rather than splitting individual provider branches across unrelated files.
- Kept the public job enqueue/run/poll lifecycle, budget admission, and existing exports in `generated-assets.ts`.
- Preserved the existing `runGeneration` call boundary through a named export from the new module.

## Changes

- Added `apps/api/src/lib/api/v1/generated-asset-generation.ts` (708 lines), containing reference materialization, preflight/provider execution, provenance construction, asset persistence, and revision handling.
- Reduced `apps/api/src/lib/api/v1/generated-assets.ts` from 1,633 lines to 871 lines.
- Added this worksheet and the matching feedback record.

## Validation evidence

- `pnpm install --frozen-lockfile` — passed; dependencies were absent in the worktree and installed from the lockfile.
- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/api exec tsx --test src/routes/v1/__tests__/generated-assets.test.ts src/lib/__tests__/asset-types.test.ts src/lib/__tests__/composition.test.ts` — 22 passed.
- `pnpm agent:lint:fix` — passed; only the two implementation files were changed by the repair step.
- `pnpm agent:validate -- --scope api` — passed.

## Independent reviews

- Research/plan review: recorded locally because no separate reviewer was available before implementation.
- Implementation review: independent reviewer `Averroes` found no behavior regressions, missing exports, or circular dependencies. The reviewer noted that direct unit coverage for `runGeneration` is a follow-up gap; the existing route, asset-type, composition, and API typecheck checks passed.

## Blockers and risks

- No known behavioral blockers. The new module imports only lower-level generation/storage modules and does not import back from `generated-assets.ts`, avoiding a cycle.

## Next action / handoff

Commit and tag `worksheet/API-20260806-LARGE-FILE-REFACTOR`, push the branch, and open a non-draft PR. Follow up with direct provider/persistence unit coverage if generation behavior changes again.
