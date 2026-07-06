# Project Visibility UI Scope

## Objective

Give project owners a clear, low-friction way to see and update whether a
project is public or private from the authenticated web UI.

The data model and API already support project visibility. The missing work is a
small web surface: expose the project-level mutation in the typed API client,
wire it through TanStack Query, and add a guarded UI affordance where users
already inspect projects.

This is a direct metadata control, not generated content editing. It fits the
`docs/ui-interaction-model.md` carve-out for navigation and organization
metadata: the user is changing sharing/security state, not authoring timeline,
storyboard, prompt, or media content.

## Current State

### Data and API support

- `projects.visibility` is part of the shared project contract as
  `"public" | "private"` in `packages/shared/src/v1/types.ts`.
- `PATCH /api/v1/projects/:projectId` accepts `{ visibility }` in
  `apps/api/src/routes/v1/projects.ts`.
- The route validates through `parseSetProjectVisibility`, which reuses the
  asset visibility validator in `apps/api/src/lib/api/v1/asset-schemas.ts`.
- `setProjectVisibility()` in `apps/api/src/lib/api/v1/store.ts` updates the
  project row and reconciles effective asset storage. A private project forces
  public asset bytes into private delivery; re-publishing restores effective
  public delivery for assets whose own visibility is public.
- Asset-level visibility already has a web API helper and mutation path:
  `v1Api.setAssetVisibility()`, `useSetAssetVisibilityMutation()`, and the
  dashboard asset-library mutation in `apps/web/src/lib/v1/dashboard/query.ts`.

### Web UI support

- `ProjectDetailPage` renders the project visibility as plain text in the
  concept metadata row.
- The shared `VisibilityBadge` component exists in
  `apps/web/src/components/ui/VisibilityBadge.tsx`, but the project detail page
  is not using it.
- There is no `v1Api.setProjectVisibility()` helper.
- There is no project visibility TanStack mutation hook.
- There is no project-level control in the project detail page, project library,
  or any project settings surface.

## Product Behavior

### Visibility meanings

- `Public`: the project can appear in public/read-only discovery surfaces and
  its public assets can resolve through public delivery.
- `Private`: the project is only visible to authorized workspace users, and all
  effective asset delivery must be private/signed.

The UI copy should make the storage/security implication concrete without
over-explaining internals:

- Public helper: "Visible in public discovery. Public assets can be shared."
- Private helper: "Only your workspace can view it. Media uses private links."

### Default placement

The primary control belongs on the owner project detail page, near the existing
project status and created-date metadata:

- Replace the plain `Public`/`Private` text with `VisibilityBadge`.
- Add a secondary or ghost action labeled `Make private` or `Make public`.
- Hide the action on read-only public project views.
- Disable the action while the mutation is pending.
- Show mutation success and error through the existing mutation meta/toast
  pattern.

This page is the right first surface because users inspect project-level state
there, the route already loads the canonical `V1Project`, and it avoids adding a
new settings route just for one field.

### Confirmation behavior

Use a lightweight confirmation dialog or popover before making a project public.
Making a project private can be a one-click action, but the implementation may
use the same confirmation component for symmetry.

Suggested confirm copy:

- Make public title: "Make this project public?"
- Make public body: "People may be able to discover the project and view its
  public media. Private assets stay private."
- Make private title: "Make this project private?"
- Make private body: "The project will leave public discovery and media delivery
  will be reconciled to private links."

The confirm action should be the only popcorn-gold CTA in the dialog. Cancel is
secondary.

## Implementation Scope

### PR 1: project detail mutation

Backend work should be limited to tests unless verification finds a regression.
The route and store function already exist.

Web tasks:

1. Add `setProjectVisibility(projectId, visibility)` to
   `apps/web/src/lib/api-client/v1-api.ts`.
   - Method: `PATCH`.
   - Path: `/api/v1/projects/:projectId`.
   - Body: `{ visibility }`.
   - Response: `{ project: V1Project }`.
2. Add a TanStack mutation hook next to the current project query hooks in
   `apps/web/src/lib/queryClient.ts`.
   - Use `v1Api.setProjectVisibility()`.
   - Optimistically update `queryKeys.project(projectId)` if that key already
     exists locally, or update on success if the local helper shape makes
     optimistic updates awkward.
   - Invalidate `["projects"]`, `queryKeys.project(projectId)`, and workspace
     dashboard/project-list queries that display project cards.
   - Use mutation meta messages:
     - Success: "Project visibility updated"
     - Error: "Could not update project visibility"
3. Update `apps/web/src/routes/ProjectDetailPage.tsx`.
   - Use `VisibilityBadge`.
   - Add the owner-only visibility action in `ProjectConcept`.
   - Keep `readOnly` behavior strict: public read-only views display the badge
     but never render the mutation control.
   - Keep local React state only for the confirmation dialog/open control.
4. Add `ProjectVisibilityControl.module.css` or
   `ProjectDetailPage.module.css` rules only if the page already owns the
   component. Do not add styles to `globals.css` or legacy global sheets.

Tests:

- API schema test for `parseSetProjectVisibility()` if it is not already covered.
- Web unit/type coverage through `pnpm --filter @popcorn/web typecheck`.
- API typecheck through `pnpm --filter @popcorn/api typecheck`.
- Browser smoke test:
  - Load an owned project.
  - Confirm the badge displays current state.
  - Toggle visibility.
  - Confirm the badge updates without a full reload.
  - Reload and confirm the server value persists.

### PR 2: project list affordance

Add visibility display, but not necessarily mutation, to the project library
cards/list rows:

- Reuse `VisibilityBadge`.
- Keep the project detail page as the primary mutation surface.
- If inline mutation is added later, use the same hook and confirmation copy.

This is intentionally a second PR to avoid editing multiple route surfaces in
the same change.

### PR 3: discover/share polish

Only after PR 1 ships:

- Add a "Copy public link" action for public projects if a stable public route is
  available.
- Hide or disable the copy action for private projects with a direct explanation.
- Add an empty-state or success affordance that explains where public projects
  appear.

Do not block the core visibility toggle on public-link polish.

## UI Design Notes

- Use existing buttons, dialogs, state cards, and the shared badge before
  creating new primitives.
- Keep the control compact. Project visibility is important, but it should not
  compete with watching the output or requesting changes.
- Do not add direct controls for asset visibility to the project hero. Asset
  visibility already belongs in asset/library surfaces.
- Do not hardcode colors. Use tokens through CSS Modules.
- Preserve keyboard access and visible focus for the menu/dialog.

## Data and Cache Notes

Project visibility affects more than the single project object:

- The project detail query must update immediately.
- Workspace project lists should refresh so cards show the new badge state.
- Public discovery and inspiration queries may need invalidation when the user is
  on those surfaces, but owner-side correctness should not depend on public feed
  refresh.
- Asset URLs may change when the API reconciles effective storage. Any active
  media/asset queries for the same project should be invalidated after success.

The mutation should prefer invalidation over broad manual cache rewriting because
the server owns the storage reconciliation and returned signed URLs may change.

## Open Questions

- Is `PATCH /api/v1/projects/:projectId` intended to remain visibility-only, or
  will it later accept project name/archive metadata? If it will broaden, the web
  helper should be named around visibility anyway to keep UI intent explicit.
- Should making a project public require a paid/free tier check in the UI, or is
  the current backend policy intentionally permissive after
  `20260609020000_allow_all_visibility_toggle.sql`?
- Which public route is canonical for a project after it is made public:
  `/discover/projects/:id`, `/projects/:id` read-only, or another share URL?
  The initial toggle does not need to answer this.
- Should project library cards get inline mutation controls, or only badges?
  Start with badges and route users to detail for the first implementation.

## Acceptance Criteria

- An owner can update a project from public to private and private to public from
  the project detail UI.
- Read-only public project views display visibility but cannot mutate it.
- The UI uses TanStack Query for the server mutation and invalidation.
- The visibility badge updates after mutation and persists after reload.
- The implementation does not add styles to `apps/web/src/styles/globals.css` or
  other legacy global sheets.
- Typecheck passes for the touched web/API packages.
