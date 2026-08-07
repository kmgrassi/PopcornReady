# Worksheet: WEB-20260807-DASHBOARD-PERCEIVED-PERFORMANCE

<!-- agent-summary: Improve perceived dashboard and Studio responsiveness without changing the visual identity. -->
<!-- agent-summary: Saved drafts acknowledge opening immediately and prevent duplicate actions. -->
<!-- agent-summary: The dashboard renders a safe persisted summary while fresh data loads. -->
<!-- agent-summary: Active-run cards show human-readable last-update timestamps. -->
<!-- agent-summary: Add behavior-focused automated coverage and update the E2E inventory. -->
<!-- agent-summary: Exercise changed states in the local browser at desktop and mobile widths. -->
<!-- agent-summary: Ship implementation, documentation, reviews, validation, worksheet, feedback, tag, and open PR together. -->

## Goal and acceptance criteria

- A saved-draft click immediately exposes an accessible “Opening draft…” state, disables duplicate resume/delete actions for that row, and restores the normal row if loading fails.
- The authenticated Home route can render a recently persisted summary during a cold refresh while TanStack Query fetches the authoritative response in the background.
- Persisted dashboard data is isolated by authenticated workspace and expires so it cannot become a durable source of truth.
- Active-run cards show a truthful, human-readable timestamp that refreshes while the route is open.
- Targeted tests, repository validation, and local desktop/mobile browser checks pass.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`
- Impeccable product, layout, typography, interaction, motion, and clarity guidance

## Decisions

- Preserve the committed Popcorn palette, typography, spacing, and component vocabulary; this is an interaction-state pass, not a new visual direction or asset exercise.
- Keep server-owned dashboard state in TanStack Query. A small versioned session snapshot may seed the query as `initialData`, then the normal query immediately revalidates it.
- Scope persisted summaries to the resolved workspace ID, cap their age, validate their shape before rendering, and clear unusable records.
- Treat draft-opening state as ephemeral component state owned by `StudioShell` and announced through the existing semantic button/list structure.
- Derive timestamps from the server-projected `updatedAt` field and refresh relative labels locally without additional network requests.

## Changes

- Added a versioned, five-minute `sessionStorage` dashboard snapshot keyed by exact actor and workspace identity. Runtime validation fails closed, bounds collection sizes and progress values, allowlists persisted fields, and omits signed media URLs.
- Seeded the Home TanStack Query from a valid snapshot while immediately revalidating. Cached content remains usable through refresh and background errors, with quiet updating, retry, focus, and busy-state feedback.
- Added immediate saved-draft opening feedback, duplicate action fencing, exact completion/error recovery, direct-link loop prevention, navigation-race protection, and a restored same-link retry after the failed route settles.
- Added semantic run-update `<time>` labels with deterministic relative thresholds and one minute-level clock per panel.
- Added co-located, token-based styles plus reduced-motion handling without changing the existing visual identity.
- Added focused unit and Playwright coverage and updated the dashboard interaction, scope, and E2E inventory documentation.

## Validation evidence

- `pnpm agent:lint:fix` — passed.
- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web test` — 99 passed.
- `env -u CI VITE_API_URL=http://127.0.0.1:4187 PLAYWRIGHT_WEB_PORT=3187 POPCORN_E2E_API_PORT=4187 pnpm --filter @popcorn/web exec playwright test e2e/dashboard-cached-refresh.spec.ts e2e/studio-draft-opening.spec.ts e2e/dashboard-indeterminate-progress.spec.ts --project=chromium --project=mobile-safari --project=mobile-chrome` — 10 passed after the final semantic and retry hardening changes.
- `pnpm --filter @popcorn/web build` — passed; the pre-existing Vite large-chunk warning remains.
- `pnpm agent:validate -- --scope web` — passed after the final P2 hardening.
- `git diff --check` — passed after the final P2 hardening.
- Local browser, authenticated against local Supabase: Home at 1280×900 retained cached content while showing `Updating Home…`, displayed active and failed run timestamps, and exposed no new console errors. Studio showed `Opening draft…` within 100 ms, retained keyboard focus, fenced resume/delete, and opened the exact persisted draft.
- Local browser at the in-app mobile viewport (requested 390×844; reported content width 375): Home and Studio had no horizontal overflow, cached content and timestamps remained visible, and the opening state/focus ring/delete fence remained readable and usable.

## Independent reviews

- Research review recommended immediate row feedback, explicit background-refresh semantics, and truthful run times.
- Plan review approved the bounded approach with actor/workspace isolation, successful-query-only writes, direct-link/error/race coverage, and non-live timestamp announcements.
- Initial implementation review found actor-key isolation, snapshot allowlisting, deep-link/race, retry, and documentation gaps; all were addressed.
- Implementation re-review cleared P1 privacy/correctness issues and requested stricter optional-field validation, same-link retry restoration, aria-disabled hover suppression, and narrower live-region semantics; all were addressed with regression coverage.
- Wrap-up review found no release-blocking correctness, privacy, accessibility, race, state-management, CSS-module, test, or documentation issue; the change is ready for commit and PR.

## Blockers and risks

- No blocker. The snapshot is intentionally a perceived-performance layer and never suppresses authoritative refreshes or errors.
- Authentication/workspace resolution still gates reading the actor-scoped snapshot. On local infrastructure, `/me` sometimes took about 15 seconds, so the first frame remained a skeleton until identity resolved; cached Home content then appeared while the dashboard query refreshed. A future authenticated-shell cache could address that separate boundary.
- Local Supabase also intermittently logged an upstream timeout resolving the app user; the dashboard correctly retained cached data through it.
- Snapshot age accepts up to 60 seconds of future clock skew, so the effective tolerance can slightly exceed five minutes for a client clock adjustment.
- Existing React Router future-flag console warnings and the Vite large-chunk warning were observed and are not introduced by this change.

## Next action / handoff

- Commit, tag, push, and open the required ready-for-review PR.
