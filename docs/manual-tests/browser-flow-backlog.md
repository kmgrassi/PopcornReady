# Browser Manual Flow Backlog

This backlog defines browser-first manual test flows that should be exercised
beyond the route smoke pass. It complements
[Full App Manual Testing Guide](full-app-inventory.md), which remains the
end-to-end manual QA guide for the active Vite SPA, Express API, and
Supabase-backed data/auth stack.

Use the local database setup from the full guide unless a flow explicitly needs
hosted auth, production storage, or provider-backed generation. Admin Evals are
not included here because that surface is not fully hooked up yet.

## Priority Order

Run these flows first when doing a high-confidence browser pass:

1. Dashboard project creation.
2. Landing quick-start generation.
3. Run progress and review actions.
4. Project detail, storyboard, and watch pages.
5. Library collections, media viewer, visibility, and regeneration.
6. Settings writes.
7. Uploads, templates, brand kit, and anchors.
8. Public project and asset sharing.

## Dashboard Project Creation

Purpose: verify the authenticated creation path from dashboard into the
stepwise project flow.

- Sign in with a real local Supabase test user.
- Open `/dashboard`.
- Click the primary `Create new video` action.
- Verify the app routes to `/projects/new` without losing the authenticated
  shell.
- Complete the brief step with goal, audience, format, and target length.
- Refresh the page and confirm draft state recovers without creating a duplicate
  project.
- Choose generated footage and then uploaded/source-footage mode where
  available.
- Continue through plan, story, generate, review, and export surfaces.
- Verify each manual stop or review-gate option leaves the run waiting for user
  action instead of silently continuing.
- If provider keys are missing, verify generation surfaces a readable
  configuration error.

Record as product gaps:

- Missing explicit stop-at-brief or stop-after-planning controls.
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
- Complete signup and confirm the app either starts the pending run or clearly
  returns the user to a resumable creation surface.
- Repeat with the guest or anonymous path when anonymous sign-in is enabled.
- Verify guest limits route the user toward account creation instead of starting
  an extra run.
- Confirm a successful run start navigates to
  `/projects/:projectId/runs/:runId`.
- Without provider keys, verify the error is readable and recoverable.

Known gap to recheck:

- Landing stores pending prompt data separately from the quick-start resume path.
  If signup lands on `/dashboard` without resuming the run, record this as a
  flow wiring bug.

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
- Verify malformed, missing, or unauthorized run URLs show useful error states
  with navigation back to a stable surface.

## Project Detail, Storyboard, And Watch

Purpose: verify project-owned read, edit, and playback surfaces.

- Open `/projects/:projectId` for a valid project.
- Verify project metadata, status, poster/fallback, and linked actions.
- Open `/projects/:projectId/storyboard`.
- Verify loading, missing-project, no-storyboard, and API-error states.
- For a project with a storyboard, edit scene and beat fields.
- Add, remove, and reorder scenes or beats where controls are exposed.
- Save, refresh, and confirm the latest storyboard state persists.
- Verify dirty, saving, saved, and save-error states.
- Open `/storyboard` and confirm it redirects to `/library/projects`.
- Open `/projects/:projectId/watch`.
- For a project with playable output, verify video controls and metadata.
- For a project without playable output, verify storyboard fallback or the
  current empty/error state is clear.

## Library, Media Viewer, And Regeneration

Purpose: verify the main persisted workspace collections and media actions.

- Open `/library` and confirm it redirects to `/library/projects`.
- Switch between projects, runs, assets, outputs, and evals tabs where present.
- Open compatibility routes `/projects`, `/runs`, `/assets`, and `/outputs`.
- Verify filter, pagination, empty, loading, and API-error states.
- From project cards, open detail, storyboard, runs, and watch links.
- From run rows, open `/projects/:projectId/runs/:runId`.
- From asset and output cards, open the media viewer.
- Test image, video, and audio media when fixture data exists.
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
  parameter. If not, record this as a product gap.

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
