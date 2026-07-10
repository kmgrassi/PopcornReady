# End-to-End Test Inventory And Gaps

Date: 2026-06-26

This inventory covers the active split app described in `CLAUDE.md`: the Vite
React SPA in `apps/web` and the Express API in `apps/api`. New end-to-end work
should target the split app. Legacy Next surfaces under `src/` should only be
tested when a legacy regression blocks migration.

## Current Coverage Snapshot

The `apps/web` Playwright harness now covers the first useful browser layer:

- `api-routing.spec.ts` verifies health and JSON error-envelope behavior through
  the web `/api` proxy.
- `auth-local.spec.ts` verifies local auth mode and `/api/v1/me`.
- `auth-hosted.spec.ts` verifies hosted Supabase login/sign-out when explicit
  credentials and Supabase env are provided.
- `specs/auth-and-routing.spec.ts` covers public auth routes, protected local
  routes, compatibility redirects, and not-found behavior.
- `run-progress.spec.ts` and `run-progress-actions.spec.ts` cover run progress,
  approval/rejection/cancel actions, failed/succeeded states, and recovery hints
  with mocked browser API fixtures.
- `specs/library-collections.spec.ts` covers Library pagination, filters, media
  viewer, visibility mutation behavior, and watch links with mocked fixtures.
- `storyboard-editor.spec.ts` verifies the dedicated storyboard route renders
  the empty state for a project whose storyboard endpoint returns `null`.
- `evals.spec.ts` covers the eval dashboard and admin workbench judgment action.

The required local-first database smoke is:

```sh
pnpm db:local:start
pnpm db:local:reset
pnpm test:e2e:local-db
```

That command runs Playwright against local Supabase/Postgres with
`DB_BACKEND=supabase`.

## Development Data Modes

- `AUTH_MODE=local` resolves every request to the deterministic local developer
  workspace. This is the default fast test mode.
- `AUTH_MODE=hybrid` verifies a Supabase bearer token when present and falls
  back to the local developer identity when absent. This is the best manual mode
  for local onboarding tests because a real local Supabase signup resolves as a
  real user.
- `AUTH_MODE=supabase` requires a valid Supabase bearer token and should be used
  for hosted/auth-strict checks.
- `DB_BACKEND=local` uses file-backed `.local` state. `DB_BACKEND=supabase`
  routes the foundation store through Postgres.
- Supabase-backed fixture helpers should prefer `test_sandboxes` /
  `internal_test` workspaces and clean up with `delete_test_sandbox()` where
  practical.

## Current Route Inventory

Public routes:

- `/`
- `/login`
- `/signup`
- `/sprite`
- `/p/:projectId`

Authenticated routes:

- `/dashboard`
- `/inspiration`
- `/library`, `/library/:tab` (`projects` and `assets` are the active tabs)
- `/projects`, `/projects/new`, `/projects/:projectId`,
  `/projects/:projectId/concept`, `/projects/:projectId/brief`,
  `/projects/:projectId/script`,
  `/projects/:projectId/storyboard`, `/projects/:projectId/watch`,
  `/projects/:projectId/runs/:runId`
- `/runs`, `/assets`, `/outputs`
- `/anchors`, `/anchors/mine`, `/anchors/:entryId`
- `/uploads`, `/templates`, `/brand`, `/account`, `/settings`, `/faq`
- `/evals`, `/admin`, `/admin/evals`
- `/dev/design-system`, `/dev/generation-cards`

Retired route note: `/studio` is not mounted in the current Vite route table.
Creation currently enters through the landing prompt, the dashboard/global
`Create new video` action, or `/projects/new`. Any future Studio restoration
should add new E2E coverage when the route returns.

Dashboard creation note: the current authenticated flow is for a signed-in local
user to open `/dashboard`, click `Create new video`, complete the brief and
footage setup, then auto-start production as the flow reaches the plan step. The
route is `/projects/new`; `/studio` remains retired.

## Recommended Harness Shape

- Keep `apps/web` as the owner of browser E2E.
- Keep the default suite fast: local auth, mocked/seeded browser API fixtures,
  and local Supabase only where persistence/auth behavior matters.
- Use the local-first DB command for integration smoke that should exercise real
  Supabase/Postgres setup.
- Keep provider-backed generation/export tests separate from required CI, behind
  explicit provider keys. When those tests spend real calls, draw prompts from
  the production fixture corpus in
  [`seed/production-fixtures/manifest.json`](../../seed/production-fixtures/manifest.json)
  and follow its harness contract in
  [`seed/production-fixtures/README.md`](../../seed/production-fixtures/README.md).
- Seed complex UI states through fixtures or test sandboxes; do not require live
  paid model calls just to test routing, controls, polling, or error states.

## E2E Inventory

### 1. App Shell, Routing, And Auth

Covered:

- Public auth routes render.
- Local protected routes are reachable.
- Health JSON works through `/api`.
- Compatibility redirects and not-found route work.
- Local `/me` resolves the deterministic workspace.
- Hosted Supabase login/sign-out is covered when secrets are supplied.

Remaining gaps:

- No required CI-hosted strict-auth run yet.
- Local Supabase E2E signs up a new user, verifies `/api/v1/me` resolves
  `authMode: "supabase"`, signs out, and signs back in.
- Admin/non-admin hosted authorization should be covered with explicit fixtures
  or credentials.

### 2. Landing Quick-Start Generation

Critical flows:

- Landing prompt validates minimum content.
- Account-choice modal opens on submit.
- Create-account path should preserve and resume the pending prompt through
  `/signup`, claim the quick-start prompt after auth, start a run, and navigate
  to `/projects/:projectId/runs/:runId`.
- Guest path calls anonymous sign-in and respects guest run limits.
- Successful quick-start creates a project/run and navigates to
  `/projects/:projectId/runs/:runId`.
- Missing provider keys surface a readable configuration error.

Current coverage:

- Not covered end to end. Some auth and run-progress pieces are covered
  separately.

Recommended next test:

- Add a mock-backed quick-start test: submit the landing prompt, sign up, assert
  pending prompt resume, stub the run-start API, and land on progress.

### 2a. Dashboard Project Creation

Critical flows:

- A known local Supabase user can log in and reach `/dashboard`.
- `Create new video` opens the authenticated project-creation flow.
- The draft picker can create, resume, and delete drafts.
- Brief entry persists before generation starts.
- Footage setup supports prompt-only and uploaded/source-footage paths.
- Reaching the plan step starts production and redirects to
  `/projects/:projectId/runs/:runId`.
- Review-gated runs wait for approval/rejection before continuing when seeded by
  fixture or deep link; the normal setup UI does not currently expose a
  checkpoint picker.

Current coverage:

- Not covered by automated E2E yet.

Recommended next test:

- Add a local-db-backed Playwright spec: sign in with a seeded local user, click
  `Create new video`, create a draft, submit brief and footage choices, stub or
  mock run start, and verify navigation to the run progress route.

### 3. Run Progress, Review Gates, And Recovery

Covered:

- Active, gated, failed, and succeeded progress states.
- Approve, reject, and cancel actions.
- Review notes clear on success.
- Loading state shows stored recovery hint.
- Targeted generated-asset feedback modal opens and posts the revision action.

Remaining gaps:

- Supabase-backed seeded run fixtures are not used yet.
- Live orchestrator/provider progress is intentionally not part of the required
  browser suite. Optional provider-backed smoke should generate projects/assets
  from the production fixture corpus rather than freeform prompts.

### 4. Library Collections

Covered:

- Projects/assets route viability with seeded fixtures.
- Pagination and filters.
- Media viewer behavior.
- Visibility mutation flow.
- Watch/project links.

Remaining gaps:

- Real Supabase fixture seeding and teardown.
- Project-scoped compatibility redirects are not covered yet:
  `/runs?projectId=:projectId`, `/outputs?projectId=:projectId`, and the
  resulting project detail `#runs` / `#outputs` anchors.
- More asset media edge cases: expired signed URLs, missing private objects,
  public/private discovery leakage.

### 5. Storyboard, Project Pages, And Watch

Covered:

- Storyboard route renders the dedicated storyboard page and empty state for a
  project without a storyboard.

Remaining gaps:

- Project detail route coverage is thin.
- Seeded storyboard loading, project-detail storyboard generation, panel request
  changes, image-regeneration edge cases, and reload recovery are not covered by
  the current browser spec.
- Direct scene/beat editing is not the current storyboard UX; changes should be
  exercised through object-scoped Request Changes flows.
- Watch page video playback/fallback behavior has limited coverage.

### 6. Evals And Admin

Covered:

- Eval dashboard route and admin workbench judgment action.
- Manual judgment updates visible card state.

Remaining gaps:

- Hosted admin/non-admin permission checks.
- Live bounded-generation eval runs once backing functionality is complete.

### 7. Secondary Surfaces

Critical flows:

- Settings theme/account/sign-out.
- Account credits/billing.
- Uploads local staging and media viewer.
- Templates route and template action redirects.
- Brand Kit local preview state.
- Anchors catalog, owned anchors, and anchor detail.
- Dev design-system/generation-card routes when intentionally reachable.

Current coverage:

- Some protected route viability is covered.
- Detailed interactions are mostly manual-only.

Recommended next test:

- Add `secondary-surfaces.spec.ts` for Settings theme persistence, Uploads file
  staging, Account credits states, Templates route actions, Brand Kit local
  state, and Anchors empty/data states.

### 8. Storage And Asset Sharing

Current coverage:

- API/storage unit tests and `apps/api/scripts/storage-smoke.ts` cover pieces.
- Manual flow is documented in `docs/manual-tests/asset-sharing.md`.

Remaining gaps:

- Browser-level public/private asset URL lifecycle is not required in E2E.
- MinIO-backed smoke is not part of default CI.

### 9. Export And Watch

Critical flows:

- Timeline export request starts.
- Export polling reaches terminal success/failure.
- Output appears in dashboard recent outputs and project watch/detail surfaces.
- Watch page plays the exported video or falls back to storyboard/error state.

Current coverage:

- Watch links are covered at Library level.
- End-to-end export is not covered.

Remaining gaps:

- Need a mock export fixture and tiny playable video fixture.
- Provider/render-backed export should remain optional.

## Prioritized Gaps

P0:

- Add a local Supabase signup/onboarding E2E that creates a fresh user and
  verifies `/api/v1/me` returns `authMode: "supabase"` and `isLocal: false`.
- Add automated coverage for the dashboard `Create new video` flow with
  draft creation, brief, footage setup, and run-start redirect.
- Add landing quick-start create-account flow with mocked run creation.
- Keep `pnpm test:e2e:local-db` healthy and run it before changes touching auth,
  Supabase env, route protection, or store setup.

P1:

- Add secondary-surfaces smoke coverage.
- Add project detail/watch page coverage.
- Move more mocked Library/project/run fixtures toward Supabase test-sandbox
  fixtures.
- Add hosted admin/non-admin permission coverage behind secrets.

P2:

- Add responsive desktop/mobile variants for dense Library, Storyboard, Run
  Progress, and media viewer surfaces.
- Add accessibility checks for focus order, keyboard controls, and reduced
  motion where relevant.
- Add optional provider-backed generation/export smoke jobs that consume the
  production fixture corpus and create one fixture/internal-test project per
  manifest asset.

## Acceptance Criteria For Closing This Inventory

- Every active SPA route has at least one route-level browser assertion.
- Local-first DB smoke proves migrations, seed data, API env, Vite env, and
  browser auth can work together.
- At least one browser test creates a real Supabase user locally and verifies
  the API resolves the domain user identity.
- Landing quick-start has one mocked run-creation E2E path.
- Every persisted user-owned surface has a write-then-reload browser test:
  account/session, studio draft, project/storyboard generation or revision,
  asset visibility, run action, eval judgment, and eventually export.
- Provider-backed tests are optional, separate from the required smoke suite, and
  should use the production fixture corpus when real API calls are enabled.
