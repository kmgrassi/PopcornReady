# Worksheet: WEBAPI-20260805-SCRIPT-FIRST

<!-- agent-summary: Durable record for the script-first full-video creation flow. -->
<!-- agent-summary: Users may enter an idea or provide a script as the starting source. -->
<!-- agent-summary: Every initial full-video run pauses on its script before media generation. -->
<!-- agent-summary: Script review and refinement reuse the object-scoped Request Changes lifecycle. -->
<!-- agent-summary: Poster, storyboard, image, audio, and video work must wait for script approval. -->
<!-- agent-summary: Browser and API behavior receive targeted automated and manual validation. -->
<!-- agent-summary: This worksheet ships with its matching feedback entry and ready PR. -->

## Goal and acceptance criteria

- Let a creator start a full video from either an idea or an existing script.
- Generate/persist a first-class script draft for idea starts and preserve supplied script text for script starts.
- Pause every initial full-video run at a script review boundary.
- Allow script refinement through the existing agent-driven Request Changes flow.
- Do not start poster or downstream media generation until the script boundary is approved.
- Keep draft restore, desktop/mobile layout, and the existing storyboard review boundary working.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/NORTH_STAR.md`, `docs/ui-interaction-model.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`

## Decisions

- Use the existing relational `script_drafts` plus immutable
  `narration_script` graph asset as the authoritative script; do not introduce a
  JSONB or parallel draft surface.
- Add server-owned `after:draft_script` and `after:generate_storyboard` gates to
  every full-video root run. While the script gate is unresolved, filter the
  root registry to brief, story-blueprint, and script tools only.
- Preserve a supplied script exactly as the first draft. For a requested
  revision, the model supplies a complete replacement to `draft_script`, which
  persists a superseding draft instead of annotating the original.
- Use a direct script-gate reject action for text-only refinement. Broader
  object-scoped media revisions continue to use the cost-preview proposal flow.
- Defer automatic poster generation until script approval and remove eager
  poster starts from project, brief, prompt, upload, and storyboard entrypoints.

## Changes

- Added idea/script intake, validation, local/server draft persistence, and
  supplied-script mapping into `VideoBriefInput.narration`.
- Added a Script generation stage, active-script read API/query, authoritative
  script review UI, approve/reject actions, and approved-draft persistence.
- Added a pre-approval tool-registry fence, early-done guard, superseding script
  revisions, and sequential script/storyboard after-gate continuation.
- Updated the project Script route to prefer the active relational draft.
- Updated North Star, interaction, API, and E2E contracts.
- PR review follow-up marks direct script feedback with the established
  `board_revision_request.v1` envelope, projects every gate in storyboard
  entrypoint status, reuses a succeeded root paused at script review, and links
  Project Detail back to that review instead of offering duplicate creation.

## Validation evidence

- `pnpm typecheck` — pass.
- `pnpm agent:lint:fix` — pass across 52 changed files.
- `pnpm agent:validate -- --scope all` — pass, including workflow policy,
  migration/RPC/relation boundaries, and web/API typechecks.
- Targeted API tests cover exact script preservation/revision, phase fencing,
  sequential gates, atomic decisions, readiness, and project-media guards.
- Playwright full incidental run — 166 pass, 6 skip; the two new tests exposed
  only stale test locators, which were corrected.
- Targeted Playwright intake — 2 pass in desktop Chromium and mobile Chrome.
  Script revision/fail-closed review — 4 pass in the same projects.
- PR review regressions — 42 focused API tests pass; Project Detail script-review
  behavior passes in desktop Chromium and mobile Chrome.
- `pnpm db:migrations:validate`, migration tests, RPC-boundary validation, and
  relation-boundary validation — pass. Local Supabase status completed without
  a configured service to exercise the concurrency integration path.
- Manually exercised the locally running `/projects/new` entry point at
  1440×1000 and 412×915. With only the unavailable persistence calls stubbed,
  selected “A script,” entered creator copy, and visually verified the script
  field, approval-boundary copy, sticky continuation action, and no mobile
  horizontal overflow. A raw unmocked load also confirmed the local API lacks
  configured Supabase persistence.
- Manually inspected the corrected Project Detail script-review state at
  1440×1000 and 412×915: **Review script** links to the existing run, **Create
  storyboard** is absent, no generation banner appears, and the mobile layout
  has no horizontal overflow.

## Independent reviews

- Research review requested from `/root/research_review`.
- Plan review from `/root/plan_review` found the need for a model-visible phase
  fence, exhaustive eager-poster removal, exact script revision semantics,
  persistent approval status, and multi-gate continuation; each is represented
  in the implementation.
- Implementation review from `/root/plan_review` found an unlocked project
  pointer, legacy storyboard media entrypoints, fail-open approval UI, and a
  stale script-query path. The transaction now locks the project row; all
  storyboard image routes share the approved-script guard; approval fails
  closed; rejection evicts the stale script query.
- Wrap-up review from `/root/plan_review` found no release-blocking issues after
  the authorization-order and fail-closed test fixes.
- PR comment research confirmed both review threads and the adjacent duplicate
  root risk; plan review required full-gate projection plus backend reuse and an
  actionable Project Detail review link.
- Implementation and wrap-up re-reviews found no remaining release blockers;
  final `pnpm agent:validate -- --scope all` passed.

## Blockers and risks

- The local API has no configured Supabase persistence, so transaction
  concurrency is covered by deterministic unit/CAS tests rather than a live
  database race in this worktree.

## Next action / handoff

- Validate, commit, and push the PR review fixes; leave GitHub thread replies and
  resolution to an explicitly authorized follow-up.
