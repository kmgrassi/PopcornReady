# Worksheet: WEB-20260729-ASSET-STUDIO

<!-- agent-summary: Durable record for enabling the standalone Asset Studio by default. -->
<!-- agent-summary: The rollout removes the VITE_STANDALONE_CREATION_ENABLED web gate. -->
<!-- agent-summary: Image, video, and soundtrack creation share the authenticated /create route. -->
<!-- agent-summary: Navigation copy and active state must describe the multi-asset destination. -->
<!-- agent-summary: Browser coverage proves image selection and the proposal-confirmation boundary. -->
<!-- agent-summary: Production rollout still follows the repository's ready pull-request workflow. -->
<!-- agent-summary: Link implementation reviews, validation evidence, feedback, and the final PR here. -->

## Goal and acceptance criteria

Make the creator-direct Asset Studio the default authenticated creation entry,
including standalone image creation, remove the obsolete web feature flag, align
desktop/mobile navigation, add behavior-focused browser coverage, update the
authoritative rollout/testing documents, and publish a ready pull request.

## Context and source-of-truth documents

`AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`,
`docs/repository-structure.md`, `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`,
`docs/ui-interaction-model.md`,
`docs/scopes/specialist-agent-orchestration-prs.md`,
`docs/agent-system/creative-director-rollout.md`,
`docs/testing/e2e-test-inventory-and-gaps.md`, and `apps/web/e2e/README.md`.

## Decisions

- Preserve the existing proposal/explicit-confirmation cost boundary.
- Remove the client build-time feature flag instead of setting it true in one
  environment, so source and production behavior cannot drift.
- Keep `/projects/new` available for full video-project creation while routing
  the global Create entry to `/create`.

## Changes

- Removed `VITE_STANDALONE_CREATION_ENABLED`, its environment typing, helper,
  and flag-only unit assertion.
- Mounted `/create` unconditionally inside the authenticated route tree.
- Routed desktop/mobile global Create actions to Asset Studio, changed desktop
  copy to `Create new asset`, and kept the mobile tab active on both standalone
  and full-project creation routes.
- Added creator-goal task-kind unit coverage and mock-backed Playwright coverage
  for the image proposal/explicit-confirmation boundary and mobile navigation.
- Updated rollout, E2E, and manual-test documentation. Historical worksheets
  remain unchanged.

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm --filter @popcorn/web test` — 34/34 passed.
- `pnpm --filter @popcorn/web build` — passed; retained the existing large
  bundle warning.
- `pnpm --filter @popcorn/web exec playwright test
  e2e/asset-studio.spec.ts --project=chromium` — 2/2 passed.
- `pnpm --filter @popcorn/web exec playwright test
  e2e/asset-studio.spec.ts --project=mobile-safari
  --project=mobile-chrome` — 2/2 passed.
- Manual browser inspection at desktop and 390-by-844 mobile widths confirmed
  `/create`, Image selected by default, `Create new asset` desktop copy, active
  mobile Create state, and no document-level horizontal overflow.
- `pnpm agent:lint:fix` — passed for 14 changed files.
- `pnpm agent:validate -- --scope web` — passed repository lint and web
  typecheck.
- The Playwright API server logged missing local Supabase worker configuration;
  the behavior-focused routes were mocked and the tests passed without provider
  spend.

## Independent reviews

- Research/plan review confirmed the flag is web-only, the protected API route
  is already mounted, `/projects/new` should remain for full productions, and
  creative-director/orchestrator rollout flags are out of scope.
- Implementation review found no correctness, UX, navigation, test, or
  documentation defects. The reviewer independently passed unit, typecheck,
  desktop Chromium, and mobile Chrome checks.
- Wrap-up review found the production PR scope safe and narrowly bounded, the
  diff and documentation complete, and the live provider/media smoke gap
  explicit.

## Blockers and risks

- The existing Asset Studio flow depends on a project and creator-direct API
  proposal endpoints; tests must mock these without triggering provider spend.
- Optional references, question/follow-up controls, blocked dependency actions,
  and Use in project remain documented follow-up capability.
- A real provider/media production smoke was not run because it requires a
  chosen production project and incurs provider spend.
- Production deployment occurs after the ready PR is reviewed and merged.

## Next action / handoff

Commit, tag, push, open the ready PR, and follow CI/deployment.
