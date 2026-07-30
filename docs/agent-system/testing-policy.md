# Agent Testing Policy

<!-- agent-summary: Tests prove observable behavior and are updated with changed behavior. -->
<!-- agent-summary: Use targeted unit, API, browser, and manual checks in proportion to risk. -->
<!-- agent-summary: Browser coverage belongs in apps/web/e2e and its inventory is the source of truth. -->
<!-- agent-summary: Run the application path yourself; mocked tests alone are insufficient for user flows. -->
<!-- agent-summary: Avoid asserting implementation details, snapshots without intent, and mocks as the only proof. -->
<!-- agent-summary: New tests must state the behavior and failure mode they protect in their name or nearby comment. -->
<!-- agent-summary: Use false-confidence audits periodically and after major harness changes. -->

- Add a targeted regression test for a bug or changed branch whenever practical.
- Prefer API-level assertions for contracts and browser assertions for navigation, interaction, and persistence/reload behavior.
- Keep provider-backed and paid checks opt-in; use deterministic fixtures for required CI.
- Update `docs/testing/e2e-test-inventory-and-gaps.md` when E2E coverage or a known gap changes.
- Treat hosted Supabase against local binaries, deployed API health, and a
  deployed browser pass as distinct evidence. Do not label one as another.
- Production mutations require isolated test identity/data, bounded side
  effects, and verified cleanup. The proposed rollout is scoped in
  [`docs/scopes/production-browser-agent-testing.md`](../scopes/production-browser-agent-testing.md);
  it grants no authority until its prerequisite PRs land.
- Supabase migrations must use unique 14-digit filename versions. Run
  `pnpm db:migrations:validate`; `pnpm agent:validate` and the production
  migration workflow run this preflight before any database push.

Avoid tests that only assert a mocked function was called, assertions coupled to incidental CSS or copy, shared mutable fixtures, and silent skips for required behavior.
