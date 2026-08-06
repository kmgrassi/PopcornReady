# Worksheet: WEB-20260805-PROJECT-ASSET-VIEW

<!-- agent-summary: Durable record for direct project-page access to ready media assets. -->
<!-- agent-summary: The project overview must not hide a successful asset behind a failed parent run. -->
<!-- agent-summary: Ready assets open through the canonical Library viewer by stable project and asset identity. -->
<!-- agent-summary: Final exports remain distinct from project assets and retain the Watch action. -->
<!-- agent-summary: Desktop and mobile browser states require direct validation. -->
<!-- agent-summary: Targeted Playwright coverage protects the ready-asset fallback. -->
<!-- agent-summary: Commit this worksheet, feedback, implementation, documentation, and tests together. -->

## Goal and acceptance criteria

Make a ready image, video, or audio asset discoverable and directly viewable from
its owned project overview, including when the overall generation run failed
after saving the asset.

- The project overview identifies the latest recent standalone run separately
  from current full-video activity, then resolves its exact ready stage item.
- Desktop exposes a direct link to the canonical Library asset viewer.
- Mobile makes the ready asset the primary next step when no final output is
  playable, without displacing an existing final-video Watch action.
- The destination contains both `assetId` and `projectId` so exact hydration can
  recover assets outside the first Library page.
- A behavior-focused Playwright test covers the fallback on desktop and mobile.

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

## Decisions

- Reuse `/library/assets?assetId=…&projectId=…` rather than building a second
  media viewer on the project route.
- Treat a final output and a generated project asset as distinct: Watch remains
  primary when a playable output exists; otherwise the latest ready asset is
  the creator's primary next step.
- Do not infer the result from the unordered project asset collection. Use the
  standalone run's succeeded image/video/audio stage item and stable asset ID.
- Select current stage activity and the latest standalone asset run separately,
  so newer full-video work or a newer empty standalone attempt does not hide an
  already-saved standalone result.
- Poll active standalone details with the same cadence as the run surface, and
  include the recent-runs request in asset discovery's loading, error, and retry
  state.
- Preserve the creator-direct `presentationKind` discriminator in workspace run
  summaries; the project page cannot select standalone runs from production data
  without that wire field.
- A real ready asset outranks script review, but an asset lookup's loading or
  error state never masks an existing storyboard recovery or script-review action.

## Changes

- Added deterministic ready-media selection and media-specific copy helpers.
- Hoisted run-detail queries into the project route and separated current-stage
  selection from recent standalone-result selection.
- Added desktop header and stage-panel links plus a mobile primary action to the
  canonical Library viewer.
- Kept Watch above the asset action when a playable final output exists, and put
  the saved asset ahead of unrelated storyboard failure/generation fallbacks.
- Added unit, desktop Chromium, mobile Safari, and mobile Chrome coverage.
- The browser fixture begins with an active empty standalone run, waits for the
  detail poll to reveal its asset, then layers in newer active and failed runs.
- Updated the UI interaction model and E2E ownership documents.
- Extracted the creator-direct presentation mapping so full run detail and
  workspace summaries share one projection rule, with positive standalone and
  negative Creative Director boundary assertions.
- Merged current `main` and preserved its script-review project-page behavior;
  added a mobile regression where a prior standalone detail request fails while
  script review remains actionable.

## Validation evidence

- `pnpm agent:lint:fix` — passed with 12 intended changed files.
- `pnpm --filter @popcorn/web typecheck` — passed after polling and request-state
  review fixes.
- `pnpm --filter @popcorn/web test` — 88 passed after polling and request-state
  review fixes.
- `pnpm --filter @popcorn/web exec playwright test e2e/project-upload-more.spec.ts
  --project=chromium --project=mobile-safari --project=mobile-chrome` — 4 passed,
  including polling from active to ready and failed/mixed-run retention.
- Manual local browser fixture at `/projects/manual-ready-asset`:
  - desktop 1440×900: project header and failed-run stage panel both exposed
    `View video asset`; the link opened the canonical Library viewer route;
  - mobile 390×844: status read `Video asset ready to view`, the gold CTA was
    full-width, and the page stayed within the viewport.
- `git diff --check` — passed after implementation review fixes.
- `pnpm agent:validate -- --scope web` — passed, including agent lint,
  GitHub Actions policy tests, migration checks, and web typecheck.
- Independent wrap-up verification also ran the broader Playwright suite across
  Chromium, mobile Safari, and mobile Chrome: 170 passed with 6 environment
  skips; the changed project-overview case passed in all three.
- PR feedback follow-up:
  - targeted workspace-list and orchestrator projection tests — 47 passed;
  - API and web typechecks — passed;
  - web unit tests — 88 passed;
  - project ready-asset Playwright across Chromium, mobile Safari, and mobile
    Chrome — 4 passed;
  - script-review precedence Playwright across the same projects — 3 passed.
- `pnpm agent:lint:fix` — passed on the 70-file merge candidate.
- `pnpm agent:validate -- --scope all` — passed after conflict resolution and
  feedback fixes, including API/web typechecks and all repository boundary checks.
- Post-merge manual local browser fixture at `/projects/manual-ready-asset`:
  desktop 1440×900 retained both direct viewer links; mobile 390×844 retained
  the ready status and full-width gold CTA with no alert or viewport overflow;
  the CTA navigated to the exact canonical Library URL.

## Independent reviews

- Research review recommended using succeeded run stage items and the canonical
  Library viewer, with explicit mobile coverage.
- Plan review rejected the unordered project asset collection and recommended
  separate exact-run selection plus Watch-first mobile precedence.
- Implementation review found current-run coupling and storyboard precedence;
  both were addressed by selecting the recent standalone run independently and
  moving the ready asset ahead of storyboard recovery.
- Follow-up implementation review found missing active-run polling and incomplete
  runs-list loading/error/retry aggregation; both were addressed and the polling
  transition was added to Playwright coverage.
- Final implementation re-review found no remaining actionable correctness
  issues.
- Wrap-up review found no code, scope, acceptance, documentation, worksheet, or
  PR-readiness blockers.
- PR-comment research confirmed the production summary omission as the root
  cause and found no missing type, persistence, or migration change.
- Merge-plan review approved the shared projection approach and found one
  mobile precedence regression; asset loading/error was moved behind existing
  storyboard and script-review workflow actions and covered in Playwright.
- Post-fix implementation review found no remaining correctness or conflict
  blockers and independently verified the API projection, ready-asset helpers,
  web typecheck, diff hygiene, and merge index.
- Final wrap-up review found the staged diff conflict-free, scoped against
  `origin/main`, fully documented, and ready to publish.

## Blockers and risks

- The recent workspace run query is intentionally limited to six. Complete
  historical result discovery would require a purpose-built ordered projection;
  this change covers the project overview's recent activity contract.
- A ready asset is never described as a final rendered output; only final outputs
  receive the Watch action.

## Next action / handoff

Commit the resolved merge and feedback fixes, retag the worksheet, push, then
reply to and resolve the addressed GitHub thread.
