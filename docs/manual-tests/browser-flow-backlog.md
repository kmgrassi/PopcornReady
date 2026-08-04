# Browser Manual Flow Backlog

<!-- agent-summary: This backlog prioritizes browser-first feature flows beyond the route smoke pass. -->
<!-- agent-summary: The full-app manual guide remains authoritative for setup, route inventory, and cross-cutting checks. -->
<!-- agent-summary: Local Supabase is the default unless hosted auth, storage, or real providers are under test. -->
<!-- agent-summary: Provider-backed runs use the production fixture corpus in isolated non-customer workspaces. -->
<!-- agent-summary: User changes flow through normal product actions, including object-scoped Request Changes. -->
<!-- agent-summary: Public/private, RLS, reload, idempotency, mobile, and cleanup behavior remain explicit assertions. -->
<!-- agent-summary: Record product gaps separately from harness failures and never improvise unsafe production mutations. -->

This backlog defines browser-first manual test flows that should be exercised
beyond the route smoke pass. It complements
[Full App Manual Testing Guide](full-app-inventory.md), which remains the
end-to-end manual QA guide for the active Vite SPA, Express API, and
Supabase-backed data/auth stack.

Use the local database setup from the full guide unless a flow explicitly needs
hosted auth, production storage, or provider-backed generation. Admin evals are
included only for admin-capable sessions; `/evals` redirects to
`/admin/evals`.

For provider-backed manual runs that need real generated media, use the
[production fixture corpus](../../seed/production-fixtures/README.md) and its
[manifest](../../seed/production-fixtures/manifest.json). The corpus lists the
assets Popcorn Ready wants to generate anyway, so a manual pass should spend real
provider calls on those prompts instead of one-off tester prompts. Use one real
fixture/internal-test project per manifest asset and keep the manifest asset
`id` in the project name.

## Priority Order

Run these flows first when doing a high-confidence browser pass:

1. Dashboard project creation.
2. Landing quick-start generation.
3. Run progress and review actions.
4. Project detail, storyboard generation/revision, and watch pages.
5. Library projects/assets, project-scoped runs/outputs, media viewer,
   visibility, and regeneration.
6. Settings writes.
7. Uploads, templates, brand kit, and anchors.
8. Public project and asset sharing.

## Dashboard Project Creation

Purpose: verify the authenticated full-video creation path into the stepwise
project flow.

- Sign in with a real local Supabase test user.
- Open `/dashboard`.
- Open `/projects/new` from a full-production CTA or direct route.
- Verify the app routes to `/projects/new` without losing the authenticated
  shell.
- If saved drafts exist, resume and delete one before starting a fresh draft.
- Complete the brief step with goal, target length, and any relevant Advanced
  Direction fields.
- Refresh the page and confirm draft state recovers without creating a duplicate
  project.
- Choose prompt-only footage, then go back and test uploaded/source-footage mode.
- Continue from footage. The current flow auto-starts production as it reaches
  the plan step and then redirects to the run progress route.
- Test checkpoint behavior by letting the run reach the server-owned storyboard
  boundary (every initial run pauses there), or use a fixture run with a
  reached gate; the retired `reviewGates` deep-link parameter is ignored and
  the setup UI intentionally has no checkpoint picker.
- Verify each run waits at the storyboard gate for user action instead of
  silently continuing.
- If provider keys are missing, verify generation surfaces a readable
  configuration error.

Record as product gaps:

- Do not record the absent review-checkpoint picker as a gap: the storyboard
  boundary is server-owned policy and client-selected gates are retired.
- Drafts that cannot be resumed from dashboard after leaving the flow.
- Double-click or Enter-repeat behavior that creates duplicate drafts, projects,
  or runs.

## Landing Quick-Start Generation

Purpose: verify the public prompt entry path and its account handoff behavior.

- Open `/`.
- Submit an empty or too-short prompt and verify validation prevents a run.
- Enter a valid prompt and select each supported duration.
- Submit and verify the account-choice modal opens.
- Choose `Create account`.
- Verify the pending prompt survives the `/signup` redirect through router state
  or session storage.
- Complete signup and confirm the app claims the pending quick-start prompt,
  starts the run, and navigates to `/projects/:projectId/runs/:runId`.
- Repeat with the guest or anonymous path when anonymous sign-in is enabled.
- Verify guest limits route the user toward account creation instead of starting
  an extra run.
- Confirm a successful run start navigates to
  `/projects/:projectId/runs/:runId`.
- Without provider keys, verify the error is readable and recoverable.
- With provider keys, choose one image, one video, and one audio prompt from the
  production fixture corpus and verify the resulting projects/assets can be
  found from dashboard, project detail, Library assets, and watch/output surfaces
  where applicable.

Regression to watch:

- If signup lands on `/dashboard` without starting the pending run, record this
  as a quick-start resume regression. The landing handoff should now write both
  landing and quick-start pending prompt state.

## Run Progress And Review Actions

Purpose: verify long-running generation states and user-controlled gates.

- Open seeded run progress routes for queued, running, succeeded, failed,
  canceled, and unknown states.
- Refresh during a non-terminal run and verify polling resumes.
- For non-gated in-flight runs, click the stop/cancel action and verify the
  terminal canceled state.
- For review-gated runs, approve and reject with notes.
- Verify notes clear after a successful action.
- Verify reject/regenerate keeps the run from continuing silently.
- Open generated assets from the progress view.
- Trigger targeted generated-asset feedback where enabled.
- On a seeded failed run and on a seeded canceled run that each contain a generated
  asset, open that asset's **Request Changes** flow and submit a targeted note.
  Verify the request is accepted (not rejected with a terminal-run validation
  error), the run returns to `running`, its prior terminal error is cleared, and
  the revision is dispatched for the agent to process.
- Verify malformed, missing, or unauthorized run URLs show useful error states
  with navigation back to a stable surface.
- During unknown provider work, verify the indicator is indeterminate and no
  `0%`, `50%`, fixed stage ordinal, or guessed next stage appears. Confirm
  elapsed time and last activity remain readable with reduced motion enabled.
- Seed a failed clip followed by active storyboard recovery. The clip must stay
  visibly failed while the current work is labeled Recovering.
- Verify storyboard-only completion says no video was created; only a ready,
  playable export may say Video ready.
- From the full video-project flow, leave every review checkpoint unchecked and submit
  a prompt-only 10-second run. Verify the request has no implicit storyboard
  stop, survives refresh, advances from selected storyboard tiles into
  keyframes/clips, and reaches a playable export or a truthful failed stage.
  Repeat with an explicit storyboard stop and verify only that deliberate run
  ends with storyboard-only completion.

## Project Detail, Storyboard, And Watch

Purpose: verify project-owned read, agent-revision, generation, and playback
surfaces.

- Open `/projects/:projectId` for a valid project.
- Verify project metadata, status, poster/fallback, and linked actions.
- Generate a storyboard from the project detail preview when none exists; verify
  progress, reload recovery, and failed-job messaging.
- Open `/projects/:projectId/storyboard`.
- Verify loading, missing-project, no-storyboard, and API-error states.
- For a project with a storyboard, verify scene/beat/panel rendering and
  selected panel images.
- Click an image panel and submit Request Changes feedback; verify the revising
  skeleton, run polling, and refreshed image state.
- Verify failed or URL-less image assets expose regeneration only when an
  existing `imageAssetId` is present. Missing initial panels should be treated
  as a storyboard-generation gap.
- Open `/storyboard` and confirm it redirects to `/library/projects`.
- Open `/projects/:projectId/watch`.
- For a project without playable output, verify Outputs/Watch are replaced by a
  visible reason and the direct Watch URL renders the same no-output state.
- For a project with playable output, verify video controls and metadata.

## Library, Media Viewer, And Regeneration

Purpose: verify the main persisted workspace collections and media actions.

- Open `/library` and confirm it redirects to `/library/projects`.
- Switch between the current Projects and Assets tabs.
- Open compatibility routes `/projects`, `/runs`, `/assets`, and `/outputs`;
  project-scoped runs/outputs should redirect to project detail anchors.
- Verify filter, pagination, empty, loading, and API-error states.
- From project cards, open detail, storyboard, runs, and watch links.
- From project detail run rows, open `/projects/:projectId/runs/:runId`.
- From asset cards, open the media viewer. Verify outputs through dashboard
  recent outputs and `/projects/:projectId/watch`.
- Test image, video, and audio media when fixture data exists.
- Prefer image, video, and audio assets generated from the production fixture
  corpus when testing real media behavior.
- Use next, previous, Escape close, and backdrop close.
- Verify missing playback URLs fall back to thumbnails or placeholders.
- Toggle public/private asset visibility and confirm optimistic UI either
  succeeds or rolls back cleanly.
- Trigger image regeneration from the media viewer or failed image tile.
- Verify missing saved prompts open the prompt entry path instead of failing
  silently.
- Verify regenerate request failures show a readable error and do not create
  duplicate requests on repeated clicks.

## Settings Writes

Purpose: verify user-controlled account, appearance, provider, and model
settings.

- Open `/settings`.
- Verify account label, workspace label, auth mode, and secondary links.
- Toggle each theme and refresh after each selection.
- Confirm focus rings, status chips, disabled controls, and errors remain
  legible in every theme.
- Save and delete provider API keys.
- Save workspace model settings and refresh to confirm persistence.
- Open `/account` and verify credits balance, buy-credit actions, and
  transaction history in local and hosted modes.
- Verify local developer mode handles unavailable provider-key data without a
  server error.
- Sign out and confirm the app returns to `/`.
- Enter a protected route while signed out and confirm behavior matches the
  configured auth mode.

## Uploads

Purpose: verify browser-local upload staging and preview behavior.

- Open `/uploads`.
- Select multiple files across image, video, and audio types.
- Verify staged count, total size, media kind, name, MIME type, and size.
- Open each staged file in the media viewer.
- Use next, previous, Escape close, and backdrop close.
- Remove one file and verify totals update.
- Remove all files and verify the empty state returns.
- Refresh and confirm browser-local staged files are gone.

## Templates

Purpose: verify reusable starting point navigation.

- Open `/templates`.
- Verify category pills and template cards render.
- Click `Blank project` and confirm it routes to `/projects/new`.
- Click `Use template` on each template type and confirm it routes to
  `/projects/new?template=...`.
- Verify whether the project creation flow consumes the `template` query
  parameter. Today the route accepts it but does not prefill the Studio shell, so
  record this as a product gap if it remains true.

## Brand Kit

Purpose: verify local brand guidance controls.

- Open `/brand`.
- Change brand name, color, font, tone, and end-frame guidance.
- Verify the preview updates immediately.
- Verify the prompt summary reflects the current selections.
- Refresh and confirm values reset unless persistence has been added.
- Record whether the route is intentionally local-only or expected to persist to
  the workspace API.

## Anchors And Catalog

Purpose: verify shared creative starting points and owned catalog surfaces.

- Open `/anchors`.
- Search and filter by supported anchor kinds.
- Open an anchor detail route from a catalog entry.
- Verify detail metadata, preview media, linked projects, and empty states.
- Test like, copy, or use-in-project actions when seeded data exposes them.
- Open `/anchors/mine`.
- Verify owned-anchor empty state or published entries.
- Record any controls that are visible before the backing API is ready.

## Public Project And Asset Sharing

Purpose: verify unauthenticated read surfaces and storage privacy.

- Open `/p/:projectId` for a public project in a signed-out browser context.
- Verify public metadata, storyboard/output previews, and fallback states.
- Open `/p/:projectId` for a private or missing project and verify access is
  denied or a not-found state appears.
- Confirm private workspace metadata and private media URLs are not exposed in
  public responses.
- Run [Asset Sharing](asset-sharing.md) for the public/private asset URL
  lifecycle.
- Verify public assets are accessible without auth.
- Verify private assets are inaccessible without auth.
- Check signed URL expiry and fallback behavior where practical.
- When testing with real generated assets, choose public/private candidates from
  production fixture corpus projects so the same assets also validate storage,
  discovery, and sharing behavior.

## Cross-Cutting Checks

Apply these checks across every flow:

- Run desktop and narrow mobile viewports for dense screens.
- Refresh every top-level route, filtered URL, detail page, progress page, and
  media viewer.
- Use browser back and forward through landing, auth, library filters, project
  detail, storyboard, progress, and media viewer routes.
- Watch for unhandled console errors and unexpected 4xx/5xx network responses.
- Repeat submit actions with double-click and Enter to catch duplicate writes.
- Confirm loading states do not cause excessive layout shift.
- Confirm empty and error states include a useful next action.
- Confirm long project names, filenames, emails, and provider errors wrap
  cleanly.
- Confirm media players do not autoplay with sound.
- Confirm theme changes do not obscure focus rings or status states.
