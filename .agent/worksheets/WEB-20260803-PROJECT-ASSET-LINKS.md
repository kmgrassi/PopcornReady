# Worksheet: WEB-20260803-PROJECT-ASSET-LINKS

<!-- agent-summary: Route project media previews into the canonical library asset view. -->
<!-- agent-summary: Keep project-media selection controls independent from preview navigation. -->
<!-- agent-summary: Link overview poster and storyboard images only when a durable asset id exists. -->
<!-- agent-summary: Preserve object-scoped Request Changes behavior in editing and run-review surfaces. -->
<!-- agent-summary: Keep public read-only project media non-navigable to authenticated library routes. -->
<!-- agent-summary: Validate canonical asset-detail navigation at desktop and mobile widths. -->
<!-- agent-summary: Commit implementation, tests, documentation, worksheet, and feedback together. -->

## Goal and acceptance criteria

Clicking a persisted image or asset from authenticated project media and project
overview surfaces opens the canonical `/library/assets?assetId=…` asset view.
Selection controls remain independent, links are keyboard accessible, public
project views do not lead into authenticated library routes, and existing
Request Changes interactions keep their current behavior. The owned, ready asset
viewer also offers one simple, exact-target **Suggest an edit** entry into that
same durable Request Changes lifecycle.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- Impeccable product-register guidance

## Decisions

- Use the existing query-backed library asset viewer as the only asset-detail
  destination.
- Keep project selection and asset-detail navigation as separate controls.
- Do not redirect dedicated storyboard or run-review media, whose clicks own the
  object-scoped Request Changes workflow.

## Changes

- Added a shared asset-library path builder that includes encoded asset and
  project identity.
- Routed project-media previews to the canonical library asset viewer while
  preserving the separate Select control and upload states.
- Linked the authenticated project poster, overview storyboard image, and mobile
  hero asset; kept shared read-only projects plain and kept storyboard scene
  metadata linked to the storyboard.
- Added exact project-asset hydration when a linked asset is absent from the
  loaded workspace page, sharing its response with the billing query.
- Suppressed visibility mutation controls when exact hydration cannot prove the
  asset's current visibility.
- Added an owned-ready **Suggest an edit** action to the canonical viewer. It
  retains the selected asset URL, opens the existing exact-asset Request Changes
  lifecycle for images, videos, and audio, and returns focus to the viewer action
  when dismissed.
- Updated focused E2E coverage and inventory documentation.
- Addressed PR review feedback by normalizing production detail `remoteUrl`
  values into the canonical viewer's playable URL and preserving the
  project-media creation draft across a preview round trip with a project-keyed,
  one-shot session stash.

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `VITE_API_URL=http://127.0.0.1:4215 PLAYWRIGHT_WEB_PORT=3215
  POPCORN_E2E_API_PORT=4215 pnpm --filter @popcorn/web exec playwright test
  e2e/specs/library-collections.spec.ts e2e/project-mobile-status.spec.ts` —
  passed before rebase, 7 passed and 1 expected viewport skip across Chromium,
  mobile Chrome, and mobile Safari.
- After rebasing onto `origin/main`, the same focused Playwright command passed
  with the upstream media-cache coverage included: 11 passed and 1 expected
  viewport skip. Web typecheck also passed against the rebased tree.
- After adding **Suggest an edit**, the focused Library/project suite passed
  again with 11 tests and 1 expected viewport skip. The assertion proves the
  exact asset target, absence of `rootRunId`, public/non-ready gates, preserved
  deep-link URL, single-Escape return, and restored keyboard focus.
- `pnpm agent:lint:fix` — passed.
- PR feedback regression checks: web typecheck passed; the focused draft unit
  suite passed 6 tests; the new production-shaped deep-video Playwright case
  passed; and the full project-media navigation scenario passed after verifying
  selection, preset, and intent restoration on Back.
- The final focused browser suite passed with 12 tests and 1 expected viewport
  skip across Chromium, mobile Chrome, and mobile Safari. It also asserts the
  one-shot project draft key is removed after restoration.
- In-app Browser inspection against a deterministic local fixture covered the
  authenticated project overview at the default desktop viewport and 390×844.
  Desktop exposed distinct poster, storyboard-image, and storyboard-metadata
  links; poster activation opened the exact asset outside the workspace's loaded
  result page, showed its canonical dialog and credits, and Close removed both
  query parameters. Mobile exposed one 366px-wide hero activation, navigated to
  the canonical Scene asset dialog, and kept document width equal to the 390px
  viewport.
- Follow-up in-app Browser inspection exercised the owned asset viewer and edit
  request against a deterministic fixture at desktop and 390×844. Desktop showed
  the quiet footer action and grounded image/prompt edit dialog. Mobile showed
  an even two-column viewer action grid and a stacked edit form with no document
  overflow. Escape returned to the same `assetId` URL with **Suggest an edit**
  focused.
- PR-feedback in-app Browser inspection exercised project media through its
  actual route with a deterministic local API at the default desktop viewport:
  selected an asset, chose the montage preset, opened the canonical asset viewer,
  dismissed it, and returned with the selection, preset, and intent restored.
  At 390×844 the restored controls remained usable and document width matched
  the 390px viewport.
- `pnpm agent:validate -- --scope web` — passed after the final interaction-model
  documentation update, including agent lint, workflow-policy tests, migration
  tests/validation, and web typecheck; the same scoped validation passed again
  after the viewer edit-action follow-up and after the PR-comment fixes.

## Independent reviews

- Research checkpoint: identified `ProjectMediaGalleryPage`'s local viewer as
  the direct mismatch and catalogued overview, mobile, storyboard, and run-review
  surfaces. Flagged that canonical deep links currently open only when the asset
  is present in the loaded library result set.
- Plan checkpoint: approved with exact-asset hydration required, presentational
  poster boundaries, no nested controls, read-only gating, distinct storyboard
  links, and keyboard/mobile verification.
- Implementation checkpoint: initially blocked because exact-hydrated assets
  had unknown visibility but still exposed a guessed visibility mutation. The
  action is now withheld unless visibility is known; re-review confirmed the
  blocker is resolved with no remaining blocking finding.
- Wrap-up checkpoint: approved the final 18-file scope, focused tests,
  authoritative interaction-model update, worksheet/feedback records, browser
  evidence, resolved visibility finding, and final scoped validation.
- Follow-up research checkpoint: confirmed the existing durable proposal
  lifecycle supports exact image, video, and audio targets without a new backend
  path. It required owned/ready gating and identified the stacked-overlay and
  competing-Escape risk.
- Follow-up plan checkpoint: approved retaining the selected URL while
  temporarily unmounting the viewer, capturing a stable target/media snapshot,
  restoring focus through a callback ref, and explicitly testing non-ready
  assets.
- Follow-up implementation checkpoint: approved exact targeting, gating,
  snapshot stability, modal sequencing, focus restoration, generic previews,
  and E2E coverage. Its documentation correction now distinguishes existing
  failed-image recovery from the new ready-only edit action.
- Follow-up wrap-up checkpoint: approved the final interaction, responsive
  containment, accessibility, tests, and authoritative documentation with no
  blocker after reviewing the 11-pass/1-skip suite, desktop/mobile browser
  evidence, and repeated scoped validation.
- PR-comment research/plan checkpoint: confirmed both unresolved findings,
  recommended `remoteUrl`-first normalization plus an off-page video regression,
  and chose a project-keyed one-shot session draft over retaining nested routes
  or adding a global store.
- PR-comment implementation checkpoint: found no blocker in the production URL
  contract, Strict Mode-safe draft restore, or regression coverage. Its
  nonblocking follow-ups were applied by excluding modified-link activations,
  asserting the session stash is consumed after restoration, and narrowing the
  detail type to the runtime URL fields used by this fix.
- PR-comment wrap-up checkpoint: approved the final URL normalization, one-shot
  draft lifecycle, accessibility, responsive behavior, tests, browser evidence,
  and documentation with no blocking finding. Its final wording correction now
  describes the deep-video assertion precisely as viewer-source wiring.

## Blockers and risks

- User-example URLs containing only `assetId` still depend on the asset being in
  the loaded workspace collection. New project-view links also include
  `projectId`, allowing exact hydration outside that page.
- Exact project-asset responses currently omit a typed project display name and
  visibility, so deep-linked viewers use a neutral project label and do not show
  the visibility mutation. Their runtime media URL is now explicitly represented
  and normalized from `remoteUrl`.

## Next action / handoff

Amend the existing commit, move the worksheet tag, push, and update
ready-for-review PR 881.
