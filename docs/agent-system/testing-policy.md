# Agent Testing Policy

<!-- agent-summary: Tests prove observable behavior and are updated with changed behavior. -->
<!-- agent-summary: Use targeted unit, API, browser, and manual checks in proportion to risk. -->
<!-- agent-summary: Browser coverage belongs in apps/web/e2e and its inventory is the source of truth. -->
<!-- agent-summary: Exercise browser-facing changes manually against the locally running web app. -->
<!-- agent-summary: Automated browser tests complement but do not replace changed-feature inspection. -->
<!-- agent-summary: New tests must state the behavior and failure mode they protect in their name or nearby comment. -->
<!-- agent-summary: Use false-confidence audits periodically and after major harness changes. -->

- Add a targeted regression test for a bug or changed branch whenever practical.
- Every browser-facing feature change—including routes, rendering, styles,
  interactions, client state, and browser-visible loading, empty, and error
  states—must be exercised through its actual user-visible entry point in a
  locally running web app before handoff. Reach an observable changed result in
  a browser and record the route or entry point, affected state, viewport, and
  result in the worksheet. Automated browser coverage complements this
  inspection; it does not replace it. If the local browser run is blocked, the
  change is blocked from complete handoff and PR publication unless the user
  explicitly accepts the documented exception.
- Prefer API-level assertions for contracts and browser assertions for navigation, interaction, and persistence/reload behavior.
- Keep provider-backed and paid checks opt-in; use deterministic fixtures for required CI.
- Update `docs/testing/e2e-test-inventory-and-gaps.md` when E2E coverage or a known gap changes.
- Treat hosted Supabase against local binaries, deployed API health, and a
  deployed browser pass as distinct evidence. Do not label one as another.
- Production mutations require isolated test identity/data, bounded side
  effects, and verified cleanup. The proposed rollout is scoped in
  [`docs/scopes/production-browser-agent-testing.md`](../scopes/production-browser-agent-testing.md);
  PR 1 supplies release identity and route truth only, and grants no login or
  mutation authority until the later sandbox, cleanup, and budget prerequisites
  land.
- Supabase migrations must use unique 14-digit filename versions. Run
  `pnpm db:migrations:validate`; `pnpm agent:validate` and the production
  migration workflow run this preflight before any database push.
- Database read-boundary changes follow
  [`docs/testing/database-contract-tests.md`](../testing/database-contract-tests.md):
  keep the retired-relation guard always on, then separately prove real local
  schema access and authenticated RLS with concrete non-empty fixtures.

Avoid tests that only assert a mocked function was called, assertions coupled to incidental CSS or copy, shared mutable fixtures, and silent skips for required behavior.
