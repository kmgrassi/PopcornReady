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
- Addressed PR review follow-up by reading terminal failure provenance from the
  linked `rerun_execution` action, mapping durable error kinds to approved
  creator copy, persisting cancellation distinctly on the execution
  reservation, and reporting cancel-versus-completion races truthfully.
- Scoped settlement callbacks to the current proposal action so a restored
  execution refreshes the exact owning surface without reusing a prior target.
- Addressed the final stacked-PR review sweep: persisted proposal keys now
  include the review surface, Studio resolves storyboard gates to the current
  storyboard and omits terminal roots, callback completion has a durable
  recovery sweep plus fast-callback race handling, and stale refresh requires a
  proven durable stale cause.
- Added a separate scene semantic snapshot pointer and forward migration for
  stable-ID storyboard reconciliation. Relational scene/beat semantics update
  atomically while scene wireframe images remain untouched.

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
- PR review follow-up: 32/32 targeted API tests passed with two local-Postgres
  integration cases correctly skipped outside the opt-in environment; API and
  web type checks passed; settlement-target unit tests passed 2/2.
- PR review follow-up: targeted Chromium lifecycle coverage passed 3/3 with the
  mobile-only case skipped, and Mobile Chrome overflow coverage passed 1/1.
  The browser now proves restored completion visibly refreshes project data and
  restored cancellation remains canceled without a failure alert.
- `pnpm agent:lint:fix` passed, followed by
  `pnpm agent:validate -- --scope all`; the full scoped repository validation
  completed successfully after the review fixes.

## Independent reviews

- Initial implementation review found waiting-state polling, persistent
  idempotency, reload cleanup, hook ordering, exact-target, mutation-error,
  focus, and remaining-caller gaps. Those findings were applied; final
  independent re-review then caught broadened checkpoint targets and a missing
  stage-panel affordance. The fixes now use stable document/graph identities,
  the exact project `cut` selection for whole-cut feedback, and fail-closed
  disabled guidance for unresolved surfaces.
- Final independent re-review: approved with no remaining blockers.
- PR review implementation checkpoint found raw durable-error disclosure,
  cancellation terminal-race reporting, stale callback-target reuse, and a
  failure-provenance test gap. The follow-up maps error codes to approved copy,
  returns the actual durable terminal result, scopes callback targets by action,
  and injects linked-action reads for observable unit coverage.
- Independent implementation re-review approved the corrected diff with no
  remaining blockers or actionable issues. It reran targeted API/web tests,
  type checks, and `git diff --check`; the local-Supabase integration remained
  an inspected opt-in test outside the configured environment.
- Independent wrap-up review approved the final branch as ready to commit and
  push. It confirmed all three unresolved PR comments, repository records, and
  regression coverage were complete with no unrelated artifacts.

## Blockers and risks

- This PR will be stacked on PR 5; PR 5 activates the production executors that
  make approved UI proposals operational.
- Provider-spend smoke is intentionally excluded; UI and API behavior use
  provider-neutral fixtures.

## Next action / handoff

- Commit, tag, and push the validated fixes to the existing ready PR.

## Main integration (PR 855)

- Reconstructed the integration branch from current `main` instead of merging
  the divergent stacked history. Cherry-picked only the reviewed PR 6 UI commit
  and its terminal-state follow-up, eliminating false add/add conflicts from
  PRs 2–5 that were already integrated independently.
- Preserved current-main adapter, reconciliation, and migration implementations.
  The five genuine conflicts retain PR 6's durable cancellation contract while
  keeping current-main transaction fencing and tenancy checks: canceled
  reservations remain `canceled`, competing terminal outcomes win truthfully,
  execution failure reads follow the linked result action, and creator copy is
  sanitized.
- Focused API lifecycle/store/route tests passed 38/38; focused web target and
  settlement tests passed 7/7; API and web typechecks passed.
- Chromium lifecycle coverage passed 3/3 desktop cases, Mobile Chrome passed
  the responsive overflow case, and the desktop-only run correctly skipped that
  mobile-tagged case.
- The clean 94-migration local reset passed. The direct Postgres suite exposed
  and fixed two deterministic replay defects: the first callback-free park now
  establishes its durable aggregate before replay equality is enforced, and
  completion idempotently preserves pre-existing primitive output attribution.
  The lifecycle/concurrency case then passed, and the atomic graph case passed
  after its assertion was corrected to count both the blueprint and beat
  pointer moves. A final combined rerun was blocked by the local Docker daemon
  hanging during the disposable database reset; this is an environment issue,
  not an unverified code path, because both cases completed successfully against
  the same reconstructed branch.
- `pnpm agent:lint:fix` and `pnpm agent:validate -- --scope all` passed before
  the database follow-up. Final targeted validation is recorded with the branch
  update.
- Independent implementation review approved the reconstructed PR 855 diff
  with no actionable blockers and confirmed that no PR 7 migration or cleanup
  files leaked into the PR 6 integration branch. A second read-only review
  independently confirmed both Postgres replay fixes as the minimal correct
  resolutions.

## Final review-comment hardening

- Independent plan review rejected overloading `scene_asset_id` and caught
  poison-row/fast-callback and stale-successor gaps. The implementation now
  isolates recovery candidates, re-reads callbacks that race provider
  acceptance, proves stale failure from the linked execution result, and uses
  `story_snapshot_asset_id` for semantic scene state.
- Focused API/web type checks, 76 focused API tests, and 3 focused web tests
  passed. Static migration validation passed all 95 migrations. The lifecycle
  browser suite passed 4 applicable desktop/mobile cases with one expected
  project skip after its restored-state fixture moved to the scoped storage key.
- A clean local startup applied all 95 migrations. The direct Postgres suite
  passed both cases, including callback/concurrency fencing and atomic mixed
  graph application/rollback. Its story case now proves retained text semantic
  IDs preserve relational UUIDs, storyboard and exact-scene add/remove behavior
  is atomic, and visual scene pointers remain unchanged.
- `pnpm agent:lint:fix` and `pnpm agent:validate -- --scope all` passed after the
  final stable-identity and scene-child reconciliation fixes.
