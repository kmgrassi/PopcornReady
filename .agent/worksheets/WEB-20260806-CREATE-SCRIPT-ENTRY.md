# Worksheet: WEB-20260806-CREATE-SCRIPT-ENTRY

<!-- agent-summary: Add a Script choice to the authenticated Create workspace. -->
<!-- agent-summary: Script creation remains owned by the Creative Director, not Visuals or Audio. -->
<!-- agent-summary: The Create workspace hands script intent into the existing script-first project flow. -->
<!-- agent-summary: Seeded script intent must survive navigation without placing creator text in the URL. -->
<!-- agent-summary: Existing Image, Video, and Audio proposal behavior remains unchanged. -->
<!-- agent-summary: Desktop and mobile browser coverage proves the handoff and responsive layout. -->
<!-- agent-summary: Documentation and feedback ship with the implementation and ready PR. -->

## Goal and acceptance criteria

- Add Script as a visible choice in the `/create/asset` Create workspace.
- Let a creator describe the script they want and continue into the existing
  Creative Director script-first flow with that intent already filled in.
- Keep script work out of the creator-direct Visuals/Audio media contract.
- Do not place the creator's script prompt in query parameters or browser history.
- Preserve Image, Video, and Audio draft/review/status behavior.
- Verify the changed route at desktop and mobile widths with focused Playwright coverage.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`, `docs/NORTH_STAR.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`
- `docs/ui-interaction-model.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`
- Impeccable product-register instructions

## Research

- The current standalone creation contract maps only Image/Video to Visuals and
  Soundtrack/Audio to Audio. Script is a Creative Director tool output persisted
  as a relational `script_drafts` row plus immutable `narration_script` asset.
- Treating Script as a fourth media kind would require a false domain mapping and
  conflict with the existing script-first review boundary.
- The existing `/projects/new` flow already accepts an idea, writes a script,
  persists it durably, and pauses at mandatory Script review before media work.

## Decisions

- Present Script as a fourth creator outcome in the Create workspace while
  keeping the creator-direct media API limited to Visuals/Audio tasks.
- Start a new Creative Director project for Script; never replace an existing
  project's active script from initial-creation UI.
- Use a versioned, fail-closed React Router state envelope capped at 4,000
  characters. Reconstruct only `startSource: "idea"` and a trimmed `goal`.
- Hide recent-project and project-picker UI for Script, and restore it when the
  creator returns to Image, Video, or Audio.
- Reuse `/projects/new` and its mandatory script review gate. The handoff opens
  the brief without auto-starting project creation or generation.

## Changes

- Added Script selection, script-specific copy/icon/context, and a responsive
  four-choice layout to the existing Create workspace.
- Made Script discoverable from the global `/create` launcher and aligned the
  workspace breadcrumb with its combined asset-or-script purpose.
- Added validated, URL-private script handoff state and seeded the existing
  Creative Director brief without expanding `CreationGoal` or agent-creation
  task contracts.
- Guarded Studio draft completion so a delayed success or failure cannot
  navigate after the creator leaves the handoff destination.
- Added unit and desktop/mobile browser coverage plus owning documentation and
  feedback updates.

## Validation evidence

- `pnpm --filter @popcorn/web test` — 90 passing unit tests, including strict
  script-handoff validation.
- `pnpm --filter @popcorn/web typecheck` — pass.
- `creation-entry-points.spec.ts --project=chromium` — 10 passing browser tests,
  including successful durable handoff, failed-persistence fallback, distinct
  media/script prompt restoration, late-response cancellation, keyboard
  reachability, and mobile overflow.
- Expanded `creation-entry-points`, `asset-studio-review`, and
  `asset-studio-projects` Chromium run — 38 passing tests after updating shared
  target-count coverage for the fourth creation type and stale launcher labels.
- Focused API `orchestrator-runs.test.ts` — 39 passing tests, including the
  server-owned rule that every initial run stops for Script review before
  Storyboard review.
- Impeccable detector over the changed TSX/CSS surface — no findings.
- `pnpm agent:lint:fix` — pass across 12 changed files.
- `pnpm agent:validate -- --scope web` — pass, including workflow policy,
  migration validation, agent lint, and web typecheck.
- `git diff --check` — pass.
- Manual local browser pass at 1440×1000: selected Script from the actual
  `/create/asset` entry, inspected the four-choice rail and script-specific
  context, entered a story prompt, and confirmed `/projects/new?start=1`
  retained the exact idea when the unconfigured local API rejected draft
  persistence. No horizontal overflow was present.
- Manual local browser pass at 390×844: inspected all four creation choices,
  Script selected state, text-first/new-project explanation, prompt field, and
  CTA. The document stayed exactly 390 CSS pixels wide with no horizontal
  overflow.
- PR feedback browser pass at 1440×1000 and 390×844: opened the actual global
  `/create` entry, confirmed **Asset or script** and its new-project Script copy
  are visible, followed the CTA to Script at desktop width, and measured no
  horizontal overflow at either viewport.

## Independent reviews

- Research review from `/root/research_review` confirmed Script is authoritative
  Creative Director structure, not a pooled Visuals/Audio media task, and
  recommended a new-project handoff to the existing script gate.
- Plan review from `/root/plan_review` approved the bounded handoff with strict
  state validation, truthful copy, no auto-start, hidden project UI, and
  desktop/mobile regression requirements; the implementation follows them.
- Implementation review from `/root/plan_review` found shared media/script
  prompt state and success-path test coverage gaps. Separate prompt state plus
  normal and fallback persistence tests resolved both; re-review approved with
  no remaining findings.
- Wrap-up review requested from `/root/research_review`.
- Wrap-up review from `/root/research_review` approved the product and
  architecture but found the no-start browser assertion omitted the real
  `/generation-entrypoints/prompt` route. The request spy now includes every
  `/generation-entrypoints/` POST; the focused browser suite and final
  validation were rerun after that correction.
- Wrap-up re-review approved with no remaining pre-commit blockers after
  verifying the corrected request spy, worksheet evidence, documentation, and
  architecture boundary.
- PR-comment research review from `/root/comment_research_review` confirmed both
  reported issues were actionable, recommended explicit launcher discovery plus
  a Strict Mode-safe mounted guard, and requested an end-to-end delayed-response
  regression. The implementation and 10-test browser suite cover each point.
- PR-comment implementation review found stale broader-suite labels, a weak
  response-settlement barrier, and documentation drift. After those corrections
  and the 38-test run, final wrap-up re-review approved with no findings.

## Blockers and risks

- A script is not a Visuals/Audio media asset. The handoff must make the
  Creative Director ownership legible instead of silently submitting it through
  the asset proposal endpoint.
- The local API is intentionally unconfigured, so the manual run exercised the
  in-memory fallback. Playwright covers both successful durable persistence and
  that fallback deterministically.

## Next action / handoff

- Publish the review-fix commit to the existing ready-for-review PR. Reviewers
  should verify Script discovery from `/create` and the delayed draft-response
  ownership guard.
