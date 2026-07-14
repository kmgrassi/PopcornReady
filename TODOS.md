# Agent Task Queue

<!-- agent-summary: This is the repository-visible queue for bounded agent-ready maintenance and follow-up work. -->
<!-- agent-summary: Each item has priority, owner boundary, acceptance criteria, and a source link. -->
<!-- agent-summary: Agents may select only unblocked tasks that need no product or external-authority decision. -->
<!-- agent-summary: Move completed items to the completed section with their PR and worksheet tag. -->
<!-- agent-summary: Keep product-roadmap proposals in their owning scope docs until they are ready to execute. -->
<!-- agent-summary: Do not store credentials, customer data, or private incident detail here. -->
<!-- agent-summary: Delivery lead maintains ordering during feedback reviews and night shifts. -->

## Ready

- [ ] **P1 — Add stable visual-regression fixtures for one representative web route.** Owner: web quality. Acceptance: deterministic Playwright screenshot assertion, documented update flow, and CI artifact on failure. Source: `docs/agent-system/performance-and-visual-regression.md`.
- [ ] **P1 — Define a repeatable API latency benchmark for a high-traffic route.** Owner: API performance. Acceptance: fixed fixture, recorded metric/budget, and a non-flaky CI or scheduled execution strategy.
- [ ] **P1 — Add local-Supabase E2E coverage for dashboard project creation.** Owner: web/API. Acceptance: fulfill the P0 gap in `docs/testing/e2e-test-inventory-and-gaps.md`.

## Completed

None yet.
