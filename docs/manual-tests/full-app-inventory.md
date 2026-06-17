# Full App Manual Testing Inventory

This is the starting inventory for a full manual QA pass of Popcorn Ready. It
lists the user-visible flows a tester should cover, plus API-backed checks that
prove those flows are connected to the active Vite SPA, Express API, Supabase,
storage, and generation stack.

Use the more focused smoke docs when a flow needs deeper operational coverage:

- [Asset sharing](asset-sharing.md)
- [Orchestrator tool-call smoke tests](orchestrator-tool-calls.md)

## Test Matrix

Run the core pass in at least these modes:

- Local dev autopilot: `pnpm dev` or split `pnpm dev:web` and `pnpm dev:api`.
- Authenticated hosted mode: Supabase URL/anon key configured, real login
  required, API pointed at the intended environment.
- Desktop viewport: 1440px wide.
- Mobile viewport: 390px wide.
- Theme variants: default, warm, and night from Settings or the footer toggle.

For every route, also verify loading states, empty states, retry/error states
where practical, keyboard focus, page refresh persistence, and direct URL entry.

## Access And Navigation

### Public Landing

- Open `/`.
- Verify the brand, primary navigation, pricing/how anchors, footer, and auth
  call to action render without console errors.
- Use landing-page CTAs to reach `/signup`, `/login`, and `/studio`.
- Toggle themes from the public footer and refresh; the selected theme should
  persist.
- Visit an unknown path and verify the not-found placeholder appears.

### Authentication

- Open `/signup` with Supabase configured.
- Submit with empty fields; the submit button should stay disabled.
- Submit with an invalid email or weak/invalid credentials; a useful error
  should appear without navigating.
- Create or sign into a valid test account; the app should redirect to
  `/dashboard`.
- Switch between `/login` and `/signup`; stale errors from the previous form
  should clear.
- Sign out from the topbar or Settings; hosted mode should return to a public
  route or login route.
- In production-like hosted mode, direct entry to authenticated routes such as
  `/dashboard`, `/studio`, and `/library/projects` while signed out should
  redirect to `/login`.
- In local dev autopilot, verify authenticated routes load as the local
  developer without requiring Supabase login.
- Disable/misconfigure Supabase public config locally and verify the auth forms
  show the configuration error and keep inputs/actions disabled.

### Shell Navigation

- In the authenticated shell, verify sidebar links for Create, Library, and
  Settings navigate correctly and set the active state.
- Use the "New video" sidebar button; it should open `/studio?start=1`.
- Open the command palette with the trigger and with Cmd/Ctrl+K.
- Search and run commands for Studio, Library, Settings, Uploads, Templates,
  Brand Kit, and admin commands when available.
- Verify Escape closes the palette, arrow keys change the active command, and
  Enter runs the highlighted command.
- Refresh every top-level authenticated route and confirm the shell, account
  label, workspace label, and content recover.

## Dashboard And Library

### Home Dashboard

- Open `/dashboard` in an empty workspace.
- Verify the empty dashboard action leads to Studio and can seed a goal when
  quick-start actions are shown.
- In a workspace with data, verify summary counts, active runs, and recent
  outputs match the Library collections.
- Click active run rows; they should open the correct progress page.
- Click recent outputs; they should open the outputs collection filtered to the
  related project.
- Force or simulate a dashboard API error and verify the retry state can reload.

### Library Routing

- Open `/library`; it should redirect to `/library/projects`.
- Open legacy collection aliases `/projects`, `/runs`, `/assets`, `/outputs`,
  and `/evals`; each should preserve query params and redirect to the matching
  Library tab.
- Open an invalid library tab such as `/library/unknown`; it should redirect to
  projects.
- Verify tab switching updates the URL and does not lose unrelated shell state.

### Projects Collection

- Open `/library/projects` in empty and populated workspaces.
- Verify project cards show poster fallback or poster media, name, status,
  storyboard readiness, created/updated times, and actions.
- Click a project card or Storyboard action; it should open
  `/projects/:projectId/storyboard`.
- Click Runs; it should open `/library/runs?projectId=:projectId`.
- Load more when more than 24 projects exist; ordering should remain stable.
- Refresh on a project-filtered URL and verify the filter survives.

### Runs Collection

- Open `/library/runs`.
- Filter by all, queued, running, succeeded, failed, and canceled.
- Open a project-filtered runs URL and verify only that project's runs appear.
- Click a run row; it should open `/projects/:projectId/runs/:runId`.
- Verify progress bars clamp between 0 and 100 and status chips match the run
  state.
- Load more when more than 24 runs exist.
- Confirm empty, loading, and API error states.

### Assets Collection

- Open `/library/assets`.
- Filter by kind: all, image, video, audio.
- Filter by source: all, uploaded, generated.
- Open asset cards for images, videos, and audio; the media viewer should render
  the correct player, metadata, previous/next controls, Escape close, backdrop
  close, and arrow-key navigation.
- Open assets without a projected URL; the viewer should request/refresh media
  and then show either playable media or the no-playable-URL state.
- Toggle visibility from public to private and back; labels and action text
  should update and the asset should remain visible in the grid.
- Verify broken thumbnails degrade to placeholders instead of broken media
  icons.
- Use the Project action; it should open `/library/projects?projectId=...`.
- Load more when more than 24 assets exist.
- Run the dedicated [Asset sharing](asset-sharing.md) test for public/private
  URL behavior and storage movement.

### Outputs Collection

- Open `/library/outputs`.
- Verify exported videos show project name, export date, format, duration, and
  timeline/project source metadata.
- Open an output; the media viewer should play the video and support
  previous/next, Escape, and backdrop close.
- Use Project and Watch actions; Project should open the related collection
  view and Watch should open `/projects/:projectId/watch`.
- Verify missing playback URLs use thumbnails or an output placeholder.
- Load more when more than 24 outputs exist.

## Studio Creation Flow

### Studio Start And Drafts

- Open `/studio`; verify the empty Studio start screen appears.
- Start a new draft from `/studio?start=1`; it should create or fall back to a
  local draft and land on the brief step.
- Create a server-backed draft, refresh, return to `/studio`, and resume it.
- Delete a non-active draft and verify it disappears without changing the
  current draft.
- Delete the active draft and verify Studio returns to the empty state.
- Open `/studio?draft=:draftId` directly; it should load the saved payload and
  URL-stabilize to the draft route.
- Simulate draft API failure; Studio should allow a local in-memory draft and
  show actionable errors for failed resume/delete operations.

### Brief Step

- Verify "Continue" is disabled until the goal has non-whitespace text.
- Enter a goal, choose each supported length, and choose each aspect ratio.
- Open advanced direction from the UI and by `/studio?start=1&panel=advanced`.
- Fill audience, platform, format, hook, best visual, big idea, payoff,
  accuracy note, style, and call to action.
- Navigate forward and back; all brief fields should persist.
- Refresh a server-backed draft; saved values should restore.

### Source Footage Step

- Choose prompt-only and continue without file selection.
- Choose "Use my footage" and "Edit uploaded footage"; continuing should stay
  disabled until at least one image or video is selected.
- Select one image, one video, and one audio file. Metadata should show names,
  sizes, and durations where available; audio-only selection should not satisfy
  the visual-footage requirement.
- Select invalid or unreadable files and verify an error appears without
  corrupting prior valid selections.
- Switch back to prompt-only; selected footage should clear.
- Toggle captions on and off and verify the setting persists through later
  steps.

### Progressive Planning Flow

- Start from a new draft at `/studio?start=1`; fill the brief, choose either
  prompt-only or a valid uploaded-footage option, and continue into the generated
  planning workspace.
- Verify the setup stepper shows only Brief and Footage. It should not show the
  retired top-level Story, Checkpoints/Generate, Review, or Export steps during
  setup.
- Verify generated story direction and opening hook appear quickly, are
  editable, and preserve edits when moving around the Studio workspace.
- Verify poster/visual direction renders an explicit pending/loading state while
  background planning is still running, then a ready state when available.
- Verify full orchestrator/media generation is not started implicitly after
  Footage: no project run should be created, no navigation to
  `/projects/:projectId/runs/:runId` should occur, and network traffic should
  not call the run-start endpoint until the user chooses the explicit full
  generation action.
- Refresh the draft and reopen `/studio?draft=:draftId`; story direction,
  opening hook, poster/visual pending-or-ready state, and any edits should be
  restored.
- Open older draft URLs or records whose saved step is `story`, `generate`,
  `review`, or `export`. They should route to a valid progressive Studio state
  instead of blanking, looping, or failing draft validation.
- Re-test the existing correlation/causation explainer draft/fixture. It should
  resume with its original brief values, preserve existing planning decisions,
  and still allow explicit full generation from the new planning workspace.

### Story Direction Step

- Select every story format option.
- Enter and clear an opening hook.
- Navigate back to footage and forward again; selected format and hook should
  persist.

### Generate Step

- Verify the summary reflects goal, aspect ratio, duration, and source choice.
- Expand/collapse the goal summary.
- Use Edit to return to the brief step, change the goal, and return to Generate.
- Toggle each review checkpoint independently; descriptions should change from
  automatic continuation to pause behavior.
- Start generation with no checkpoints, with one checkpoint, and with multiple
  checkpoints.
- On start, verify the app creates a project/run and navigates to
  `/projects/:projectId/runs/:runId`, preserving `studioDraft` when applicable.
- Simulate start failure; the button should recover and the error should be
  visible without losing the draft.

## Generation Progress

### Progress Page

- Open a valid `/projects/:projectId/runs/:runId`.
- Verify queued, running, stage-item, succeeded, failed, canceled, and unknown
  states render correctly.
- Refresh during a run; polling should resume and the last run hint should
  appear only when useful.
- Cancel a non-gated in-flight run; it should become canceled and clear the
  recovery hint.
- Open a malformed progress URL; the missing-id state should appear.
- Open a missing or unauthorized run; the error state should show a useful
  message and a path back to Studio.

### Review Gates

- Start a run with a brief-intake checkpoint.
- Verify the progress page loads the project brief review card.
- Add approval feedback and approve; the run should resume and clear the note.
- Add rejection feedback and reject; the gated stage should regenerate or move
  back to a running state.
- Cancel from a gated state.
- Repeat for other gateable stages and verify the gate label maps to the
  correct stage.
- Open a gated run from Studio's in-place generating view and verify the same
  approve/reject actions work there.

### Review Handoff

- For a Studio-started run with `studioDraft`, wait for success; the progress
  page should redirect to `/studio?draft=:draftId&step=review`.
- For a run opened without a Studio draft, terminal success should remain on the
  progress terminal state and expose relevant navigation.
- Verify failed and canceled runs do not redirect to Studio review.

## Review, Storyboard, And Export

### Studio Review

- Enter the Studio review step after a successful run.
- Verify loading state until project, timeline, clips, and timeline id are
  available.
- Confirm the preview player renders the current timeline and clips.
- Edit timeline segment fields in the timeline panel; the preview/export state
  should reflect current edits.
- Add per-segment review notes.
- Submit global feedback with an empty note; the action should stay disabled.
- Submit feedback with a note and timeline id; success should show "Feedback
  sent." and errors should be visible.
- Verify "Continue to export" is disabled until a timeline exists.

### Storyboard Editor

- Open `/projects/:projectId/storyboard` for a project with and without an
  existing storyboard.
- Verify loading, missing-project, and error states.
- Create, edit, move, delete, and save storyboard scenes and beats.
- Verify dirty, saving, saved, and save-error states.
- Refresh after edits; saved storyboard data should reload.
- Use the Back to Studio or library navigation paths and verify they land on the
  intended route.

### Project Watch

- Open `/projects/:projectId/watch` for a project with an export.
- Verify the video loads with controls, poster, filename, duration, and project
  name.
- Use the Storyboard action to open the project storyboard.
- Open a project with no playable export but a storyboard fallback; it should
  redirect to the storyboard.
- Verify loading and error states.

### Export

- Open the Export step from Studio review and from a direct Studio route when a
  project id is available.
- Verify MP4 is selected and read-only.
- Select draft, standard, and high quality.
- Toggle burned-in captions.
- Select each duration policy.
- Verify export is disabled when there is no project, no timeline, no timeline
  id, or an empty timeline.
- Start an export and verify polling shows an exporting state until terminal.
- On success, verify the draft completes, the output appears in `/outputs`, and
  the Open MP4 link works when a direct URL is projected.
- Force an export failure and verify the failure message is shown and retry is
  possible.

## Secondary Workspace Surfaces

### Uploads

This surface stages files locally today; it is not expected to persist through
refresh until the upload library is API-backed.

- Open `/uploads`.
- Choose multiple image, video, and audio files.
- Verify staged count, total size, file kind, name, type, and size.
- Open staged files in the media viewer.
- Navigate previous/next and close the viewer.
- Remove one file and then all files; object URLs should be revoked and the
  empty state should return.
- Refresh; staged files should be gone.
- Use New project; it should redirect through `/projects/new` to `/studio`.

### Templates

- Open `/templates`.
- Verify category pills and all template cards render.
- Use Blank project and Use template links; they should redirect through
  `/projects/new` to `/studio`. Note whether template query params are consumed
  or dropped by the current redirect.
- Confirm templates are currently static UI and do not persist changes.

### Brand Kit

This surface is currently local UI state.

- Open `/brand`.
- Change brand name, color, font, tone, and end-frame guidance.
- Verify the preview and prompt summary update immediately.
- Refresh; current values should reset to defaults unless persistence has been
  added.
- Use Create with kit; it should redirect through `/projects/new` to `/studio`.

### Settings

- Open `/settings`.
- Toggle all themes and refresh after each.
- Verify workspace name/id, account label, auth mode, and any account-load error
  render correctly.
- Use secondary surface links for Uploads, Templates, Brand kit, and Evals.
- Sign out when available and verify the destination route is correct.

## Admin And Evals

### Admin Access

- As a non-admin hosted user, open `/admin/evals`; it should deny access or
  redirect according to the current admin guard.
- As an admin-capable user, verify `/admin` and `/admin/evals` appear in the
  sidebar footer.
- Verify `/admin` renders the operator console style guide, generation-stage
  examples, loading-state examples, and navigation links.

### Evals Dashboard

- Open `/library/evals` or `/evals`; it should redirect to the Library evals
  route and render the eval suites page.
- Verify suites load from the API when available and fall back only when the
  current environment is expected to use fixtures.
- Select latest runs; the detail grid should update.
- Verify verdict badges, stage labels, pass rates, trend bars, and case cells.
- Verify verdict flips, calibration panels, empty states, loading states, and
  retry/error states.
- Use Open workbench as an admin; it should open `/admin/evals`.

### Admin Eval Workbench

- Open `/admin/evals` as an admin-capable user.
- Verify disabled bounded-execution controls are visibly disabled.
- Run judge on each artifact card; pending, success, verdict, rationale, and
  error states should be visible.
- Verify Promote to regression case and Re-run artifact remain disabled until
  their backing functionality is implemented.
- Use Suite dashboard to return to eval suites.

## API And Operational Manual Checks

### Health And Public Discovery

- `GET /api/v1/health` should return healthy metadata.
- Public discovery endpoints for projects, assets, and outputs should return
  only public data and should work without credentials.
- Private assets and projects should not appear in public discovery.

### Workspace APIs

- `GET /api/v1/me` should return the active actor/workspace and correct local
  or hosted auth mode.
- Workspace summary, projects, runs, assets, and outputs endpoints should honor
  pagination, filters, workspace scoping, and auth.
- Hosted mode should reject unauthorized or cross-workspace access.

### Project And Asset Lifecycle

- Create a project through the API and verify it appears in Library projects.
- Patch project metadata/visibility and verify UI and public discovery update.
- Upload/register image, video, and audio assets through the API.
- Fetch individual asset media URLs and verify signed URLs expire and refresh.
- Toggle asset visibility from the UI and API and verify both stay consistent.

### Generation APIs

- Start generation through Studio and through direct API calls.
- Verify stages, stage items, result artifacts, and progress percentages update
  coherently.
- Approve, reject, and cancel runs through both UI and API.
- Verify runs cannot be mutated after terminal states except where explicitly
  allowed.
- Run the [Orchestrator tool-call smoke tests](orchestrator-tool-calls.md)
  before releases that touch orchestrator tools or LLM adapters.

### Timeline And Export APIs

- Assemble or fetch latest project timelines.
- Fetch timeline detail and export records.
- Start an export with every supported quality and duration policy.
- Verify failed export jobs retain structured errors and successful jobs create
  output artifacts visible in Library outputs.

### Storyboard APIs

- List, create, update, and delete storyboards.
- List, create, update, and delete storyboard scenes.
- List, create, update, and delete beats.
- List, create, update, and delete panels.
- List and update approvals.
- Verify deleted nested records disappear from both API responses and the
  storyboard editor after refresh.

## Cross-Cutting Checks

- Browser refresh at every wizard step, progress state, collection filter, and
  media viewer route.
- Back/forward browser navigation through Studio, Library filters, and progress
  pages.
- No unhandled console errors during normal flows.
- No duplicate network requests that create duplicate projects, runs, exports,
  or draft records.
- Form submissions should be idempotent under double-click or Enter key repeat.
- Loading skeletons should not shift layout excessively.
- Empty and error states should include a useful next action.
- Mobile layout should keep controls reachable without horizontal scrolling.
- Media players should not autoplay with sound.
- Private media URLs should not leak into public discovery or unauthenticated
  pages.
- Theme changes should not obscure focus rings, status chips, media controls, or
  disabled states.
- Long project names, asset filenames, emails, and error messages should wrap
  cleanly.
- API request failures should not leave stale optimistic UI states.
