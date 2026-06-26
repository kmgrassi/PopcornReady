# Full App Manual Testing Guide

This guide is the current manual QA pass for the active split app: Vite SPA in
`apps/web`, Express API in `apps/api`, and Supabase-backed data/auth. It is
meant to be runnable by a person in a browser, with focused API checks where a
browser cannot prove the behavior alone.

Use the focused smoke docs when a flow needs deeper operational coverage:

- [Asset sharing](asset-sharing.md)
- [Orchestrator tool-call smoke tests](orchestrator-tool-calls.md)

## Production Fixture Corpus

When a manual pass is allowed to spend real provider/API calls, use the
production fixture corpus instead of ad hoc prompts:

- [`seed/production-fixtures/README.md`](../../seed/production-fixtures/README.md)
- [`seed/production-fixtures/manifest.json`](../../seed/production-fixtures/manifest.json)

The manifest is the source of truth for production-style assets we want to
generate anyway: 80 assets total, currently 45 images, 30 videos, and 5 audio
tracks across movie posters, character references, product stills, short clips,
trailer teasers, demos, explainers, promos, loops, and background music.

Use these assets for provider-backed manual tests that need real media:

- Run them in a fixture or internal-test workspace, not a customer workspace.
- Use one real project per manifest asset; include the manifest asset `id` in
  the project name so generated assets can be traced back to the corpus.
- Call the same app/API flow a user would use for that asset kind. Do not write
  directly to tables just to seed a manual test.
- Assert mechanics only: the job/action succeeds or fails clearly, the asset row
  has the requested kind/media/role, storage and delivery metadata exist for
  media, and failures produce structured errors.
- Keep successful fixture assets when they are useful examples; clean up only
  throwaway `internal_test` runs.

## Recommended Local Setup

For most manual browser testing, use a local-first Supabase database:

```sh
pnpm db:local:start
pnpm db:local:reset
```

Then run the app in hybrid auth mode so signed-out routes still work, but a real
Supabase signup resolves as a real user:

```sh
eval "$(supabase status -o env)"

AUTH_MODE=hybrid \
DB_BACKEND=supabase \
STORAGE_BACKEND=local \
SUPABASE_URL="$API_URL" \
SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
VITE_SUPABASE_URL="$API_URL" \
VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
VITE_SUPABASE_ENV=default \
PORT=4320 \
WEB_ORIGIN=http://127.0.0.1:3320 \
pnpm --filter @popcorn/api start
```

In another terminal:

```sh
eval "$(supabase status -o env)"

AUTH_MODE=hybrid \
DB_BACKEND=supabase \
STORAGE_BACKEND=local \
SUPABASE_URL="$API_URL" \
SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
VITE_SUPABASE_URL="$API_URL" \
VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
VITE_SUPABASE_ENV=default \
VITE_API_URL=http://127.0.0.1:4320 \
pnpm --filter @popcorn/web exec vite --host 127.0.0.1 --port 3320 --strictPort
```

Open `http://127.0.0.1:3320`.

Quick automated smoke for the same local DB stack:

```sh
pnpm test:e2e:local-db
```

## Route Map

Public routes:

- `/` landing page with prompt-to-video intake.
- `/login`, `/signup`.
- `/sprite`.
- `/p/:projectId` public read-only project share view.

Authenticated routes:

- `/dashboard`.
- `/inspiration`.
- `/library`, `/library/projects`, `/library/assets`.
- Compatibility redirects: `/projects`, `/runs`, `/assets`, `/outputs`;
  project-scoped runs/outputs redirect to project detail anchors.
- `/projects/:projectId`, `/projects/:projectId/storyboard`,
  `/projects/:projectId/watch`, `/projects/:projectId/runs/:runId`.
- `/projects/:projectId/concept`, `/projects/:projectId/brief`,
  `/projects/:projectId/script`.
- `/anchors`, `/anchors/mine`, `/anchors/:entryId`.
- `/uploads`, `/templates`, `/brand`, `/account`, `/settings`, `/faq`.
- `/evals`, which redirects to `/admin/evals`.
- `/admin`, `/admin/evals` for admin-capable sessions.
- Dev-only visual routes: `/dev/design-system`, `/dev/generation-cards`.

Retired route note: `/studio` is not currently mounted in the Vite route table.
Older manual-test instructions that start with `/studio` should be treated as
historical unless a future PR restores that route.

## Core Browser Pass

Run this pass in desktop width around `1440px` and again in a narrow mobile
viewport around `390px` when layout is part of the change. For every route,
watch for console errors, broken media, unreachable controls, and page refresh
recovery.

### 1. Landing And Public Navigation

- Open `/`.
- Verify brand, landing prompt, duration selector, pricing/how sections, footer,
  and auth CTAs render without console errors.
- Submit an empty or too-short prompt; the start action should stay disabled or
  show the intended validation state.
- Enter a valid prompt and submit.
- In the account-choice modal, verify both actions are present:
  - Create account routes to `/signup` and preserves the pending prompt.
  - Skip this step signs in anonymously and starts the guest path when anonymous
    sign-ins are enabled.
- If provider keys are not configured, the run-start path should fail with a
  readable configuration error rather than a blank page.
- Open `/login` and `/signup` from public navigation.
- Visit an unknown route and verify the not-found placeholder appears.

### 2. Signup, Login, And Session State

- Open `/signup`.
- Confirm the submit button is disabled until email and password are present.
- Try invalid credentials and confirm a readable error appears without
  navigation.
- Create a unique local test account, for example
  `manual-<timestamp>@example.test`.
- Verify the app redirects to `/dashboard`.
- Verify the dashboard or settings surface shows the signed-in email.
- Call `GET /api/v1/me` with the browser's Supabase access token, or use the
  network panel, and confirm:
  - `authMode` is `supabase`.
  - `isLocal` is `false`.
  - actor type is `user`.
  - actor email matches the new account.
- Sign out from Settings or the top navigation.
- Confirm direct entry to `/dashboard` while signed out redirects to `/login`
  in production-like hosted mode. In local hybrid mode without a token, the API
  may still resolve the local dev fallback; note the mode used in the test
  report.
- Sign back in with the same account and verify `/dashboard` loads.

### 3. Authenticated Shell And Settings

- In the authenticated shell, verify the sidebar primary navigation includes
  Library and Inspiration, the global `Create new video` action, and account
  footer links for Credits & billing, Settings, and FAQs.
- For admin-capable sessions, verify the Admin footer exposes Workbench and
  Admin evals.
- Open the command palette with the visible trigger and Cmd/Ctrl+K.
- Search for common destinations such as Library, Inspiration, Settings,
  Account, Admin evals, Uploads, Templates, Brand Kit, and Anchors when those
  commands are available to the current session.
- Verify Escape closes the palette, arrow keys move selection, and Enter
  activates the selected command.
- Open `/settings`.
- Verify account label, workspace id/name, auth mode, and any load errors.
- Toggle each available theme and refresh after each; the selected theme should
  persist and keep focus rings/status chips legible.
- Verify workspace model settings, provider API keys, and the access token panel
  load or show readable errors.
- For admin-capable sessions, use the secondary Settings links and confirm they
  land on Uploads, Templates, Anchors, Brand kit, and Admin evals.
- Open `/account` and verify credits balance, credit packs, and transaction
  history load or show readable local/hosted-mode states.

### 4. Dashboard

- Open `/dashboard` in a fresh workspace.
- Verify the empty or low-data state has clear next actions.
- Verify whether the authenticated shell exposes the intended creation CTA:
  - Target behavior: a primary `Create new video` action should start the
    stepwise project-creation flow.
  - Library remains available as a separate sidebar menu item.
- If the workspace has active runs or recent outputs, verify counts and cards
  match the project/run/output links they open.
- Click active run rows and recent output links when present; they should open
  the correct run progress route, project detail route, or watch route.
- Refresh `/dashboard`; shell, account label, and content should recover.
- Simulate or force an API failure if practical and verify retry/error state.

### 5. Project Creation And Review Checkpoints

Use this pass for the dashboard-driven creation flow.

Local user setup:

- Start from a reset local Supabase database using the commands in
  [Recommended Local Setup](#recommended-local-setup).
- Either create a fresh local account through `/signup`, or sign in as a known
  local test user that was created during setup.
- Confirm `/dashboard` shows the signed-in email or the expected local account
  label before starting the creation flow.

Creation entry:

- From `/dashboard`, click `Create new video`.
- Verify the user lands on the project-creation flow without leaving the
  authenticated shell.
- If saved drafts exist, verify the start screen shows `Continue a draft`, lets
  the tester resume a draft, and lets the tester delete one without deleting a
  project.
- Click `Create your first video` or the global `Create new video` action.
- Refresh the first creation screen; the shell and any draft state should recover
  without creating a duplicate project.

Brief step:

- Enter a complete brief with goal and length. Open Advanced Direction and fill
  audience, platform, format, hook, visual, idea, payoff, accuracy, style, and
  call to action when the change touches creative inputs.
- Confirm the Continue button is disabled until the goal is present.
- Select a prompt chip and verify it replaces the goal and target length.
- Select a length over 30 seconds and confirm the cost warning appears.
- Leave and return to `/projects/new`; the saved draft should be resumable.
- Edit the brief, wait for autosave, refresh, and verify the latest content is
  shown.

Footage step:

- Choose `No` and confirm the flow can continue with prompt-only visuals.
- Go back, choose `Yes`, and verify the flow requires at least one video or
  image before continuing.
- Select image, video, and audio files. Verify file names, size, and duration
  metadata where available. Audio-only uploads should not satisfy the visual
  footage requirement.

Production start and review checkpoints:

- Continue from footage. The current flow starts production when it reaches the
  plan step; there is no separate plan-edit screen in the normal setup path.
- If provider keys or credits are missing, verify the start-production error is
  readable and offers Retry, Edit idea, and Edit assets.
- To test review checkpoints manually, deep-link with `reviewGates`, for
  example `/projects/new?goal=...&length=30&reviewGates=creative_plan`, or use
  a fixture run with a review gate.
- Expected checkpoint behavior: the run waits in the generating view with
  `Approve & continue` and `Reject / regenerate`; approving resumes polling and
  rejecting keeps the run from continuing silently.

Production step:

- Continue with no stop points selected and verify the run advances through the
  remaining stages autonomously.
- While the run is active, verify `/projects/:projectId/runs/:runId` shows the
  same stage/progress state from dashboard and project links.
- Use the visible stop/cancel affordance where available and confirm the run
  reaches the expected paused or terminal state.
- When a run succeeds and returns to the Studio review state, verify the rough
  cut loads, feedback can target the whole cut or a beat/segment, and Continue
  to export is disabled until a timeline exists.

Route notes:

- `/studio` is retired and not mounted.
- `/projects/new` owns the authenticated stepwise creation surface.
- The landing quick-start path described below remains a separate public entry
  point from `/`.

### 6. Library Collections

- Open `/library`; it should redirect to `/library/projects`.
- Open compatibility routes:
  - `/projects` redirects to `/library/projects`.
  - `/assets` redirects to `/library/assets`.
  - `/runs` and `/outputs` without `projectId` redirect to `/library/projects`.
  - `/runs?projectId=:projectId` redirects to `/projects/:projectId#runs`.
  - `/outputs?projectId=:projectId` redirects to `/projects/:projectId#outputs`.
  - `/evals` redirects to `/admin/evals`.
- Open `/library/unknown`; it should redirect to projects.
- Switch between Projects and Assets tabs and verify the URL updates without
  losing shell state.

Projects:

- In empty and populated workspaces, verify project cards show name, poster or
  fallback, status, storyboard readiness, timestamps, and actions.
- Open a project detail route from a card.
- Open Storyboard from a card when available.
- Use project actions to open the latest run, storyboard, outputs/watch, and
  project detail when data exists.
- Load more when more than one page exists.

Runs:

- Runs are not a Library tab anymore. Verify recent project runs through the
  project detail `Run pipeline` panel and direct
  `/projects/:projectId/runs/:runId` routes.
- Verify progress bars clamp to 0-100 and status chips match state on project
  detail and run progress.
- Confirm empty, loading, and API error states for project-scoped runs.

Assets:

- Filter by kind and source.
- Open image, video, and audio assets in the media viewer when data exists.
- Verify previous/next, Escape close, backdrop close, metadata, and fallback
  states.
- Toggle public/private visibility and verify optimistic UI either succeeds or
  rolls back cleanly.
- Run [Asset sharing](asset-sharing.md) for the storage-backed public/private
  URL lifecycle.

Outputs:

- Outputs are not a Library tab anymore. Verify recent outputs through the
  dashboard strip, project detail `Outputs`/`Watch` actions, and
  `/projects/:projectId/watch`.
- For a playable output, verify filename, duration, poster, and video controls.
- Verify missing playback URLs fall back to thumbnails or placeholders.

### 7. Landing Quick-Start Generation

This is the current creation entry point while `/studio` is retired.

- Configure provider keys if you expect generation to run end to end. Without
  provider keys, verify the app surfaces a readable configuration error.
- From `/`, enter a valid prompt and choose each supported length.
- Choose Create account:
  - Pending prompt should survive the `/signup` redirect in router state/session
    storage.
  - After signup, the app should claim the pending quick-start prompt, start a
    run, and navigate to `/projects/:projectId/runs/:runId`.
- Choose Skip this step:
  - Anonymous sign-in should create a Supabase anonymous session.
  - The app should start the run as a guest if the guest-run limit allows it.
- Try exceeding the guest run limit; the UI should route the user toward account
  creation instead of silently starting another run.
- Confirm successful run start navigates to
  `/projects/:projectId/runs/:runId`.

### 8. Run Progress And Review Actions

- Open a valid run progress route.
- Verify queued, running, succeeded, failed, canceled, and unknown states render
  correctly. Seed data or use Playwright fixtures when live generation is not
  practical.
- Refresh during a non-terminal state; polling should resume.
- Cancel a non-gated in-flight run and verify terminal canceled UI.
- For review-gated runs, approve and reject with notes; notes should clear on
  success and polling should resume.
- Open malformed, missing, or unauthorized run URLs and verify useful error
  states plus navigation back to a stable surface.

### 9. Storyboard And Project Pages

- Open `/projects/:projectId` for a valid project.
- Verify the concept, brief, and script cards link to
  `/projects/:projectId/concept`, `/brief`, and `/script`.
- In the storyboard preview, generate a storyboard when none exists. Verify the
  button enters a generating/progress state, reload recovery works, and failures
  are readable.
- Open `/projects/:projectId/storyboard`.
- Verify loading, missing-project, no-storyboard, and API error states.
- For a project with a storyboard, verify scenes, beats, selected panels,
  thumbnails, metadata, and missing-panel placeholders.
- Click a panel with an image and verify the Request Changes modal opens.
- Submit panel feedback and verify the panel shows an agent-revising state,
  polls the revision run, then refreshes the storyboard when the run settles.
- Verify failed or URL-less image assets expose the image-regeneration affordance
  only when an existing image asset id is present.
- Record missing initial storyboard images as an initial-generation gap, not an
  image-regeneration failure.
- Open `/storyboard`; it should redirect to `/library/projects`.
- Open `/projects/:projectId/watch`:
  - Project with playable output should show video controls and metadata.
  - Project without playable output redirects to `/projects/:projectId#runs`.

### 10. Uploads, Templates, Brand Kit, Anchors

Uploads:

- Open `/uploads`.
- Choose multiple image, video, and audio files.
- Verify staged count, total size, kind, name, type, and size.
- Open staged files in the media viewer.
- Remove one file and then all files.
- Refresh and verify browser-local staged files are gone.

Templates:

- Open `/templates`.
- Verify category pills and template cards render.
- Use Blank project and Use template actions. Both should route to
  `/projects/new`; template actions include `?template=...`.
- Verify whether the project creation flow consumes the `template` query
  parameter. Today the route accepts it but the Studio shell does not prefill
  from it, so record that as a product gap if it remains true.

Brand Kit:

- Open `/brand`.
- Change brand name, color, font, tone, and end-frame guidance.
- Verify preview and prompt summary update immediately.
- Refresh and confirm values reset unless persistence has been added.

Anchors:

- Open `/anchors`, `/anchors/mine`, and an anchor detail route when seeded data
  exists.
- Verify likes, filters, detail navigation, and empty states.

### 11. Admin And Evals

- Open `/evals` and verify it redirects to `/admin/evals`.
- Open `/library/evals` and verify it redirects to `/admin/evals`.
- As a non-admin user, open `/admin/evals`; access should be denied or routed
  according to the admin guard.
- As an admin-capable user, verify `/admin` and `/admin/evals` are reachable.
- In `/admin/evals`, run manual judgment actions where enabled and verify
  pending, success, verdict, rationale, and error states.

## API And Operational Checks

- `GET /api/v1/health` returns healthy JSON through both API origin and web
  `/api` proxy.
- `GET /api/v1/me` returns the expected local fallback or Supabase user based
  on `AUTH_MODE` and whether a bearer token is present.
- Public discovery endpoints expose only public projects/assets/outputs.
- Private projects and media do not appear in public discovery.
- Project, run, asset, output, storyboard, and eval list endpoints honor
  pagination, filters, workspace scoping, and auth.
- Hosted or strict Supabase mode rejects unauthorized and cross-workspace
  access.
- Run [Orchestrator tool-call smoke tests](orchestrator-tool-calls.md) before
  releases that touch orchestrator tools or LLM adapters.

## Cross-Cutting Checks

- Refresh every top-level route, filtered collection URL, progress page, and
  media viewer.
- Use browser back/forward through landing, auth, Library filters, project
  detail, storyboard, and progress pages.
- Avoid unhandled console errors during normal flows.
- Prevent double-click or Enter-repeat submissions from creating duplicate
  projects, runs, exports, or account actions.
- Loading skeletons should not cause excessive layout shift.
- Empty and error states should include a useful next action.
- Mobile layout should avoid horizontal scrolling and keep primary controls
  reachable.
- Media players should not autoplay with sound.
- Private media URLs should not leak into public routes or unauthenticated API
  responses.
- Theme changes should not obscure focus rings, status chips, controls, or
  disabled states.
- Long project names, filenames, emails, and error messages should wrap cleanly.
