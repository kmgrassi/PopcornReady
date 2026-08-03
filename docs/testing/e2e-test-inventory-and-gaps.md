# End-to-End Test Inventory And Gaps

<!-- agent-summary: Inventory of active browser and end-to-end coverage for the split web and API applications. -->
<!-- agent-summary: Production-safe checks must avoid provider spend, persistent creation, and mutation controls unless explicitly approved. -->
<!-- agent-summary: Hosted verification records the deployed commit and separates browser evidence from automated-only guarantees. -->
<!-- agent-summary: The production tool-test harness must remain unavailable even though local opt-in batteries exist. -->
<!-- agent-summary: Specialist role registries and recovery projections remain dormant until their owning activation PRs. -->
<!-- agent-summary: Async dispatch races require local Supabase concurrency coverage when no safe live completion is available. -->
<!-- agent-summary: Keep remaining gaps concrete, behavior-focused, and tied to the smallest useful next test. -->

Last reconciled with the active route table: 2026-08-01

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
- `specs/library-collections.spec.ts` covers the shared quick route-loading
  contract on a mobile Library route, including the anti-flash threshold,
  accessible busy status, reduced motion, no horizontal overflow, visible
  content-shaped reservation, and transition into loaded content. It also covers
  the compact panel variant on Watch. Long-running studio-crew coverage remains
  in `asset-studio-progress.spec.ts` for queued/running creative production.
- `asset-studio-projects.spec.ts`, `asset-studio-review.spec.ts`, and
  `asset-studio-progress.spec.ts` cover the `/create/asset` workspace, image as
  the default goal, accessible media-type targets, the 30/70 desktop workspace,
  responsive mobile collapse, recent-project context and selection, proposal
  review without dispatch, immediate navigation to `/create/review`, visible
  image and video prompt refinement, motion-specific video progress, the exact
  effective-prompt preview, creator bypass, draft-preserving video revision,
  manual **Approve this** confirmation, the 10-second automatic-confirmation
  boundary, at-most-once dispatch, queued status, safe invalid-review recovery,
  and desktop/mobile Create and review layouts. After confirmation, progress
  assertions cover human-readable queued/running/terminal status, checked-in
  director, camera operator, actor, and actress artwork with its production-set
  backdrop from compact progress-only resources, a semantically
  truncated request brief with full disclosure, active-only indeterminate
  progress, reduced motion, mobile overflow, successful asset navigation, and
  truthful failed, canceled, blocked, and question outcomes. It also covers the
  accessible project picker,
  existing/first/new-project selection, inline creation without losing the
  prompt, automatic AI-named creation when review starts without a selection,
  duplicate-submit protection, draft preservation after automatic-create
  failure, stale-completion suppression after navigation, open-picker locking,
  list and creation failure recovery, and keyboard focus/Escape behavior.
- `run-progress.spec.ts` and `run-progress-actions.spec.ts` cover run progress,
  approval/cancel actions, durable Request Changes proposal entry points,
  failed/succeeded states, and recovery hints
  with mocked browser API fixtures, including truthful grouped-tool progress,
  between-action copy, job item/provider activity, progressive local-admin
  diagnostics, and response-driven review-gate transitions that clear feedback
  without racing page reloads. They explicitly verify that review feedback and
  generated-asset edits no longer post the retired reject or board-revision
  mutations. A creator-direct image fixture also verifies one-step asset-ready
  completion with no Brief, Script, or Storyboard rail, and the project overview
  repeats that assertion for its compact status panel.
- `rerun-proposal-lifecycle.spec.ts` covers proposal preview, explicit maximum
  cost approval, separate execution, waiting-state polling, durable reload
  recovery, visible owning-surface refresh after restored completion, truthful
  cancellation without a failure alert, terminal cleanup, focus restoration,
  and mobile overflow with provider-neutral browser API fixtures. Its restored
  lifecycle fixture uses the same review-surface-scoped persistence key as the
  UI, preventing concept, brief, and later-run proposals for the same project
  graph target from colliding.
- `specs/library-collections.spec.ts` covers Library pagination, filters, media
  viewer, exact attributed credit usage in owned asset detail, visibility
  mutation behavior, and watch links with mocked fixtures. It also proves one
  auth/workspace/asset-scoped media URL survives project-gallery to Library
  navigation and a same-tab reload without a focused URL request, plus a
  desktop/mobile failed-image path that makes exactly one focused refresh and
  renders the newly signed URL.
- `inspiration-poster.spec.ts` covers opening a generated story poster in the
  shared media viewer and dismissing it with Escape.
- `storyboard-editor.spec.ts` verifies the dedicated storyboard route renders
  the empty state for a project whose storyboard endpoint returns `null`, keeps
  a ready beat card visual while disclosing its generation prompt only in the
  exact-target Request Changes dialog, and exposes **Generate video** at a
  storyboard-review stop before production media can continue.
- `storyboard-orchestration.spec.ts` verifies desktop and mobile project
  overviews explain automatic scene-and-moment planning, start the
  storyboard-specific orchestrator entrypoint, navigate to its run, replace a
  missing-brief dead end with a **Finish brief** path, and suppress duplicate
  creation while a storyboard-bound run is active. It also proves an active
  run that fails while the project remains open becomes retryable, and that
  polling uses the one-boundary status endpoint rather than full run history.
- `evals.spec.ts` covers the eval dashboard and admin workbench judgment action.

The required local-first database smoke is:

```sh
pnpm db:local:start
pnpm db:local:reset
pnpm test:e2e:local-db
```

That command runs Playwright against local Supabase/Postgres with
`DB_BACKEND=supabase`.

The destructive root-profile retirement has an additional production-shaped
database harness:

```sh
pnpm db:test:pr7b-upgrade
```

It resets to the PR 7A migration boundary, seeds legacy and current hierarchy
controls, applies PR 7B, verifies the role-only rerun action policy and retired
profile catalog, proves the `popcorn_api` role can read only causally tied
specialist runs and primitive actions, exercises the API and replacement RPCs,
and replays the full migration chain from a clean database. The harness runs its two database
integration files sequentially so intentional error-path transactions in the
lifecycle suite cannot interfere with the independent retirement fixture.

## Historical Production UX Audit (2026-08-01)

This is point-in-time manual evidence, not automated E2E coverage or a current
production contract. A signed-in owner/admin session inspected `/dashboard`,
`/library/projects`, one existing `/projects/:projectId` overview, `/settings`,
`/create`, and `/projects/new` at desktop width. Only the existing project
overview was also checked at 390-by-844 mobile dimensions.

The pass submitted no forms or mutation controls, started no generation, and
changed no settings, uploads, approvals, or provider configuration. The final
inspected route had no captured console warnings or errors. The owner/admin
identity means role-gated provider smoke testing and secondary links were visible;
that observation is not evidence that ordinary creators see those controls.

Limits and remaining gaps:

- The pass did not capture a deployed commit, health response, or other immutable
  release identity, so it cannot be tied to a specific Netlify/Railway release.
- The console observation covered only the final inspected tab state, not every
  route's complete console and network history.
- Only one authenticated route received the mobile-width check.
- No global no-write assertion was available. Login, token refresh, signed-URL
  minting, and route activity may write even during a read-oriented pass.
- No detector overlay was injected, and the proposed release-gated production
  harness remains unimplemented.

## Historical Production Verification: Specialist Foundations (2026-07-14)

This section is point-in-time evidence, not the current production coverage
contract. The proposed separation between living coverage and immutable
per-release evidence is in
[Production Browser Testing for Agents](../scopes/production-browser-agent-testing.md).

The detailed production-safe pass after GitHub PRs 782, 783, and 784 merged ran
on their merge snapshot `08feca51cdadd302f6e5590a222b2ce9e1157d3b`. After
`main` advanced, health, landing, and authenticated dashboard smoke were
refreshed on deployed head `eb2245d670422db56faa0fdb0fe8034d28779a8a`, which
contains that specialist snapshot. The browser covered the landing, login,
signup, not-found, dashboard, Library projects, Activity, project-creation
entry, and an existing failed-run detail surface. No mutation control or
billable action was submitted; loading the existing run did perform the route's
normal project-activity recording.

Observed results:

- `/api/v1/health` returned `200`, `status: "ok"`, `authMode: "supabase"`, and
  current deployed commit `eb2245d670422db56faa0fdb0fe8034d28779a8a` through
  the production browser context.
- `/api/v1/dev/tool-tests` did not expose batteries. A signed-out read fell
  through to the production auth guard with `403 Missing credentials`; the
  dev-only harness never returned `200`.
- Public and authenticated read surfaces rendered without console warnings or
  unexpected 4xx/5xx responses. Login and signup submissions stayed disabled
  while their required fields were empty, and the unknown route rendered the
  Vite not-found placeholder.
- The existing failed run retained its status, 50% progress, readable failure,
  completed storyboard assets and familiar stage labels. The historical
  restart controls described by that deployment are now deleted; current
  coverage asserts Request Changes proposal behavior instead. A
  390-by-844 mobile emulation showed no document-level horizontal overflow on
  the dashboard or run-detail route.
- Contract type checks, the catalog/registry/recovery/projection suite (27/27),
  async-resume unit suite (34/34 with the database integration case skipped in
  the default environment), and the separately enabled local-Supabase dispatch
  integration test (1/1) passed.
- The hosted `Apply Supabase migrations` workflow succeeded for PR 783's merge
  commit `30601df2`, including the lease-safe dispatch-wake migration.
- Current-head Railway verification and Web E2E workflows succeeded for
  `eb2245d6` after the branch advanced.

Limits and remaining gaps:

- PR 782 intentionally has no runtime or UI path. Its origin, recipient,
  identifier, task, report, and state guarantees are compile-time contracts.
- Historical PR 784 evidence: that PR kept the flat production registry active,
  so its then-dormant role registries could not yet be claimed as production
  specialist-agent behavior. The later hierarchy cutover activated role-owned
  registries, and PR 7A deleted the flat production registry.
- No already-running production job completed during the safe observation
  window. PR 783's exact live completion race was therefore verified by unit and
  local-Supabase concurrency tests, not by starting billable production work.
- Add a focused worker-completion test proving `edit-video-asset-job.ts` wakes
  the durable orchestrator dispatch. The other changed async worker families
  already assert their enqueue/resume handoff directly.
- The full API suite is currently red on merged `main` for three unrelated
  baseline failures: two guest-retention tests reference stale pre-renumbering
  migration filenames (`...120000...` and `...150000...`) while the checkout
  contains `...120100...` and `...150100...`, and the public-project UUID-shape
  assertion fails. These tests and source files were outside PRs 782-784; the
  affected specialist suites remain green.

PR 7B root-profile retirement coverage:

- A migration contract test verifies legacy-family classification, causal
  cancellation, unresolved-gate closure, succeeded/failed root supersession,
  active rerun work/callback assertions, exact grants and role-only policies,
  profile-free routine replacement, no-`CASCADE` drop, and PostgREST reload.
- The required local database matrix includes both a clean 95-migration replay
  and a seeded PR 7A (`20260730180000`) upgrade. It proves migrated legacy
  storyboard and credit-retry fixtures cannot reopen while valid hierarchy
  approval/retry controls still work.
- The upgrade smoke also exercises direct superseded-row rejection, the
  seven-argument anonymous quota RPC, the profile-free reservation RPC,
  creator-direct readiness, health, and the five retired route families.
- This database migration does not add a browser-visible route or control, so a
  new Playwright case is not required.

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
- `/auth/callback`
- `/login`
- `/signup`
- `/sprite`
- `/p/:projectId`

Authenticated routes:

- `/dashboard`
- `/activity`
- `/inspiration`
- `/library`, `/library/:tab` (`projects` and `assets` are the active tabs)
- `/projects`, `/projects/new`, `/projects/:projectId`,
- `/create`, `/create/asset`, `/create/review`,
  `/storyboard`,
  `/projects/:projectId/concept`, `/projects/:projectId/brief`,
  `/projects/:projectId/script`,
  `/projects/:projectId/storyboard`, `/projects/:projectId/media`,
  `/projects/:projectId/watch`,
  `/projects/:projectId/runs/:runId`,
  `/projects/:projectId/:section`
- `/runs`, `/assets`, `/outputs`
- `/anchors`, `/anchors/mine`, `/anchors/:entryId`
- `/uploads`, `/templates`, `/brand`, `/account`, `/settings`, `/faq`
- `/evals`, `/admin`, `/admin/evals`
- Dev-only: `/dev/design-system`, `/dev/generation-cards`,
  `/dev/landing-upload`, `/dev/media-gallery`, `/dev/video-edit`

Retired route note: `/studio` is not mounted in the current Vite route table.
Standalone Image, Video, and Audio creation enters through the authenticated
shell plus Dashboard, Activity, and Library **Create** actions, then the `/create`
intent launcher and `/create/asset` workspace. Full video-project creation
remains distinct through the launcher's Full video choice, explicit video
actions, the landing prompt, and `/projects/new`.

Dashboard creation note: global Create actions open the intent launcher. Create
owns active navigation through `/create`, `/create/asset`, `/create/review`, and
`/projects/new`; `/studio` remains retired.

## Recommended Harness Shape

The implementation plan for true deployed production coverage is
[Production Browser Testing for Agents](../scopes/production-browser-agent-testing.md).
Until its release identity and remote runner land, "hosted" means hosted
Supabase authentication against locally started web/API binaries, not a browser
test of the deployed Netlify/Railway pair.

- Keep `apps/web` as the owner of browser E2E.
- In GitHub Actions, cancel superseded Web E2E runs for the same pull request or
  branch, skip Markdown/agent-record-only changes, cap the job at 15 minutes,
  and retain failure reports. The path filter must be replaced by a successful
  no-op job before Web E2E becomes a required branch check.
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
- A full-production CTA or direct `/projects/new` entry opens the authenticated
  video-project flow.
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
  the full-production CTA, create a draft, submit brief and footage choices, stub or
  mock run start, and verify navigation to the run progress route.

### 2b. Standalone Asset Studio

Covered:

- The authenticated global Create action opens the `/create` intent launcher.
- Dashboard, Activity, populated/empty Library, desktop shell, and mobile shell
  use that launcher; its Full video and Project asset choices lead to
  `/projects/new` and `/create/asset` while Create retains navigation ownership.
- Legacy asset-status query links and validated `/create` draft-history entries
  redirect to `/create/asset` without losing their state.
- Desktop creation uses a roughly 30/70 project/media context-to-prompt layout;
  mobile collapses the context structurally without horizontal overflow.
- A quiet recent-project switcher requests update-ordered project data, shows
  real poster context or a truthful fallback, retries a fresh signed poster URL
  after an earlier URL fails, and stays synchronized with the project picker.
- Image is the default creator-facing goal and maps to `image_create`.
- Starting moves immediately to `/create/review`; proposal/refinement progress
  is shown there before any confirmation or enqueue.
- Image prompt improvement is on by default; the exact effective prompt is
  visible before confirmation, and disabling it sends the creator's prompt
  unchanged.
- The visible proposal offers **Approve this** and automatically confirms after
  10 seconds if untouched; manual/timed races dispatch at most once.
- Revising cancels the countdown, returns to `/create/asset`, preserves the editable
  draft, and gives the revised request fresh proposal authority.
- Browser Forward restores a validated proposal from that review history entry
  without posting it again; a failed confirmation stays manual-only on return,
  and an expired restored proposal fails safely into revision.
- Confirmation failure stops automatic retry and remains manually actionable.
- Direct `/create/review` navigation without request state fails closed and
  creates no proposal or confirmation.
- Successful confirmation replace-navigates to the queued creator-direct run.
- The progress view presents human-readable queued and running status, studio
  crew artwork from compact progress-only resources, a truncated request brief
  with full disclosure, active-only indeterminate progress, reduced-motion
  behavior, and mobile-safe layout.
- A ready run-owned asset replaces the idle artwork with an image, video, or
  audio preview. Active runs continue polling and show wrap-up progress; a
  later failed terminal report keeps the asset visible with calm saved-result
  copy, including at mobile width. Terminal previews also refresh a near-expiry
  signed URL proactively and recover once after a rendered URL fails to load.
- Completed, failed, canceled, question, and blocked fixtures preserve truthful
  terminal copy, idle artwork, exact report details, and asset navigation.
- The mobile Create tab opens the launcher and remains active across both creation flows.
- The review route remains legible and overflow-free at mobile widths.
- The project picker selects an existing project, returns focus on Escape, and
  remains width-safe at mobile sizes.
- People can create either their first project or another named project inline;
  the returned project is selected immediately and the asset prompt is retained.
- Project list and project creation failures remain actionable and retryable.
- A delayed project creation cannot override a newer project selection.
- A failed next-page request preserves loaded project rows and can retry the
  same cursor successfully.

Remaining gaps:

- Add server-backed recovery when `/create/review` has no usable browser history
  state, such as a direct link, new tab, or lost session history. The current
  client intentionally fails closed instead of persisting proposal authority in
  URL or browser storage.
- Add browser coverage when optional references, Request Changes, dependency
  attachment, and Use in project controls land.
- Keep provider-backed image/video/audio smoke opt-in because it incurs cost.

### 3. Run Progress, Review Gates, And Recovery

Covered:

- Active, gated, failed, and succeeded progress states.
- Approve, reject, and cancel actions.
- Review notes clear on success.
- Loading state shows stored recovery hint.
- Targeted generated-asset feedback modal opens and posts the revision action.
- Unknown active progress is indeterminate without `aria-valuenow` or synthetic
  `0%`/`50%`; recovery keeps an earlier failed tool visible.
- Home dashboard unknown progress retains a visible indeterminate fill instead
  of being collapsed by inline width styles.
- A production-shaped storyboard-only terminal result never renders video-ready
  completion copy.
- A successful creator-direct image renders **Asset ready** and one **Image
  asset** stage on both the run and project-overview surfaces; production stages
  such as Script are absent.
- API regression coverage now keeps prompt/upload entrypoints autonomous when
  stop controls are omitted, preserves explicit `runThrough: false`, and rejects
  incomplete storyboard-to-keyframe handoffs. A local Supabase + MinIO
  integration now persists a selected visual anchor and storyboard tiles, runs
  the real keyframe worker with both reference types, and verifies ready selected
  keyframes. A provider-free browser fixture for the full create-new-video
  request body and later-stage transition remains a focused gap.
- A grouped stage stays indeterminate when a completed sibling tool reports
  `100%` while another tool is still running.
- Between explicit jobs, the creator sees `Choosing the next step` instead of a
  stale completed-stage label; active job fixtures surface safe item counts,
  provider labels, and slow-work copy without job identifiers.
- A first long provider call with no meaningful progress timestamp never turns
  a recovery-sweeper `updatedAt` write into a false `Last activity 0:00 ago`;
  the UI waits explicitly for the first meaningful progress update.
- Server-authorized local owner mode (development/test only) progressively
  reveals operator job diagnostics inside a collapsed disclosure; hosted
  disclosure requires the current workspace membership to be owner/admin.

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
- Project detail starts storyboard production through the orchestrator, covers
  the missing-brief prerequisite, and recovers truthful in-progress state after
  returning to the project on desktop and mobile fixtures.

Remaining gaps:

- Project-detail panel request changes and image-regeneration edge cases remain
  only partially covered.
- Direct scene/beat editing is not the current storyboard UX; changes should be
  exercised through object-scoped Request Changes flows.
- Watch page video playback/fallback behavior has limited coverage.
- The direct Watch no-output state is covered and remains on the Watch URL with
  an explanation instead of redirecting away.

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
- The mocked Inspiration story poster opens in the shared media viewer and
  closes by keyboard.
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
- Add automated coverage for the dashboard full-video-project flow with
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
