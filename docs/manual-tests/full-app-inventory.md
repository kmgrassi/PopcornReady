# Full App Manual Testing Guide

This guide is the current manual QA pass for the active split app: Vite SPA in
`apps/web`, Express API in `apps/api`, and Supabase-backed data/auth. It is
meant to be runnable by a person in a browser, with focused API checks where a
browser cannot prove the behavior alone.

Use the focused smoke docs when a flow needs deeper operational coverage:

- [Asset sharing](asset-sharing.md)
- [Orchestrator tool-call smoke tests](orchestrator-tool-calls.md)

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
- `/library`, `/library/projects`, `/library/runs`, `/library/assets`,
  `/library/outputs`, `/library/evals`.
- Compatibility redirects: `/projects`, `/runs`, `/assets`, `/outputs`.
- `/projects/:projectId`, `/projects/:projectId/storyboard`,
  `/projects/:projectId/watch`, `/projects/:projectId/runs/:runId`.
- `/anchors`, `/anchors/mine`, `/anchors/:entryId`.
- `/uploads`, `/templates`, `/brand`, `/settings`.
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

- In the authenticated shell, verify sidebar/header navigation to Dashboard,
  Library, Settings, Uploads, Templates, Brand Kit, Anchors, and Evals where
  links are present.
- Open the command palette with the visible trigger and Cmd/Ctrl+K.
- Search for common destinations such as Dashboard, Library, Settings, Uploads,
  Templates, Brand Kit, and Evals.
- Verify Escape closes the palette, arrow keys move selection, and Enter
  activates the selected command.
- Open `/settings`.
- Verify account label, workspace id/name, auth mode, and any load errors.
- Toggle each available theme and refresh after each; the selected theme should
  persist and keep focus rings/status chips legible.
- Use secondary Settings links and confirm they land on the intended route.

### 4. Dashboard

- Open `/dashboard` in a fresh workspace.
- Verify the empty or low-data state has clear next actions.
- If the workspace has active runs or outputs, verify counts and cards match
  the corresponding Library tabs.
- Click active run rows and recent output links when present; they should open
  the correct run or collection route.
- Refresh `/dashboard`; shell, account label, and content should recover.
- Simulate or force an API failure if practical and verify retry/error state.

### 5. Library Collections

- Open `/library`; it should redirect to `/library/projects`.
- Open compatibility routes `/projects`, `/runs`, `/assets`, `/outputs`, and
  `/evals`; query params should be preserved where the redirect supports them.
- Open `/library/unknown`; it should redirect to projects.
- Switch between Projects, Runs, Assets, Outputs, and Evals tabs and verify the
  URL updates without losing shell state.

Projects:

- In empty and populated workspaces, verify project cards show name, poster or
  fallback, status, storyboard readiness, timestamps, and actions.
- Open a project detail route from a card.
- Open Storyboard from a card when available.
- Use Runs to open `/library/runs?projectId=:projectId`.
- Load more when more than one page exists.

Runs:

- Filter by all, queued, running, succeeded, failed, and canceled.
- Open a run row and verify `/projects/:projectId/runs/:runId` loads.
- Verify progress bars clamp to 0-100 and status chips match state.
- Confirm empty, loading, pagination, and API error states.

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

- Verify output cards show project name, export date, format, duration, and
  source metadata when available.
- Open an output in the media viewer.
- Use Project and Watch actions.
- Verify missing playback URLs fall back to thumbnails or placeholders.

### 6. Landing Quick-Start Generation

This is the current creation entry point while `/studio` is retired.

- Configure provider keys if you expect generation to run end to end. Without
  provider keys, verify the app surfaces a readable configuration error.
- From `/`, enter a valid prompt and choose each supported length.
- Choose Create account:
  - Pending prompt should survive the `/signup` redirect.
  - After signup, the quick-start run should auto-start once auth resolves.
- Choose Skip this step:
  - Anonymous sign-in should create a Supabase anonymous session.
  - The app should start the run as a guest if the guest-run limit allows it.
- Try exceeding the guest run limit; the UI should route the user toward account
  creation instead of silently starting another run.
- Confirm successful run start navigates to
  `/projects/:projectId/runs/:runId`.

### 7. Run Progress And Review Actions

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

### 8. Storyboard And Project Pages

- Open `/projects/:projectId` for a valid project.
- Open `/projects/:projectId/storyboard`.
- Verify loading, missing-project, no-storyboard, and API error states.
- For a project with a storyboard, edit scene and beat fields, add/remove
  scenes and beats, move beats where supported, save, and refresh.
- Verify dirty, saving, saved, and save-error states.
- Open `/storyboard`; it should redirect to `/library/projects`.
- Open `/projects/:projectId/watch`:
  - Project with playable output should show video controls and metadata.
  - Project without playable output but with storyboard fallback should route or
    message according to the current implementation.

### 9. Uploads, Templates, Brand Kit, Anchors

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
- Use Blank project and Use template actions; current behavior should route to
  `/library/projects` through the `/projects/new` compatibility redirect unless
  a newer creation flow consumes template params.

Brand Kit:

- Open `/brand`.
- Change brand name, color, font, tone, and end-frame guidance.
- Verify preview and prompt summary update immediately.
- Refresh and confirm values reset unless persistence has been added.

Anchors:

- Open `/anchors`, `/anchors/mine`, and an anchor detail route when seeded data
  exists.
- Verify likes, filters, detail navigation, and empty states.

### 10. Admin And Evals

- Open `/library/evals` or `/evals` and verify redirect behavior.
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
