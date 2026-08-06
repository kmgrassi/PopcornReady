# API-20260805-LARGE-FILE-REFACTOR feedback

<!-- agent-summary: The V1 store's read-oriented asset catalog now has a focused module. -->
<!-- agent-summary: Existing store exports and project bundle behavior remain compatible. -->
<!-- agent-summary: Workspace listings, watch media, dashboard, and discovery reads moved together. -->
<!-- agent-summary: Targeted API tests passed with integration-only skips documented. -->
<!-- agent-summary: API typechecking and scoped repository validation passed. -->
<!-- agent-summary: Independent reviewer was unavailable and local review covered the diff. -->
<!-- agent-summary: The change is ready for open pull request review. -->

`store.ts` first dropped from 7,032 to 6,574 lines when the read-oriented asset
catalog moved to `store-asset-discovery.ts`. This follow-up moved storyboard
row mapping, hydration, validation, and save persistence to
`store-storyboard.ts`, bringing `store.ts` to 5,596 lines while keeping the
existing store exports and route contracts stable.

Validation: storyboard/keyframe tests passed (25); focused store,
semantic-search, and media-url tests passed (16 passed, 14 skipped); API
typecheck and `pnpm agent:validate -- --scope api` passed. The independent
reviewer was unavailable, so implementation and wrap-up review were completed
locally.

PR #895 later conflicted with `main` at the shared asset mapper. The conflict
was resolved by retaining both the incoming persisted embedding-source
projection and the refactor's async asset mapper; the branch is now
mergeable, with required checks still running on GitHub.
