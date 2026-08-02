# Worksheet: WEB-20260802-CREATE-LAUNCHER

<!-- agent-summary: First implementation slice from the production UX audit creation finding. -->
<!-- agent-summary: The canonical Create route becomes an intent launcher for full videos and project assets. -->
<!-- agent-summary: Existing full-video and asset creation engines remain separate behind the launcher. -->
<!-- agent-summary: Full video is the dominant creator path; project assets remain directly available. -->
<!-- agent-summary: Desktop and mobile navigation, browser behavior, and Playwright coverage must agree. -->
<!-- agent-summary: Update the E2E inventory and feedback log with the implementation. -->
<!-- agent-summary: Use worksheet/WEB-20260802-CREATE-LAUNCHER as the completion tag. -->

## Goal and acceptance criteria

Implement the first bounded refactor from PR #864's creation P1. Make `/create`
an intent-first launcher that asks what the creator wants to make, gives full
video the dominant action, and routes project-asset work into the existing Asset
Studio without changing either creation engine.

Acceptance criteria:

- Existing shell, Dashboard, Activity, and Library Create actions land on one
  `/create` launcher.
- The launcher routes full-video intent to `/projects/new` and project-asset
  intent to the existing asset flow at `/create/asset`.
- Asset review revision/back paths return to `/create/asset` without losing
  their existing route-state contract.
- Desktop and mobile navigation expose truthful active state.
- Focused Playwright tests prove routing, hierarchy, keyboard-accessible links,
  and mobile overflow behavior without provider spend.
- The local web application is inspected at desktop and 390-by-844 mobile widths.

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
- `docs/agent-system/performance-and-visual-regression.md`
- Impeccable product-register instructions

## Decisions

- Preserve `/projects/new` and the existing Asset Studio implementation; this
  slice unifies discovery and naming, not generation internals.
- Use a new co-located CSS Module and existing tokens/components.
- Keep one gold CTA on the launcher: Full video.
- Keep generic Create actions on the launcher and rewrite their copy to cover
  both intents. Existing explicitly full-video actions remain direct links.
- Treat `/create`, `/create/asset`, `/create/review`, and `/projects/new` as one
  Create navigation context; ordinary project routes remain under Library.
- Redirect asset-shaped legacy `/create` query links to `/create/asset` with the
  full search string and route state preserved.
- Treat validated legacy `assetCreationDraft` history state as asset-shaped too,
  so an in-progress draft survives deployment and Back/reload.
- Normalize trailing slashes before deciding Create/Library ownership or
  constructing breadcrumbs.

## Changes

- Added the intent-first launcher and co-located CSS Module.
- Moved the existing Asset Studio route to `/create/asset` without changing its
  query, project, proposal, or API behavior.
- Updated asset review destinations, Create/Library active state, creation
  breadcrumbs, generic creation copy, and focused unit/browser tests.
- Preserved legacy status-query and validated draft-history entry points and
  canonicalized trailing-slash navigation classification.

## Validation evidence

- `pnpm --filter @popcorn/web test`: 57 passing unit tests.
- `pnpm --filter @popcorn/web typecheck`: passed.
- `asset-studio.spec.ts --project=chromium`: 30 passing focused browser tests.
- `creation-entry-points.spec.ts --project=chromium`: 4 passing focused browser tests,
  including legacy query/draft compatibility and mobile overflow.
- Asset Studio + creation entry points on the two mobile Playwright projects: 8 passing tests.
- Impeccable detector over changed TSX files: no findings.
- Manual local browser pass: desktop and 390-by-844 launcher hierarchy inspected;
  one H1, semantic links, 48px mobile actions, and no horizontal overflow.
- `pnpm agent:lint:fix`: passed for 23 changed files.
- `pnpm agent:validate -- --scope web`: passed, including agent lint, workflow
  policy tests, migration checks, and web typecheck.
- `git diff --check`: passed.

## Independent reviews

- Research: `/root/implementation_review` confirmed the UI-only boundary,
  identified legacy status-link compatibility, separated generic from explicit
  intents, and enumerated the route-specific documentation/test contract.
- Plan: `/root/plan_review` found the slice bounded and reversible, required
  truthful Create ownership through `/projects/new`, creation breadcrumbs,
  semantic link/heading structure, mobile overflow proof, and full lifecycle
  retargeting to `/create/asset`; the implementation follows those corrections.
- Implementation: `/root/wrapup_review` found two compatibility defects: legacy
  draft history could be stranded at the launcher and `/projects/new/` could be
  misclassified under Library. Both were accepted, fixed, and covered by focused
  browser/unit regressions; the reviewer found no other issues.
- Wrap-up: `/root/implementation_review` found no remaining product-code, test,
  feedback, or documentation issues. Its worksheet-only finding was accepted:
  this evidence, disposition, risk, and handoff state now reflect the completed
  implementation.

## Blockers and risks

- No blocker remains. The main compatibility risks were legacy asset query links,
  validated draft history, and trailing-slash classification; each now has
  focused regression coverage.

## Next action / handoff

Commit and tag the validated slice, push the branch, and open the required
ready-for-review PR.
