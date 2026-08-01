# Worksheet: WEB-20260801-ASSET-PROGRESS

<!-- agent-summary: Redesign the standalone asset creation progress state. -->
<!-- agent-summary: Reuse the repository's pixel-art studio crew as loading imagery. -->
<!-- agent-summary: Keep generation status legible and avoid exposing a wall of prompt text. -->
<!-- agent-summary: Preserve complete, blocked, question, loading, and error behavior. -->
<!-- agent-summary: Validate the production route at desktop and mobile widths. -->
<!-- agent-summary: Add behavior-focused Playwright coverage for the redesigned state. -->
<!-- agent-summary: Commit the implementation, documentation, worksheet, and feedback together. -->

## Goal and acceptance criteria

Improve the `/create?projectId=…&runId=…` progress state so it feels like an
active creative studio rather than a raw status dump. The shipped UI should use
existing sprite assets as purposeful loading imagery, present a human-readable
status, truncate the generation brief with an accessible expansion path, retain
terminal outcome behavior, and adapt cleanly to desktop and mobile.

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

- Reuse the checked-in writer, camera operator, and workshop-worker sprite
  sheets rather than introducing new media or generic spinners.
- Keep the progress surface observe-first: status and next-step guidance lead;
  the full input brief is progressively disclosed.
- Use CSS Modules and existing semantic theme tokens only.
- Derive copy from both run status and report outcome; only queued, running, and
  waiting are active, and unknown states remain neutral and static.
- Render a bounded excerpt in the closed disclosure and keep the full brief only
  inside the native `details` body so truncation is semantic, not only visual.

## Changes

- Added a route-owned `StudioCrewLoader` that animates working poses from the
  checked-in writer, camera operator, and workshop-worker sprite sheets.
- Reworked the creation status surface around human-readable, report-aware run
  presentations for active and terminal states.
- Replaced the raw prompt wall with a bounded excerpt and native full-brief
  disclosure, and replaced the generic loading slab with a layout-mirroring
  skeleton.
- Added responsive, reduced-motion, focus, and cross-theme styling using only
  semantic tokens.
- Extended Asset Studio Playwright coverage and updated both E2E inventories.

## Validation evidence

- `pnpm --filter @popcorn/web typecheck` — passed.
- `VITE_API_URL=http://127.0.0.1:4192 PLAYWRIGHT_WEB_PORT=3192
  POPCORN_E2E_API_PORT=4192 pnpm --filter @popcorn/web exec playwright test
  e2e/asset-studio.spec.ts` — 16 passed after all review fixes.
- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope web` — passed, including agent lint, workflow
  policy tests, migration tests/validation, and web typecheck.
- In-app browser inspection against a deterministic local API fixture:
  1280×900 `popcorn`, 390×844 `popcorn`, and 1280×900 `popcorn-warm`; no
  horizontal overflow at either viewport, sprite crops remained transparent,
  and the brief/status hierarchy stayed legible.
- The task began from the user-provided screenshot as before-state evidence.
  No visual snapshot was added because the repository currently has no baseline
  suite and the visual policy warns against introducing broad snapshots before
  fixtures and rendering are standardized; the behavior-focused fixture and
  manual browser captures provide scoped evidence instead.

## Independent reviews

- Research checkpoint: completed by independent subagent. It identified the
  misleading always-active header/fallback, confirmed the sprite crop geometry,
  and recommended truthful terminal-state handling plus route-local E2E coverage.
- Plan checkpoint: approved by the same independent reviewer with refinements
  for semantic brief truncation, report-outcome precedence, static reduced-motion
  artwork, optional summaries, and terminal-state tests.
- Implementation checkpoint: completed. The reviewer found three P2/P3 issues:
  terminal screens retained working poses, completed copy exposed “immutable
  output,” and the question outcome lacked coverage. All were resolved with idle
  terminal frames, creator-facing asset copy, and question/omitted-summary tests.
- Wrap-up checkpoint: implementation approved. The reviewer caught and we
  removed a stale completed-status gap in the E2E inventory. The reviewer also
  requested a shared `LOG.md` append based on the older system doc; this was not
  applied because `.agent/feedback/README.md` explicitly says routine tasks own
  a task-scoped record and must not edit the historical shared log. This task's
  required entry is `.agent/feedback/WEB-20260801-ASSET-PROGRESS.md`.
  The reviewer rechecked the directory-specific contract, agreed that the
  standalone record is authoritative, and gave final approval with no remaining
  code, test, documentation, or workflow blocker.

## Blockers and risks

- The route polls live run state, so tests must use browser API fixtures and
  must not spend provider credits.
- One custom-port E2E attempt waited on the `e2e.env`-pinned API URL; the final
  run explicitly aligned `VITE_API_URL` with the custom API port and passed.

## Next action / handoff

Commit, tag, push, and open the required ready PR.
