# Worksheet: WEB-20260801-CREW-SET

<!-- agent-summary: Ground the standalone creation loader crew in a production-set scene. -->
<!-- agent-summary: Replace the ambiguous CSS worktable that resembles a scrollbar. -->
<!-- agent-summary: Use one compact pixel-art backdrop behind the existing crew sprites. -->
<!-- agent-summary: Preserve status truthfulness, reduced motion, and cross-theme legibility. -->
<!-- agent-summary: Keep the complete loader image payload under its existing budget. -->
<!-- agent-summary: Validate the production route at desktop and mobile widths. -->
<!-- agent-summary: Commit implementation, tests, documentation, worksheet, and feedback together. -->

## Goal and acceptance criteria

Make the standalone asset-creation loader read as a small working production
set rather than three isolated sprites. Remove the gray CSS-drawn worktable that
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

## Decisions

- Remove the misleading CSS `worktable`; the actual progress track in the
  status column remains unchanged and visible only during active work.
- Use a generated 2:1 pixel-art soundstage plate with no people, text, logos, or
  UI. Keep the center quiet and ground the writer, camera operator, and worker
  on one continuous floor plane.
- Resize the generated plate to 640×320 PNG so all four loader assets remain
  below the existing 512 KiB aggregate ceiling.
- Keep the artwork decorative under the loader's existing `aria-hidden` boundary.
- Preserve explicit z-index tiers for the backdrop, light wash, and actors; let
  the plate's continuous floor replace the redundant solid foreground strip.

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

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `VITE_API_URL=http://127.0.0.1:4212 PLAYWRIGHT_WEB_PORT=3212
  POPCORN_E2E_API_PORT=4212 pnpm --filter @popcorn/web exec playwright test
  e2e/asset-studio.spec.ts` — passed, 33/33 across Chromium plus the tagged
  mobile Chrome and mobile Safari cases.
- The four loader images total 482,024 bytes, below the existing 512 KiB ceiling.
- In-app browser inspection against a deterministic local run fixture:
  1280×900 in `popcorn` and `popcorn-warm`, plus 390×844 in `popcorn-warm`.
  The backdrop, rigging, workbench, and dolly remained recognizable; the sprites
  stayed visually dominant; and document scroll width equaled viewport width.
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
- Implementation checkpoint: approved. The reviewer verified asset composition,
  explicit layer order, center-safe mobile cropping, cross-theme treatment,
  decorative accessibility, PNG validation, the 482,024-byte aggregate, and
  documentation accuracy with no product-code blocker.
- Wrap-up checkpoint: approved after verifying the exact eight-file scope,
  asset dimensions and bytes, test/documentation consistency, complete
  validation evidence, clean diff, worksheet, and feedback record.

## Blockers and risks

- The central dolly rail could repeat the scrollbar ambiguity if cropping hides
  its wheels and hard ends; inspect it in the live route at desktop and mobile.
- An opaque dark plate could feel muddy in the warm theme; inspect both default
  dark and warm themes and tune the token-derived wash if necessary.
- The loader artwork now uses about 92% of its 512 KiB ceiling. A future artwork
  addition should replace or further optimize an asset rather than loosen the
  budget by default.

## Next action / handoff

Commit the implementation, tag the worksheet, push the branch, and open the
required ready-for-review pull request.
