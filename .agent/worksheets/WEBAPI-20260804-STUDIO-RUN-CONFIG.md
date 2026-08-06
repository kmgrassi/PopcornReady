# Worksheet: WEBAPI-20260804-STUDIO-RUN-CONFIG

<!-- agent-summary: Remove retired client run-config knobs (seed, captions, review gates) as dead no-ops. -->
<!-- agent-summary: The orchestrator entrypoints read only brief, briefVersionId, assetIds, and provider. -->
<!-- agent-summary: Initial runs always gate after the storyboard as server-owned policy. -->
<!-- agent-summary: BriefDraft, the draft store, the shared wire type, and the API validator drop the fields. -->
<!-- agent-summary: Legacy persisted drafts still parse; retired fields are dropped, not rejected. -->
<!-- agent-summary: Export captions remain a live, honored toggle and are untouched. -->
<!-- agent-summary: Manual checkpoint-testing docs now describe the storyboard boundary, not reviewGates. -->

## Goal and acceptance criteria

Complete the clean break started in PR 887 (which stripped the dead fields from
the run-start request payloads): remove the retired run-config knobs —
`seedKind`/`seedSize` (seed asset), wizard `showCaptions`, and
`reviewGates`/`stopAfter`/`runThrough` — from the studio draft pipeline so no
client state pretends to control behavior the server owns. Acceptance: the
orchestrator generation entrypoints receive only what they read (`brief`,
`briefVersionId`, `assetIds`, `provider`); previously persisted drafts
containing retired fields still restore; the export-step captions toggle (a
live contract) is unchanged; no wizard UI is left bound to removed state.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/NORTH_STAR.md` (agent-orchestrated pipeline; server-owned gates)
- `apps/api/src/routes/v1/orchestrator-runs.ts` (`initialRunStopAfterTools`
  is server-owned policy: every initial run gates after the storyboard and
  client review-gate/stopAfter payloads are deliberately ignored)
- `docs/manual-tests/full-app-inventory.md`,
  `docs/manual-tests/browser-flow-backlog.md`

## Decisions

- Clean break, no compatibility shims (repository policy): retired fields are
  deleted from `BriefDraft`, the draft store, the shared `StudioDraftBrief`
  wire type, and the API draft validator.
- Legacy tolerance is read-side only: old persisted drafts and API payloads
  containing retired fields parse successfully and the fields are dropped —
  never rejected — so existing drafts keep restoring.
- The Export step's "Burn captions into the video" toggle is out of scope: it
  drives `StartTimelineExportInput.showCaptions`, which the export endpoint
  still honors.
- `provider` remains the only client-side run knob.
- Manual-test documentation is updated in the same change so QA exercises the
  server-owned storyboard checkpoint instead of the retired `reviewGates`
  deep link.

## Changes

- `apps/web/src/lib/startRun.ts`, `apps/web/src/lib/api-client/types.ts`:
  payloads and input types trimmed to the consumed fields (landed via PR 887
  and completed here).
- `apps/web/src/components/studio/useStudioFlow.ts`: `BriefDraft` drops
  `seedKind`/`seedSize`/`showCaptions`/`reviewGates`; `SeedKind` removed.
- `apps/web/src/lib/draftStore.ts`: serialization, parsing, and defaults for
  the retired fields removed; legacy fields ignored on parse.
- `packages/shared/src/v1/studio-drafts.ts`: `StudioDraftBrief` trimmed;
  `StudioDraftSeedKind` removed.
- `apps/api/src/lib/api/v1/schemas.ts`: draft validator drops (does not
  reject) the retired fields.
- `apps/web/src/routes/ProjectCreationPage.tsx`: dead `?reviewGates=` URL
  plumbing removed.
- `docs/manual-tests/full-app-inventory.md`,
  `docs/manual-tests/browser-flow-backlog.md`: checkpoint testing now
  documents the server-owned storyboard boundary; the absent checkpoint picker
  is documented as intended, not a product gap.
- UI audit: no wizard step surfaced the retired fields (no seed pickers, no
  wizard captions toggle, no gate checkboxes existed), so no controls were
  removed.

## Validation evidence

Implementation (recorded in PR #888):

- `pnpm typecheck` across all 8 packages — passed.
- Web unit suite — green, including an updated `draftStore.test.ts` with a new
  legacy-draft-parse test; API `studio-drafts.test.ts` gained a
  legacy-payload-dropped test.
- API suite: one pre-existing failure on main
  (`orchestrator-run-projection-metadata.test.ts`) unrelated to this change.

PR-review follow-up (this worksheet's commit):

- `pnpm --filter @popcorn/web typecheck` and API `tsc --noEmit` — passed.
- `pnpm --filter @popcorn/web test` — passed, 78 tests.
- `apps/api` `studio-drafts.test.ts` — passed, 6 tests.
- `playwright test creation-entry-points` (Chromium project, includes the
  mobile-viewport case) — passed, 7 tests, covering the changed drafts surface
  through its real browser entry points: `/projects/new` routing and validated
  legacy draft-history restoration.

## Independent reviews

- PR review: automated Codex review returned two P1 findings — stale
  `reviewGates` checkpoint-testing instructions in the manual-test docs, and
  the missing worksheet/feedback artifacts. Both are addressed in this commit.
- Research/plan/implementation checkpoints ran without a second configured
  independent agent available at implementation time; the PR description
  records the audit trail (entrypoint field consumption, UI audit, export
  captions boundary) that a reviewer can verify directly.

## Blockers and risks

- No live provider run was started; the change removes fields the server
  already ignored, so observable browser behavior is exercised through the
  deterministic entry-point Playwright specs above (desktop and mobile
  viewports) without provider spend. The behavior-preserving claim rests on
  the server contract in `orchestrator-runs.ts`, verified by reading the
  entrypoint handlers.
- Previously persisted drafts keep restoring because retired fields are
  dropped on parse; if a future field must be rejected instead, add an
  explicit validator case rather than reusing this tolerance.

## Next action / handoff

None — PR #888 is ready for review with implementation, tests, documentation,
worksheet, and feedback entry committed. Merge after human review.
