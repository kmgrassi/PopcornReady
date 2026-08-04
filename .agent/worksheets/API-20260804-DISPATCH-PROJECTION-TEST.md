# Worksheet: API-20260804-DISPATCH-PROJECTION-TEST

<!-- agent-summary: Fix the failing orchestrator run-projection metadata test on main. -->
<!-- agent-summary: Decide whether delegate_* tools need real projection metadata or the test is stale. -->
<!-- agent-summary: History shows the undefined toolStage fallback was a deliberate design change. -->
<!-- agent-summary: Dispatch actions emit no creator stage, so 'Plan'/101 metadata would be inert. -->
<!-- agent-summary: The test now asserts the unknown-tool fallback for delegate_* tools. -->
<!-- agent-summary: The raw-name fallback is confirmed unreachable from creator surfaces. -->
<!-- agent-summary: Remaining API-suite failures are pre-existing on clean main and out of scope. -->

## Goal and acceptance criteria

`apps/api/src/routes/v1/__tests__/orchestrator-run-projection-metadata.test.ts`
fails on main (814d5477): it expects `delegate_visuals`/`delegate_audio`/
`delegate_domains` to project as `['Plan', 101]`, but `toolLabel`/`toolOrder`
return the raw tool name with `Number.MAX_SAFE_INTEGER`. Decide which side is
correct, fix it, and open a ready-for-review PR against main. Acceptance: the
metadata test passes, the decision is grounded in the commit history and
current projection behavior, and no unrelated behavior changes.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`
- `apps/api/src/routes/v1/orchestrator-run-projections.ts`
- `apps/api/src/lib/orchestrator-tools/capability-catalog.ts`
- `apps/api/src/routes/v1/session-run-projection.ts`
- Commits 091f3d77 (specialist-agents PR 6) and 55421ff3 (storyboard
  orchestration)

## Decisions

- The test expectation is the stale side; update the test, not the projection.
- History: PR 6 (091f3d77) added the dispatch tools with
  `runProjection: {label: null, order: null}` — explicitly no dedicated stage —
  while `toolStage()` still had `default: return "creative_plan"`, which is
  where `['Plan', 101]` came from. Commit 55421ff3 deliberately retyped
  `toolStage()` as `GenerationStageType | undefined` (gates and
  `projectStages` filter on it) but did not update this test.
- Restoring `['Plan', 101]` in the capability catalog would be inert:
  `projectStages` skips dispatch actions before label/order are read, so no
  stage is emitted either way.
- Re-mapping delegate_* to `creative_plan` in `toolStage()` would resurrect a
  creator-visible "Plan" stage, contradicting the PR 6 intent that dispatch
  tools are hidden orchestration metadata rather than creator-visible stages.
- The raw-name fallback cannot reach a creator surface: the only `toolLabel`
  consumer outside `projectStages` is the hierarchy view
  (`session-run-projection.ts`), which labels domain child-run actions only,
  and delegate_* tools are root-only dispatch tools.

## Changes

- Updated the delegate_* expectations in
  `apps/api/src/routes/v1/__tests__/orchestrator-run-projection-metadata.test.ts`
  to the unknown-tool fallback (raw name, `Number.MAX_SAFE_INTEGER`) and
  rewrote the comment to document why neither value renders for creators.
- Added this worksheet and the matching feedback record after PR review
  flagged that the first commit shipped without them.

## Validation evidence

- `npx tsx --test src/routes/v1/__tests__/orchestrator-run-projection-metadata.test.ts`
  — passed (1 test) after the fix; reproduced the failure first on clean main.
- Full `pnpm --filter @popcorn/api test` — 1360 tests, 1212 pass, 4 fail:
  guest-retention migration, anonymous-user purge migration, production graph
  reader, and discover uuid check. Verified via `git stash` that these fail
  identically on clean main; this diff touches only the one test file.
- `pnpm agent:validate -- --scope api` — passed (run before the records
  commit; see feedback entry).

## Independent reviews

- No pre-implementation review checkpoints were run; the change is a
  single-file test-expectation fix grounded in commit archaeology.
- Codex PR review (PR #890) flagged the missing worksheet/feedback records
  (P1); this commit addresses that finding. No findings against the test
  change itself at time of writing.

## Blockers and risks

- The 4 pre-existing API-suite failures remain red on main and are not
  addressed here; they predate this branch.
- If a future surface starts rendering root-run dispatch actions directly, it
  must supply its own label source (for example the catalog `label` field,
  "Visuals Assignment" etc.) rather than relying on `toolLabel`'s raw-name
  fallback.

## Next action / handoff

Commit the worksheet and feedback records, tag
`worksheet/API-20260804-DISPATCH-PROJECTION-TEST`, push, and reply to the
Codex review thread on PR #890. Leave thread resolution to the user.
