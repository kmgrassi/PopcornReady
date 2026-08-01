# Worksheet: WEB-20260801-CREW-SET

<!-- agent-summary: Ground the standalone creation loader crew in a production-set scene. -->
<!-- agent-summary: Replace the ambiguous CSS worktable that resembles a scrollbar. -->
<!-- agent-summary: Use one compact pixel-art backdrop behind a director, camera operator, actor, and actress. -->
<!-- agent-summary: Preserve status truthfulness, reduced motion, and cross-theme legibility. -->
<!-- agent-summary: Keep the complete loader image payload under its existing budget. -->
<!-- agent-summary: Validate the production route at desktop and mobile widths. -->
<!-- agent-summary: Commit implementation, tests, documentation, worksheet, and feedback together. -->

## Goal and acceptance criteria

Make the standalone asset-creation loader read as a small working production
set rather than isolated sprites. Remove the gray CSS-drawn worktable that
resembles a scrollbar, add a cohesive pixel-art soundstage backdrop, keep the
crew visually dominant, preserve current loading semantics and reduced-motion
behavior, and remain within the existing compact-artwork byte ceiling.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/web/PRODUCT.md`
- `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/agent-system/performance-and-visual-regression.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`
- `apps/web/e2e/README.md`
- Impeccable product-register guidance
- ImageGen skill guidance
- OpenAI `sprite-pipeline` skill guidance and official game-studio scripts

## Decisions

- Remove the misleading CSS `worktable`; the actual progress track in the
  status column remains unchanged and visible only during active work.
- Use a generated 2:1 pixel-art soundstage plate with no people, text, logos, or
  UI. Keep the center quiet and ground a director, camera operator, actor, and
  actress on one continuous floor plane.
- Keep the existing camera operator's identity and animation, clean its opaque
  light edge contamination, and use the official sprite workflow to
  generate, chroma-clean, shared-scale normalize, and preview the three new
  three-frame strips at the camera strip's existing 423×141 geometry.
- Resize the generated plate to 640×320 PNG so all five loader assets remain
  below the existing 512 KiB aggregate ceiling.
- Keep the artwork decorative under the loader's existing `aria-hidden` boundary.
- Preserve explicit z-index tiers for the backdrop, light wash, and actors; let
  the plate's continuous floor replace the redundant solid foreground strip.
- Reuse the exact crew scene for route-level initial loads through one shared,
  semantic loading-state wrapper. Preserve existing content-shaped geometry as
  a hidden, non-animating reservation for dense layouts; keep compact, inline,
  paginated, thumbnail, upload-progress, and background-refresh indicators
  purpose-sized.

## Changes

- Added the generated and locally resized 640×320 production-set plate at
  `apps/web/public/sprites/progress/studio-set.png`.
- Replaced the ambiguous CSS worktable with the soundstage backdrop, assigned
  explicit backdrop/light/actor layers, and removed the redundant solid floor
  strip so the scene has one continuous floor plane.
- Extended the existing PNG dimension and aggregate-byte assertion to cover the
  set plate, and asserted the live loader references it.
- Updated the Web E2E README and repository E2E inventory to describe the
  production-set resource coverage.
- Replaced the writer and workshop worker with a director, actor, and actress;
  retained the existing camera operator; and positioned the four roles as one
  directed performance from left to right.
- Removed the two superseded progress-only strips and added exact asset-order,
  dimension, compact-payload, idle-frame, and reduced-motion assertions for the
  four-role cast.
- Pulled the missing normalizer and preview utilities from the official
  `openai/plugins` game-studio source with a shallow sparse checkout, then ran
  `normalize_sprite_strip.py` at three 141px frames and
  `render_sprite_preview_sheet.py` for each full strip. ImageGen's
  `remove_chroma_key.py` removed the sampled magenta field before shared-scale,
  bottom-center normalization; a bounded opaque-pixel decontamination pass
  removed residual purple and light edge colors without changing frame alpha.
- Added inward outer-role anchors through 390px and a smaller scale below 360px
  so the performance poses remain inside the set continuously down to 320px.
- Mirrored only the actress sprite frame so her approved idle and action poses
  face the actor without regenerating artwork, then tightened the performer
  anchors to 64/82% on desktop and 62/80% through 390px.
- Added behavior-focused coverage that asserts the actor remains unmirrored,
  the actress is mirrored, and their center gap is smaller than the
  camera-to-actor gap while preserving the 320px containment check.
- Added `StudioCrewLoadingState` as the narrow route-level loading contract and
  adopted it across Activity, all four Library collections, project overview
  and public overview, project steps, Storyboard, project media, Watch, Uploads,
  Home, Inspiration, the Anchors list, and Anchor detail.
- Retained content-shaped geometry on Activity, Library collections, project
  overview, Uploads, Inspiration, Home, and Anchors as hidden, non-animating
  layout reservation so the branded status does not trade away layout
  stability; replaced the remaining plain route placeholders outright.
- Added a mobile reduced-motion Library check for the shared status semantics,
  animation suppression, overflow containment, and loaded-content transition;
  documented the route-level versus purpose-sized loading rule.

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `VITE_API_URL=http://127.0.0.1:4212 PLAYWRIGHT_WEB_PORT=3212
  POPCORN_E2E_API_PORT=4212 pnpm --filter @popcorn/web exec playwright test
  e2e/asset-studio.spec.ts` — passed, 33/33 across Chromium plus the tagged
  mobile Chrome and mobile Safari cases.
- The focused `keeps the active crew calm and contained on mobile with reduced
  motion` Playwright run passed 1/1 after adding its 320px transformed-actor
  containment assertion.
- Performer-blocking continuation: `pnpm --filter @popcorn/web typecheck`
  passed; the focused manual-approval and active-crew Playwright pair passed
  2/2; and the complete Asset Studio suite passed 33/33 after the mirror and
  anchor changes.
- The five active loader images total 454,365 bytes, below the existing 512 KiB ceiling.
- Route-loading continuation: `pnpm --filter @popcorn/web typecheck` passed;
  `library-collections.spec.ts` passed 3/3, including the new mobile
  reduced-motion loading contract, hidden reservation semantics, and panel
  variant; `pnpm agent:lint:fix` passed; and
  `pnpm agent:validate -- --scope web` passed.
- `run-progress.spec.ts` passed 27/27 across Chromium, mobile Safari, and mobile
  Chrome after retaining the specialized recovery opener, including its stored
  hint and transition into failure details.
- In-app browser route-loading inspection paused the Library projects request at
  the network boundary, then verified the real transient state at 1280×900 and
  390×844. The status remained `aria-busy`, the desktop scene was centered at
  720px, the mobile scene fit within 366px, reduced motion reported no sprite
  animation, and document width matched viewport width at both sizes. After the
  reservation fix, the desktop state remained 283px tall inside a hidden 984px
  content reservation with exactly one loading status and no visible skeleton.
  The request was then resumed and the loading state detached into real content.
- In-app browser inspection against a deterministic local run fixture:
  1280×900 in `popcorn` and `popcorn-warm`, plus 390×844 and 320×800 in
  `popcorn`. The four silhouettes and widest active gestures stayed inside the
  set; the edge colors remained clean on dark and warm/light backgrounds; and
  document scroll width equaled viewport width.
- Performer-blocking browser inspection covered active motion at 1280×900,
  390×844, and 320×800, plus reduced motion at 320×800. Camera-to-actor versus
  actor-to-actress center gaps were 130/90px, 74.5/58.3px, and 58.4/45.7px,
  respectively. The actors faced one another, their widest gestures met without
  merging body silhouettes, reduced motion stayed still, and no viewport
  developed horizontal overflow.
- The user-provided screenshot is the before-state evidence; the inspected live
  route is the after-state evidence. No screenshot baseline was committed because
  the repository's visual policy defers broad snapshots until fixtures and
  rendering are standardized.
- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope web` — passed, including agent lint,
  workflow-policy tests, migration tests/validation, and web typecheck.

## Independent reviews

- Research checkpoint: completed. The reviewer identified the gray bar as the
  CSS-drawn `worktable`, not the real progress track, and recommended one
  low-contrast set plate behind all actors.
- Plan checkpoint: approved with refinements for explicit layer ordering,
  mobile-safe cropping, a recognizable non-pill dolly rail, theme checks, and
  retaining the existing compact asset ceiling.
- Cast-update research and plan checkpoint: approved the left-to-right director,
  camera, actor, actress blocking and required matching 423×141 strips,
  bottom-center normalization, staggered motion, and 320px/390px inspection.
- Backdrop implementation checkpoint: approved. The reviewer verified asset composition,
  explicit layer order, center-safe mobile cropping, cross-theme treatment,
  decorative accessibility, PNG validation, the 482,024-byte aggregate, and
  documentation accuracy with no product-code blocker.
- Backdrop wrap-up checkpoint: approved after verifying the exact eight-file scope,
  asset dimensions and bytes, test/documentation consistency, complete
  validation evidence, clean diff, worksheet, and feedback record.
- Cast implementation checkpoint: initially blocked on residual opaque magenta
  edge pixels and an actress gesture clipped inside the 320px scene. Both were
  corrected with explicit edge decontamination, inward anchors through 390px,
  and a smaller scale below 360px; re-review approved both fixes.
- Cast wrap-up checkpoint: approved after verifying the final responsive CSS,
  exact sprite geometry and 454,365-byte payload, 33/33 full and 1/1 focused
  Playwright results, scoped validation, documentation, and 13-path change set.
- Performer-blocking research and plan checkpoint: approved the deterministic
  actress mirror and tighter anchors, with active/reduced-motion inspection
  required at 1280px, 390px, and 320px before handoff.
- Route-loading research and plan checkpoint: approved a narrow shared wrapper
  around the exact crew scene for route-level initial loads, with existing
  content geometry retained as hidden layout reservation and compact/background
  loading indicators explicitly excluded.
- Route-loading implementation checkpoint: initially blocked because retained
  skeletons were visibly stacked below the crew and because the main Home load
  was omitted. The centralized wrapper now places optional reservation content
  invisibly in the same grid area, and Home now uses the shared state. Run
  Progress remains a deliberate exception because its pending recovery screen
  preserves a stored-run hint and an immediate project escape link, then hands
  off to the crew-based production view when the run payload arrives.
- Performer-blocking implementation checkpoint: approved after verifying the
  actress-only mirror scope, background-position and reduced-motion behavior,
  tighter three-width geometry, intermittent hand contact, relational E2E
  assertions, and unchanged artwork payload.
- Performer-blocking wrap-up checkpoint: approved after verifying the exact
  five-file scope, three-width active and reduced-motion evidence, typecheck,
  focused 2/2 and full 33/33 Playwright results, lint, scoped validation, and
  clean diff.
- Route-loading wrap-up checkpoint: approved after replacing visible stacked
  skeletons with hidden same-grid reservation, suppressing reservation shimmer
  animations and transitions, adding Home, preserving the specialized Run
  Progress recovery opener, verifying page and panel variants, and completing
  targeted plus scoped validation across the current 20-file continuation.

## Blockers and risks

- The central dolly rail could repeat the scrollbar ambiguity if cropping hides
  its wheels and hard ends; inspect it in the live route at desktop and mobile.
- An opaque dark plate could feel muddy in the warm theme; inspect both default
  dark and warm themes and tune the token-derived wash if necessary.
- The loader artwork now uses about 87% of its 512 KiB ceiling. A future artwork
  addition should replace or further optimize an asset rather than loosen the
  budget by default.

## Next action / handoff

Commit the route-loading continuation, retarget
`worksheet/WEB-20260801-CREW-SET`, push it to the existing open pull request
#870, and leave the local Library preview available for review.
