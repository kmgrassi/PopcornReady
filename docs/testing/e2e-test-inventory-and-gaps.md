# End-to-End Test Inventory and Gaps

Date: 2026-06-16

This inventory covers the active split app described in `CLAUDE.md`: the Vite
React SPA in `apps/web` and the Express API in `apps/api`. The legacy Next
surface under `src/` still has tests, but new end-to-end coverage should target
the split app unless a legacy regression directly blocks migration.

## Current Coverage Snapshot

- A first `apps/web` Playwright harness now exists with
  `e2e/storyboard-editor.spec.ts`, covering the storyboard editor's
  write-then-reload path.
- Existing automated coverage is mostly backend and package-level Node tests:
  80 `*.test.ts(x)` / `*.spec.ts(x)` files total, including 65 under `apps/api`.
- `apps/api` tests cover many API/service units, route handlers, storage,
  orchestrator tools, eval services, and generation helpers, but they do not
  prove that the web UI, auth/session wiring, API base URL, TanStack Query cache
  behavior, polling, media playback, and user workflows work together in a
  browser.
- Manual smoke docs exist under `docs/manual-tests/` for selected orchestration
  and asset-sharing flows, but they are not executable e2e coverage.

## Recommended E2E Harness

Use Playwright for the first e2e layer.

- Target package: add an `apps/web`-owned e2e suite, because the browser is the
  user boundary and the SPA owns the cross-route workflows.
- Default mode: run against `AUTH_MODE=local` and local/mock providers so tests
  can seed deterministic projects, assets, runs, timelines, and eval data
  without depending on paid model providers.
- Test data: build on the existing test-sandbox primitives instead of inventing
  another fixture layer. Supabase-backed e2e should create `internal_test`
  workspaces/projects through `test_sandboxes` and clean them up with
  `delete_test_sandbox()`. Local-backend e2e can continue to use `.local/dev-db`
  and `.local/media` when `DB_BACKEND=local`.
- CI split: keep smoke e2e small and required; run long provider/storage
  integration tests separately behind explicit secrets.

## Development Data Modes

- `AUTH_MODE=local` resolves to the deterministic `dev_workspace`.
- Older/local code paths still use `.local/dev-db/` and `.local/media` when
  `DB_BACKEND=local`.
- Supabase-backed API tests can point at local or dev Supabase with
  `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- `supabase/migrations/20260615130000_production_test_sandboxes.sql` adds
  `workspaces.purpose` values such as `user`, `internal_test`, and `fixture`,
  plus `test_sandboxes` for isolated production/dev smoke roots.
- The orchestrator tool-test harness already creates throwaway
  `internal_test` workspaces/projects, writes real rows, and safely deletes
  them through `delete_test_sandbox()`. Browser e2e setup should reuse this
  lifecycle pattern and only add web-specific seed helpers where needed.
- The manual harness is documented in `apps/api/src/lib/tool-tests/README.md`
  and runs with:

```sh
NODE_ENV=development AUTH_MODE=local ENABLE_TOOL_TEST_HARNESS=1 pnpm dev:api
```

## E2E Inventory

### 1. App Shell, Routing, and Auth

Critical flows:

- Public home renders and can navigate to login, signup, and authenticated app
  entry points.
- Unauthenticated hosted-mode user is redirected or blocked from protected
  routes: `/dashboard`, `/library/*`, `/studio`, `/settings`,
  `/projects/:projectId/storyboard`, `/projects/:projectId/watch`, and
  `/projects/:projectId/runs/:runId`.
- Local dev/auth-disabled mode can access protected app surfaces and resolves
  `/api/v1/me` to a deterministic workspace.
- Supabase-hosted login succeeds, persists browser session, exposes the account
  in settings, and sign-out clears the session and returns to public state.
- Invalid login and unconfirmed email errors surface readable messages.
- Redirect compatibility works: `/projects`, `/runs`, `/assets`, `/outputs`,
  `/evals`, `/projects/new`, and bare `/library` land on the intended SPA route.
- Unknown routes render the not-found placeholder.

Primary API contracts involved:

- `GET /api/v1/health`
- `GET /api/v1/me`
- Supabase browser auth calls

Current gap:

- No executable browser auth/routing coverage exists.

### 2. Studio Draft and Prompt-Only Generation Happy Path

Critical flows:

- Opening `/studio` shows the empty state and can create a persisted draft.
- A user can fill the brief step, move through source footage, story direction,
  generation setup, and review setup without losing state.
- Draft state persists through reload and can be resumed from `/studio?draft=...`.
- Starting generation creates or reuses a project, starts a prompt-only or fully
  mocked generation run, and navigates to
  `/projects/:projectId/runs/:runId?studioDraft=...`.
- The progress view polls the run, updates stage/status UI, and redirects back
  to `/studio?draft=...&step=review` when a studio-linked run succeeds.
- The review view loads the generated project, latest timeline artifact, clips,
  and segment notes.

Primary API contracts involved:

- `GET/POST /api/v1/workspaces/:workspaceId/studio-drafts`
- `GET/PUT/DELETE /api/v1/workspaces/:workspaceId/studio-drafts/:draftId`
- `GET/POST /api/v1/projects`
- `POST /api/v1/projects/:projectId/generation-entrypoints/prompt`
- `GET /api/v1/projects/:projectId/generation-runs/:runId`
- `GET /api/v1/projects/:projectId/artifacts/:artifactId`
- `GET /api/v1/projects/:projectId/timelines/latest`
- `GET /api/v1/workspaces/:workspaceId/assets`

Current gap:

- Backend tests cover pieces of run creation and orchestration, but no browser
  test proves the wizard, draft persistence, run creation, polling, and review
  handoff work as one flow.

### 3. Uploaded-Footage Generation Path

Critical flows:

- In Studio, choose uploaded footage mode, attach one or more test media files,
  and submit the flow.
- Upload registration creates asset rows, stores media through the configured
  local/object store adapter, and returns a job.
- Starting the uploaded-footage generation run includes the selected asset IDs
  and lands on the progress page.
- The Library assets tab shows uploaded assets and the generated run references
  them.

Primary API contracts involved:

- `POST /api/v1/projects/:projectId/uploads`
- `POST /api/v1/projects/:projectId/generation-entrypoints/uploaded-footage`
- `GET /api/v1/workspaces/:workspaceId/assets`
- `GET /api/v1/workspaces/:workspaceId/generation-runs`

Current gap:

- `/uploads` is currently browser-local staging only. Persisted upload behavior
  is reachable through the Studio/API path, but there is no e2e fixture proving
  file selection, upload registration, storage URL generation, and generation
  start together.

### 4. Run Progress, Review Gates, and Recovery

Critical flows:

- A queued/running run displays stage rail/checklist progress and continues
  polling while non-terminal.
- Canceling an ungated run posts the cancel action, updates terminal UI, and
  clears the last-run hint.
- A review-gated run exposes approve/reject controls, posts the selected action
  with optional note, clears the note on success, and resumes polling.
- Failed run displays terminal failure details and keeps navigation back to
  Studio available.
- A progress page opened before data is loaded displays the last-run recovery
  hint from browser storage.

Primary API contracts involved:

- `GET /api/v1/projects/:projectId/generation-runs/:runId`
- `POST /api/v1/projects/:projectId/generation-runs/:runId/approve`
- `POST /api/v1/projects/:projectId/generation-runs/:runId/reject`
- `POST /api/v1/projects/:projectId/generation-runs/:runId/cancel`

Current gap:

- API tests cover orchestrator-run actions, but the UI polling/action/recovery
  behavior has no end-to-end coverage.

### 5. Review, Timeline Revision, and Export

Critical flows:

- Review loads the latest generated timeline and clips.
- Inline segment edits update the preview/export state in the browser.
- Submitting review feedback posts a timeline revision request and surfaces
  pending/error/success states.
- Export step starts an MP4 export with quality, duration policy, and captions
  settings.
- Export polling detects completion and loads the resulting artifact.
- Completed export appears in Library outputs and the project watch page plays
  the output.

Primary API contracts involved:

- `POST /api/v1/projects/:projectId/timelines/:timelineId/revisions`
- `POST /api/v1/projects/:projectId/timelines/:timelineId/exports`
- `GET /api/v1/projects/:projectId/exports/:jobId`
- `GET /api/v1/projects/:projectId/artifacts/:artifactId`
- `GET /api/v1/workspaces/:workspaceId/outputs`
- `GET /api/v1/projects/:projectId/watch`

Current gap:

- Timeline/export backend coverage exists in service-level tests, but no e2e
  test verifies the UI can revise, export, poll, list the output, and play it.

### 6. Library Collections

Critical flows:

- `/library` redirects to `/library/projects`.
- Projects tab loads project cards, paginates with "Load more", opens
  storyboard links, and filters runs by project through query string links.
- Runs tab filters by status, paginates, and opens a run progress page.
- Assets tab filters by kind/source, opens the media viewer, refreshes missing
  media URLs, toggles public/private visibility with optimistic update and
  rollback on failure, and navigates to project-scoped views.
- Outputs tab opens the media viewer, paginates, and navigates to Watch and
  project links.
- Empty, loading, and API error states render with retry controls.

Primary API contracts involved:

- `GET /api/v1/projects`
- `GET /api/v1/workspaces/:workspaceId/generation-runs`
- `GET /api/v1/workspaces/:workspaceId/assets`
- `GET /api/v1/workspaces/:workspaceId/outputs`
- `GET /api/v1/assets/:assetId/media`
- `PATCH /api/v1/projects/:projectId/assets/:assetId/visibility`

Current gap:

- Dashboard collection query hooks have no browser tests for pagination,
  filters, cache invalidation, optimistic mutation, or media viewer behavior.

### 7. Storyboard Editor

Critical flows:

- Project storyboard page loads an existing storyboard or creates an editable
  default when no storyboard exists.
- User can edit scene fields, add/remove/reorder scenes, edit beats,
  add/remove/reorder beats, move beats across scenes, and save.
- Save writes the storyboard, updates status to saved, invalidates library
  project state, and reloads persisted data correctly on page refresh.
- Missing project/storyboard errors link back to Studio.

Primary API contracts involved:

- `GET /api/v1/projects/:projectId/storyboard`
- `PUT /api/v1/projects/:projectId/storyboard`
- Storyboard route-group endpoints for scenes, beats, and panels where richer
  editor flows start using them.

Current coverage:

- `apps/web/e2e/storyboard-editor.spec.ts` loads a seeded storyboard, edits
  scene and beat fields, adds a scene, adds/removes beats, moves a beat across
  scenes, saves through the real `PUT /api/v1/projects/:projectId/storyboard`
  client path, and reloads to verify persisted data renders.

Remaining gap:

- API storyboards have tests, and the editor has initial browser coverage, but
  richer reorder permutations and Supabase-backed sandbox seeding are still not
  covered.

### 8. Project Watch

Critical flows:

- Project with render media loads `/projects/:projectId/watch`, shows metadata,
  and renders a playable `<video>` with poster when available.
- Project without render media redirects to the storyboard fallback URL.
- API errors render an actionable error panel.
- Storyboard and Library links preserve useful navigation.

Primary API contracts involved:

- `GET /api/v1/projects/:projectId/watch`

Current gap:

- No browser coverage proves video element rendering, fallback redirects, or
  watch-page error handling.

### 9. Evals Dashboard and Admin Workbench

Critical flows:

- `/library/evals` and `/evals` redirect/load the eval suite dashboard.
- Suite cards load, selecting latest run populates the cases-by-stages grid,
  verdict flips, and calibration panels.
- API failure states for suites, run detail, and diffs show retry/error UI.
- Admin access control blocks `/admin/evals` for non-admin hosted users and
  allows local/admin users.
- Workbench "Run judge" posts a judgment, updates the card badge/rationale, and
  surfaces failures.

Primary API contracts involved:

- `GET /api/v1/eval/suites`
- `GET /api/v1/eval/runs/:runId`
- `GET /api/v1/eval/runs/:runId/diff?against=...`
- `POST /api/v1/eval/judgments`

Current gap:

- The dashboard has a real client but no e2e coverage. The admin workbench still
  seeds artifacts from fixtures because bounded generation workbench execution
  is not fully wired; e2e should cover the current judgment action now and add
  live workbench-run coverage once `prompts_only` + `stopAfter` is implemented.

### 10. Secondary UI Surfaces

Critical flows:

- Settings loads workspace/account state, toggles theme, links to secondary
  surfaces, and signs out when hosted auth is active.
- Uploads page stages local image/video/audio files, updates counts/size, opens
  media viewer, navigates previous/next, and removes staged files.
- Templates page renders all template groups/cards and template links redirect
  through the retired `/projects/new` compatibility path to Studio.
- Brand kit page updates name/color/font/tone preview and generated prompt
  summary.
- Admin landing page renders the operator/style guide surface.
- Dev routes render in development mode if they remain intentionally reachable.

Primary API contracts involved:

- `GET /api/v1/me`
- Supabase sign-out for hosted auth

Current gap:

- These pages have no automated smoke coverage. Several are local-only or
  placeholder surfaces, so smoke tests should focus on route viability and basic
  interactions until persistence/API contracts are added.

### 11. Public API and Developer Harness

Critical flows:

- Public health returns JSON and never requires auth.
- Discover endpoints return provider/capability metadata needed by clients.
- Dev tool-test harness is mounted only when explicitly enabled and never in
  production mode.
- Protected API endpoints reject unauthenticated hosted-mode requests with the
  standard error envelope.
- API client detects accidental HTML responses from bad `VITE_API_URL` or
  production redirect misconfiguration.

Primary API contracts involved:

- `GET /api/v1/health`
- `GET /api/v1/discover/*`
- `GET/POST /api/v1/dev/tool-tests` when enabled
- Error-envelope behavior across protected route groups

Current gap:

- API route tests exist, but no e2e smoke asserts deployed-style public versus
  protected routing, auth middleware boundaries, or HTML-response guardrails.

## Prioritized E2E Gaps

P0 gaps:

- The first `apps/web` Playwright harness exists, but CI coverage is still
  missing. Add API startup orchestration, deterministic env files, broader
  fixtures, and a required smoke command.
- Browser e2e does not yet consume the new Supabase test-sandbox lifecycle.
  Extend the existing tool-test sandbox approach for web fixtures: create a
  sandbox row, seed real rows under its `internal_test` workspace/project, and
  call `delete_test_sandbox()` during teardown.
- No split-app auth e2e exists. Cover local mode immediately and hosted Supabase
  mode behind test credentials/secrets.
- No generation happy path exists from Studio through progress and review.
  Implement a mock/prompt-only generation fixture before attempting provider
  backed tests.
- No deploy-style `/api` routing smoke exists. This is high risk because the
  API client explicitly guards against receiving SPA HTML instead of JSON.

P1 gaps:

- Run progress actions are uncovered: approve, reject, cancel, failed state,
  terminal success, and recovery hint.
- Library collections are uncovered: pagination, filters, media viewer,
  visibility mutation, media URL refresh, and output watch links.
- Storyboard editing has initial Playwright coverage for load, edit,
  add/remove, cross-scene beat movement, save, and reload; remaining work is
  broader reorder permutations and Supabase-backed sandbox fixtures.
- Review revision/export/watch is uncovered end to end.
- Eval dashboard and judgment action are uncovered.

P2 gaps:

- Secondary pages have no route/interactivity smoke tests.
- Accessibility and keyboard checks are not embedded in e2e flows.
- Responsive desktop/mobile browser checks do not exist for the dense library,
  studio, storyboard, progress, and media viewer surfaces.
- Error-path tests are inconsistent: many backend units assert errors, but UI
  retry/error states are not exercised in a browser.

## Suggested Initial Test Set

Start with a small required suite that runs quickly in CI:

1. `auth-and-routing.spec.ts`
   - health JSON, local auth access, protected route availability, redirects,
     not found.
2. `studio-generation-smoke.spec.ts`
   - create draft, complete prompt-only setup, start mocked run, observe progress,
     finish to review.
3. `run-progress-actions.spec.ts`
   - seeded running/gated/failed runs, approve/reject/cancel and recovery hint.
4. `library-collections.spec.ts`
   - seeded projects/runs/assets/outputs, filters, pagination, media viewer,
     visibility toggle, watch link.
5. `storyboard-editor.spec.ts`
   - load, edit scenes/beats, save, reload persisted storyboard.
6. `export-watch.spec.ts`
   - seeded review timeline, request revision, start mocked export, poll
     completion, verify output appears and watch page renders video.
7. `evals.spec.ts`
   - suite dashboard, run grid, diff panel, admin workbench judgment.
8. `secondary-surfaces.spec.ts`
   - settings theme/sign-out availability, uploads local staging, templates,
     brand kit, admin landing.

## Fixture Requirements

- Stable local user/workspace identity for `AUTH_MODE=local`.
- Supabase-backed fixture helpers should use service-role access only for setup
  and teardown, create `test_sandboxes` rows, label workspaces as
  `internal_test`, and delete via `delete_test_sandbox()` so fixture data cannot
  leak into user/public queries.
- API helpers to seed within the current local DB or sandbox:
  - project with and without storyboard
  - storyboard with multiple scenes/beats
  - queued/running/gated/succeeded/failed/canceled generation runs
  - assets with image/video/audio kinds, generated/uploaded sources, public and
    private visibility, missing media URL, and valid media URL
  - timeline with clips and an exportable artifact
  - output artifact with playable tiny MP4 fixture or stable test media URL
  - eval suite, run, judgments, and verdict flips
- Mock provider mode that can complete generation/export without external model,
  storage, or render-provider dependencies.
- Optional hosted-auth credentials for a non-admin user and an admin user, kept
  outside the default required smoke suite.

## Acceptance Criteria for Closing the Gaps

- `pnpm --filter @popcorn/web test:e2e` or equivalent starts the web/API stack,
  seeds deterministic data, runs Playwright, and exits cleanly.
- CI runs the P0 smoke suite on every PR.
- Every active SPA route has at least one route-level smoke assertion.
- Every user-owned persistence surface has at least one write-then-reload e2e:
  studio draft, project/storyboard, asset visibility, generation action,
  timeline revision/export, and eval judgment.
- At least one test proves the API returns JSON through the same base URL shape
  the browser uses.
- Provider-backed long-running e2e remains optional and separate from required
  CI, but the mock path exercises the same UI and API contracts.
