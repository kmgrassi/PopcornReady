# Worksheet: WEBAPI-20260803-ASSET-RECOVERY

<!-- agent-summary: Fix creator-direct terminal completion for long enhanced prompts. -->
<!-- agent-summary: Recover ready run outputs independently of the terminal domain report. -->
<!-- agent-summary: Show generated media in Asset Studio even when later bookkeeping fails. -->
<!-- agent-summary: Cover the contract and recovery paths with API and browser tests. -->
<!-- agent-summary: Exercise the local production-shaped route at desktop and mobile widths. -->
<!-- agent-summary: Record independent reviews, validation, documentation, and PR evidence. -->
<!-- agent-summary: Commit and tag the finished work as worksheet/WEBAPI-20260803-ASSET-RECOVERY. -->

## Goal and acceptance criteria

- A creator-direct request with a prompt longer than 500 characters can finish its terminal domain report.
- The full approved prompt remains the task objective and instruction; acceptance evidence uses a concise trusted criterion.
- The creator-direct status endpoint returns ready assets created by the run even when no terminal `domain_report` was persisted.
- Asset Studio previews a recovered image, video, or audio result and explains that a later failure did not discard it.
- Targeted API tests, browser E2E, local desktop/mobile manual checks, and repository validation pass.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, `docs/repository-structure.md`
- `docs/NORTH_STAR.md`, `docs/ui-interaction-model.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`
- `docs/scopes/generation-progress-ui.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`

## Decisions

- Keep the complete approved prompt in the digest, task objective/instruction,
  run summary, and action provenance. Use a fixed, server-authored criterion for
  each creator-direct task kind so terminal evidence stays within 500 characters.
- Recover candidates only from the requested run's applied actions, then retain
  only domain-valid, ready assets that hydrate through the authenticated
  workspace/project boundary. Keep report outputs first and deduplicate.
- Treat ready asset persistence and run completion as separate facts: active
  runs keep polling after a preview appears, while failed runs show saved-result
  copy without being relabeled successful.
- Render the primary ready image, video, or audio in the existing status surface
  and retain the project-assets link for the complete output set.

## Changes

- `apps/api/src/routes/v1/agent-creations.ts` derives bounded per-kind criteria
  and recovers exact-run outputs when terminal report persistence fails.
- API tests cover every task kind with a 4,000-character prompt, terminal report
  evidence, deterministic recovery/deduplication, validation degradation,
  infrastructure propagation, and rejection before privileged reads.
- `apps/web/src/routes/StandaloneCreationPage.tsx` previews ready media during
  wrap-up and after a terminal failure, with accessible video/audio labels and
  truthful saved-result messaging. PR review follow-up routes those previews
  through the shared signed-media query for expiry and load-error recovery.
- Creator status now returns explicit nullable media expiry and unconditional
  private/no-store headers so temporary credentials are not response-cached.
- Browser coverage exercises image/video/audio recovery, active polling,
  mobile overflow, and the existing terminal-state matrix.
- Updated the orchestration, prompt-enhancement, progress, interaction, and E2E
  contracts to document the split between task detail, completion criteria,
  output persistence, and terminal run state.

## Validation evidence

- `pnpm exec tsx --test src/routes/v1/__tests__/agent-creations.test.ts` in
  `apps/api`: 16 passed after PR review follow-up.
- `pnpm --filter @popcorn/web exec playwright test e2e/asset-studio-progress.spec.ts`:
  8 passed across Chromium, mobile Chrome, and mobile Safari after adding
  proactive-expiry and load-error recovery.
- Full web Playwright suite during implementation: 137 passed, 5 skipped.
- `pnpm agent:lint:fix`: passed.
- `pnpm agent:validate -- --scope all`: passed, including API/web typechecks,
  migration policy, RPC boundary, and relation boundary validation.
- Manual local route check used the real Vite application entry point with
  production-shaped intercepted API responses. The failed run displayed its
  recovered image and saved-result copy at 1350px desktop and a 390px requested
  mobile viewport, with document width equal to viewport width and no page
  errors. Existing React Router v7 future-flag warnings remained.
- PR-comment manual check used the same local entry point with a near-expiry
  orange seed URL and a distinct blue focused-media response. The terminal
  failed-run preview visibly changed to the fresh focused URL at desktop and
  390px mobile widths, with no horizontal overflow or page errors.
- An accidental repository-wide API test invocation surfaced five unrelated
  baseline failures: two missing migration fixture files and three stale
  expectations. The focused tests and required repository validation pass.

## Independent reviews

- Research: approved. Recommended short task-kind criteria while preserving the
  full prompt, and exact-run/project/ready validation for recovered outputs.
- Plan: approved. Required report-first deterministic merge/deduplication,
  per-asset not-found degradation, infrastructure propagation, and distinct
  active-output versus failed-with-saved-output presentation.
- Implementation: approved after fixing a documentation fragment, adding
  accessible native-media labels, and adding the negative actor-boundary test.
- Wrap-up: approved after changing recovery from all-or-nothing validation to
  per-candidate production validation. The reviewer confirmed valid outputs
  survive a stale sibling, infrastructure failures propagate, prior findings
  are resolved, and no release blockers remain.
- PR-comment research: approved both review findings and identified the existing
  no-store policy, nullable expiry projection, and shared TanStack media query.
- PR-comment plan: approved with required-nullable expiry, a route-level header
  test, authoritative refreshed-null handling, separate browser recovery cases,
  and real auth/workspace cache scoping.
- PR-comment implementation: approved with no findings after independently
  checking no-store coverage, nullable expiry, cache isolation, authoritative
  refreshed-null handling, media events, tests, and documentation.
- PR-comment wrap-up: approved with no findings or release blockers after
  confirming the observable API/browser coverage, local desktop/mobile
  evidence, documentation, and required repository validation.

## Blockers and risks

- A status projection must expose only ready, same-project outputs created by the requested run.
- A generated output can become visible before a still-active run finishes; the UI must keep polling and label that state truthfully.

## Next action / handoff

Commit and push the fixes. Leave the two review threads open for reviewer
resolution unless the user separately authorizes replying or resolving them on
GitHub.
