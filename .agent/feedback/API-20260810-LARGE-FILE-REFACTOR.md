# Feedback: API-20260810-LARGE-FILE-REFACTOR

<!-- agent-summary: Review record for the daily large-file refactor. -->
<!-- agent-summary: Project catalog and activity persistence moved out of the V1 store. -->
<!-- agent-summary: Public exports and query tenancy filters remain unchanged. -->
<!-- agent-summary: No new RPC, migration, or database access path was introduced. -->
<!-- agent-summary: Focused store tests and API typecheck are required evidence. -->
<!-- agent-summary: Scoped agent validation is required before handoff. -->
<!-- agent-summary: Independent review availability and follow-ups are recorded below. -->

## Review scope

Reviewed the project catalog extraction from `store.ts` into
`store-project-catalog.ts`.

## Findings

- No behavior changes found in the moved activity, workspace listing, public
  listing, or public bundle queries.
- Workspace, project, visibility, deleted-status, and public-workspace-purpose
  filters are preserved.
- Existing store exports remain available through explicit re-exports.
- The module boundary matches the repository's established `store-storyboard`
  pattern; no new database access path or RPC was introduced.
- Independent reviewer unavailable because `AGENT_REVIEW_COMMAND` is unset;
  local diff review performed instead.

## Follow-up

The remaining `store.ts` work is still substantial and can be split further in
future daily runs, especially the public-project fork and asset persistence
boundaries.

## GitHub review follow-up — 2026-08-17

- The automated Codex review correctly found a public type-contract regression:
  the new module imported the shared `V1Project`, which makes four projection
  fields optional, instead of the stricter store-specific `V1Project`.
- The import now comes from `store-types`, preserving the pre-extraction return
  contract while leaving runtime behavior and database access unchanged.
- Independent implementation/wrap-up review verified the facade re-exports,
  `mapProjectWithProjection` integration after merging current `main`, final
  four-file PR diff, and passing validation; no remaining findings.
