# Worksheet: WEBAPI-20260805-ASSET-FEEDBACK

<!-- agent-summary: Durable record for one bounded task. -->
<!-- agent-summary: Add advisory AI feedback to script, image, and video asset surfaces. -->
<!-- agent-summary: Feedback must not trigger regeneration or mutate the asset graph. -->
<!-- agent-summary: The default question is “How can we improve upon this?” and remains editable. -->
<!-- agent-summary: Keep the interaction object-scoped and available only for ready assets. -->
<!-- agent-summary: Validate API behavior, web behavior, desktop/mobile browser states, and targeted E2E. -->
<!-- agent-summary: Link independent research, plan, implementation, and wrap-up reviews. -->

## Goal and acceptance criteria

- Add a “Receive feedback” entry point for project scripts and ready image/video assets.
- Open an object-scoped dialog with “How can we improve upon this?” prefilled and editable.
- Send the selected object plus the user’s question to the configured AI and show an advisory response.
- Do not create a rerun proposal or otherwise change the source asset.
- Cover success, loading, retry/error, accessibility, desktop, and mobile behavior.

## Context and source-of-truth documents

- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/NORTH_STAR.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- Impeccable product UI guidance

## Decisions

- Treat “Receive feedback” as an advisory critique, separate from graph-mutating
  “Request Changes” proposals.
- Use one exact-target API contract for a media asset ID or the authoritative
  active-script endpoint's asset ID. Never broaden a missing target to the project.
- Run image critique against stored image bytes, video critique against sampled
  frames, and script critique against the typed active script snapshot.
- Persist each completed response as a pooled `critique` data asset with a graph
  edge to the subject and an applied action, without changing the subject or an
  active content selection.
- Present the entry point on owned canonical review surfaces: the asset library
  viewer for images/videos, project script overview/detail, and the project
  watch surface for the selected final video. Project media and storyboard
  thumbnails already deep-link to the canonical asset viewer.
- Keep public discovery/read-only surfaces unchanged because feedback is an
  authenticated model call over workspace-owned source data.

## Changes

- Added a workspace-scoped, idempotent critique endpoint for exact graph assets.
  Script requests use the exact typed script asset snapshot, image requests
  use stored bytes, and video requests use representative sampled frames.
- Persisted successful responses as linked `critique` graph assets and recorded
  `critique_asset` actions without moving content selections. Failed requests
  record a failed action with a structured error.
- Added a reusable accessible feedback dialog and TanStack Query mutation. Wired
  it to owned ready image/video Library viewers, active script overview/detail,
  storyboard and run media, and the selected final-video watch surface.
- Added API service, route, and frame-sampling tests plus Playwright coverage for
  image custom questions, the script default question/mobile layout, and video
  sampling limitations.
- Updated the product, interaction-model, and browser-test source-of-truth docs.

## Validation evidence

- `pnpm --filter @popcorn/api exec tsx --test src/lib/api/v1/__tests__/asset-critique.test.ts src/lib/api/v1/__tests__/video-frame-sampling.test.ts src/routes/v1/__tests__/asset-critique-route.test.ts` — 8 targeted tests passed, including persisted-result replay without a second model call and slug-to-UUID canonicalization.
- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/web typecheck` — passed.
- `PLAYWRIGHT_WEB_PORT=3199 POPCORN_E2E_API_PORT=4199 pnpm --filter @popcorn/web exec playwright test e2e/specs/library-collections.spec.ts --project=chromium` — 9 tests passed.
- `pnpm agent:lint:fix` — passed for 35 changed files.
- `git diff --check` — passed.
- `pnpm agent:validate -- --scope all` — passed, including repository lint,
  workflow, migration, RPC/relation-boundary, web typecheck, and API typecheck.
- Post-merge API and web typechecks passed. The targeted API selection passed 10
  tests (the 8 critique tests plus the project script-approval boundary), and
  the final Library Chromium selection passed all 11 tests, including delayed
  authoritative-script loading and fail-closed error handling.
- Post-merge `pnpm agent:lint:fix`, `git diff --check`, and
  `pnpm agent:validate -- --scope all` passed across the combined 69-file diff.
- Local Vite app and provider-free mock API started successfully. The in-app
  browser reached `/projects/proj-alpha/script`, after which its URL security
  policy blocked all further local-page inspection. Per policy, no alternate
  browser surface or workaround was attempted. The required manual desktop and
  mobile acceptance remains blocked pending explicit user acceptance of this
  exception; Chromium Playwright covers both changed layouts and observable
  result states but does not replace the required manual inspection.

## Independent reviews

- Research review completed by `/root/research_review`: confirmed that existing
  `AiAssetFeedbackDialog` is a rerun-proposal alias and must not be overloaded;
  recommended exact graph targets, provider-neutral vision/text calls, persisted
  critique assets, and script asset-ID projection.
- Plan review requested from `/root/research_review`.
- Plan review completed by `/root/research_review`: required exact-asset-only
  targeting, idempotent retry semantics, no selection movement, durable action
  failure, explicit video limitations, and a script/image/video coverage matrix;
  all were incorporated before implementation.
- Implementation review requested from `/root/research_review`.
- Initial implementation review found that idempotency was not visible at the
  route, script display could diverge from the reviewed snapshot, persistence
  needed crash convergence, exact script reads followed a second pointer, the
  dormant Outputs viewer lacked a path, and source eligibility was checked too
  late. The shared mutation adapter already durably fences all keyed requests;
  the remaining findings were resolved with exact requested-asset reads,
  deterministic action/result IDs, persisted-result replay, pre-action source
  validation, best-effort failure finalization, display fidelity fixes, and an
  Outputs-to-Watch feedback path. Re-review requested.
- Implementation re-review found one remaining slug-to-UUID write-boundary gap;
  the service now uses the resolved canonical source ID for deterministic IDs,
  action inputs, graph edges, replay, and the response, with a regression test.
  No other P1/P2 blockers remained.
- Wrap-up review reran the 8 targeted API tests and full repository validation;
  both passed, with no remaining P1/P2 implementation or documentation blocker
  after this worksheet cleanup.
- Merge-conflict resolution incorporated `origin/main`'s script-first and
  embedding-source work. Both asset-source readers remain available, while web
  script surfaces now take the immutable draft and exact graph asset ID from
  `GET /projects/:projectId/script` instead of duplicating those fields on the
  general project projection. Merge review required the overview to include
  the authoritative script query in its loading/error boundary; delayed and
  failing browser regressions now cover that behavior. Final re-review found no
  remaining P1/P2 implementation blocker.

## Blockers and risks

- Manual local browser inspection is blocked by the browser tool's URL security
  policy. `AGENT_WORKFLOW.md` requires explicit user acceptance before this work
  may be handed off or opened as a complete PR.
- User explicitly accepted the recorded manual-browser exception on 2026-08-06
  and requested that the completed work be opened as a PR.

## Next action / handoff

- Complete merge review and full validation, commit the merge resolution, and
  push the updated ready-for-review PR.
