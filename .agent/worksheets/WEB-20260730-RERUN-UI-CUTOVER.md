# Worksheet: WEB-20260730-RERUN-UI-CUTOVER

<!-- agent-summary: Durable record for moving every Request Changes UI onto RerunProposal.v2. -->
<!-- agent-summary: Creator edits preview scope, preserved work, risk, and cost before approval. -->
<!-- agent-summary: Approval and execution remain separate explicit user actions. -->
<!-- agent-summary: TanStack Query owns proposal lifecycle server state and reload recovery. -->
<!-- agent-summary: Legacy provider/model choices are removed from Request Changes callers. -->
<!-- agent-summary: Mock-backed browser coverage proves desktop, mobile, stale, and recovery states. -->
<!-- agent-summary: Link implementation reviews, validation evidence, feedback, and the final PR here. -->

## Goal and acceptance criteria

Replace every web Request Changes caller with the durable proposal lifecycle:
create, preview, clarify or refresh, approve or reject, execute, monitor, and
cancel. Recover an in-flight proposal after reload, keep one calm approval
boundary, and publish a ready stacked PR with browser and targeted coverage.

## Context and source-of-truth documents

`AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`,
`docs/repository-structure.md`, `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`,
`docs/ui-interaction-model.md`,
`docs/scopes/selective-regeneration-cutover-pr-plan.md`,
`docs/testing/e2e-test-inventory-and-gaps.md`, and `apps/web/e2e/README.md`.

## Decisions

- Use the Impeccable UI workflow: observe-first proposal review, restrained
  hierarchy, one gold primary action, full keyboard semantics, and responsive
  CSS Modules.
- Server-own generation providers and models; the UI submits intent and exact
  graph targets only.
- Persist the proposal action identity per project/target and read durable
  lifecycle state after reload instead of treating a local mutation as truth.
- Keep proposal approval separate from execution so cost permission is visible
  and deliberate.

## Changes

- Added an authenticated durable lifecycle read endpoint and shared lifecycle
  view so a proposal survives reload with approval, reservation, execution, and
  sanitized failure state.
- Added centralized TanStack Query hooks and exact
  `BoardRevisionTarget`-to-graph-target conversion that fails closed when an
  opaque UI item has no stable graph identity.
- Added the responsive, accessible proposal dialog covering compose, preview,
  clarification/refresh, approve, reject, execute, waiting/running, cancel,
  applied, and failure states. Refresh and execution idempotency keys persist
  across retries.
- Migrated project, project-step, storyboard, generated-asset, run-review, and
  Studio review callers. Removed restart-stage controls, direct review
  rejection, timeline revision calls, and creator-facing provider/model choice.
- Review checkpoints resolve only stable document, storyboard, asset, beat, or
  timeline-asset identities. Ambiguous checkpoints retain a disabled affordance
  with guidance to open a specific object; they never masquerade as a
  project-wide concept request.
- Updated legacy browser assertions to require proposal previews and added a
  dedicated lifecycle/reload/mobile Playwright suite.

## Validation evidence

- `pnpm --dir apps/web typecheck` — passed after the final Studio migration.
- `pnpm exec playwright test e2e/run-progress-actions.spec.ts
  e2e/storyboard-editor.spec.ts --project=chromium` — 11/11 passed after
  updating retired-path assertions. The immediately preceding combined run
  passed the other 18 targeted Chromium cases.
- `pnpm exec playwright test e2e/rerun-proposal-lifecycle.spec.ts
  --project=chromium` — 2/2 desktop cases passed, including
  clarification-plus-stale-refresh; the mobile-tagged case was correctly
  skipped for desktop.
- `pnpm exec playwright test e2e/rerun-proposal-lifecycle.spec.ts
  --project=mobile-chrome` — 1/1 mobile case passed.
- Web unit tests passed 36/36. API lifecycle/route tests passed 22/22. API, web,
  and shared type checks passed.
- After the final exact-target review fixes, web typecheck, 39/39 web unit
  tests, and 16/16 affected run-progress browser cases passed.
- `pnpm agent:validate` — full repository validation passed.
- Visual QA inspected the desktop proposal preview at
  `/tmp/popcorn-rerun-proposal-preview.png`; the layout retains one gold
  approval action, legible preserved/affected summaries, and no overflow.

## Independent reviews

- Initial implementation review found waiting-state polling, persistent
  idempotency, reload cleanup, hook ordering, exact-target, mutation-error,
  focus, and remaining-caller gaps. Those findings were applied; final
  independent re-review then caught broadened checkpoint targets and a missing
  stage-panel affordance. The fixes now use stable document/graph identities,
  the exact project `cut` selection for whole-cut feedback, and fail-closed
  disabled guidance for unresolved surfaces.
- Final independent re-review: approved with no remaining blockers.

## Blockers and risks

- This PR will be stacked on PR 5; PR 5 activates the production executors that
  make approved UI proposals operational.
- Provider-spend smoke is intentionally excluded; UI and API behavior use
  provider-neutral fixtures.

## Next action / handoff

- Finish the validation matrix and independent re-review, then stack on PR 5,
  commit, push, and open the ready PR.
