# Worksheet: WEB-20260804-PROD-BROWSER-FIXES

<!-- agent-summary: Resolve actionable findings from the 2026-08-04 production browser pass. -->
<!-- agent-summary: Replace retired failed-stage retry promises with Request Changes guidance. -->
<!-- agent-summary: Replace the migration-era wildcard route with a useful branded not-found page. -->
<!-- agent-summary: Prove protected local-mode Library and Activity deep links finish loading before changing auth behavior. -->
<!-- agent-summary: Add focused unit and browser coverage for the corrected behavior and copy. -->
<!-- agent-summary: Exercise desktop and mobile routes through the local browser entry points. -->
<!-- agent-summary: Commit implementation, tests, documentation, worksheet, and feedback in one open PR. -->

## Goal and acceptance criteria

Address every actionable result from the production manual browser test:

- Failed runs no longer promise the retired “retry from the failed stage” flow.
- Unknown routes show a useful, branded recovery page rather than migration copy.
- A direct protected local-mode load of Library and Activity is covered through the
  complete loading transition and resolves real fixture data.
- Desktop and mobile browser checks show no horizontal overflow or console
  errors on the affected routes.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- Impeccable product-register guidance

## Research notes and decisions

- Production re-verification showed that direct `/library/projects` and
  `/activity` loads do resolve correctly. The initial report sampled the DOM
  inside the shared 180 ms anti-flash window before the loading state appeared.
  Do not add an auth/query workaround for a behavior that is already correct;
  add a fixture-backed direct-load regression instead.
- The stale recovery language is owned by `nextAction.ts` and
  `ActiveRunsPanel.tsx`.
- The wildcard route still uses the generic migration `Placeholder` in
  `App.tsx`; give it a dedicated route component and co-located CSS Module.

## Changes

- Replaced failed-run Dashboard/Activity copy with truthful project-scoped
  Request Changes guidance and removed the retired failed-stage retry promise.
- Replaced the creator-visible terminal retry hint with explicit recovery modes:
  a funded insufficient-credit failure keeps its real Continue generation path,
  other retryable failures point to project Request Changes, and nonretryable
  failures invent no recovery action.
- Added a dedicated, responsive `NotFoundPage` with a single homepage CTA and a
  secondary dashboard path, using a co-located CSS Module and existing tokens.
- Added delayed workspace-bootstrap browser coverage for direct protected
  local-mode Library and Activity loads, failed-copy assertions, terminal
  recovery-mode unit coverage, and desktop/mobile not-found assertions.
- Updated the E2E README and inventory to describe the current coverage and the
  anti-flash test boundary accurately.

## Validation evidence

- Production recheck: direct `/library/projects` resolved 24 projects and direct
  `/activity` resolved five run links when waiting for known populated content;
  the reported deep-link failure was withdrawn as an anti-flash sampling error.
- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web test` — passed, 80 tests.
- Focused Chromium Playwright across auth/routing, Dashboard/Activity recovery,
  and run-progress actions — passed after tightening the not-found locator; the
  final affected run-progress rerun passed 8/8.
- Mobile Chrome and mobile Safari auth-route smoke — passed 2/2; the focused
  Chromium not-found test also sets a 390-by-844 viewport and asserts no
  document overflow.
- Impeccable detector — passed with no findings across the changed UI files.
- `pnpm agent:lint:fix` — passed across 16 changed files.
- `pnpm agent:validate -- --scope web` — passed, including agent lint, workflow
  policy tests, migration validation, and web typecheck.
- Local manual browser pass with the real Vite route and a read-only fixture API:
  `/dashboard` at 1280-by-720 and `/activity` at 390-by-844 showed the new failed
  recovery copy, no `retry` promise, and no horizontal overflow; unknown routes
  at both viewports showed the branded recovery page with no overflow. The only
  console messages were the existing React Router development future warnings.

## Independent reviews

- Research checkpoint: identified the `204` observations as CORS OPTIONS
  preflights, confirmed query enablement follows `/me`, and—after the production
  outcome recheck—recommended no auth runtime change. It located the shared
  failed copy, terminal retry hint, wildcard placeholder, and owning tests/docs.
- Plan checkpoint: approved the narrow behavior/copy/404 plan, required an
  outcome-based delayed-bootstrap fixture rather than a timing assertion, kept
  Home as the universal primary 404 recovery, and prohibited false promises that
  Request Changes lives directly on every failed-run page.
- Implementation checkpoint: found competing generic Request Changes and
  insufficient-credit continuation guidance. Explicit recovery modes and unit
  coverage resolved the blocker; re-review passed with no remaining
  implementation issue. Documentation wording was tightened to protected
  local-mode coverage.
- Wrap-up checkpoint: passed with no release blockers. One documentation-only
  finding tightened this worksheet's greppable summary from “authenticated” to
  “protected local-mode” so it does not overstate Supabase-auth coverage.

## Blockers and risks

- Production browser testing is read-oriented; local deterministic fixtures
  will exercise the behavior without mutating production data.
- The local E2E API server logs expected missing-Supabase worker errors while
  fixture routes are intercepted; all targeted browser assertions passed.

## Next action / handoff

Commit, tag, push, and publish the ready-for-review pull request.
