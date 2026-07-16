# PR caretaker fixes — 2026-07-16

<!-- agent-summary: Addressed all actionable unresolved review threads found during the PR caretaker sweep. -->
<!-- agent-summary: PR #794's unresolved thread was outdated and already covered by current code and tests. -->
<!-- agent-summary: PR #795 now scopes audioAssetId and candidate affected assets fail-closed. -->
<!-- agent-summary: PR #795 audio projections retain in-scope picture assets for audio fitting. -->
<!-- agent-summary: PR #795 preserve pins now match their slot key as well as role and asset. -->
<!-- agent-summary: Targeted context-boundary tests and API validation are required before handoff. -->
<!-- agent-summary: GitHub review threads are resolved only after the fixes are pushed and verified. -->

## Scope

Caretaker sweep of all open Popcorn Ready pull requests on 2026-07-16.

## Findings and decisions

- PR #794 had one unresolved Codex P2 thread, but the thread was outdated. The current head returns recoverable async failures to the loop and has focused retry tests.
- PR #795 had four actionable unresolved Codex P2 threads. All four were implemented:
  - validate `audioAssetId` as an asset-scoped primitive;
  - include in-scope picture assets in audio projections;
  - authorize `candidateAffectedAssetIds` in the graph scope;
  - require preserve selection pins to match `slotKey`.

## Validation

- `pnpm --filter @popcorn/api exec tsx --test src/lib/orchestrator-context/__tests__/context-boundary.test.ts`
- `pnpm --filter @popcorn/api typecheck`
- `pnpm agent:lint:fix`
- `pnpm agent:validate -- --scope api`

## Review handoff

Reply to each addressed PR #795 thread, resolve only after the fixes are pushed and verified, and report merge blockers/check state.
