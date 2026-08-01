# Worksheet: WEBAPI-20260801-STANDALONE-ASSET-STATUS

<!-- agent-summary: Durable record for repairing one-off asset run completion and progress presentation. -->
<!-- agent-summary: The observed 15-hour Script activity was stale projection state, not a live script task. -->
<!-- agent-summary: Standalone asset runs must render as one bounded asset activity, never a video-production pipeline. -->
<!-- agent-summary: Terminal run and job state must override stale running action rows. -->
<!-- agent-summary: Domain completion instructions must not conflict with the JSON report contract. -->
<!-- agent-summary: Validate API projections, domain completion, browser behavior, and desktop/mobile presentation. -->
<!-- agent-summary: Ship implementation, tests, documentation, feedback, tag, and a ready pull request together. -->

## Goal and acceptance criteria

Make creator-direct one-off Image, Video, and Audio work truthful and bounded. A one-off asset must remain attached to a real project, show one asset-specific activity instead of Brief/Script stages, stop animating when its run or job is terminal, and complete with a valid durable domain report after a successful provider output.

## Production evidence

- Project `6bafbe8d-b3d3-4735-bca7-47445601a4a7` exists as `Rpg boss`; the Asset Studio flow therefore did create and retain a project for the image.
- Original run `a2e75656-fd10-46d3-8071-7d44a8863a02` failed after about 29 seconds, while a stale `generate_image_asset` action kept the UI animating for 14h56m.
- The original failure was PostgreSQL `23514` at `orchestrator_runs_wait_reason_shape`; merged PR #861 repaired the finite-run `media_job` wait transition.
- Retry run `9cc7846b-2b28-4100-948e-570c657e72ca` produced a ready image in about 27 seconds, then failed after 1m42s because the shared model instruction requested prose while the Visuals domain contract required terminal JSON.
- The generic run projection treated `creator_direct_proposal`, `generate_image_asset`, and storage/report actions as production stages; `generate_image_asset` fell back to `creative_plan`, which the fixed rail consumed as Brief/Script.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, `docs/repository-structure.md`
- `docs/NORTH_STAR.md`, `docs/domain-agent-orchestration-contract.md`
- `docs/scopes/orchestrator-step-durability.md`, `docs/scopes/specialist-agent-orchestration-prs.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`, `docs/ui-interaction-model.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`, `apps/api/src/lib/tool-tests/README.md`

## Plan

1. Make run projections exclude control/storage/report actions and honor terminal run/job state over stale action status.
2. Give standalone generation tools explicit asset-stage metadata and render them through a dedicated one-step StageRail presentation.
3. Make root and domain terminal instructions explicit at the model boundary and safely normalize a single fenced JSON object before full domain-report validation.
4. Add targeted API/model/parser/browser regressions, then verify the real application path at desktop and mobile widths.
5. Update authoritative docs, feedback, validation evidence, reviews, and publish a ready PR.

## Decisions

- Keep one-off work in the canonical project-scoped agent session and immutable asset graph; do not add a separate job model or bypass project creation.
- Keep domain reports strict. Recovery may unwrap one exact Markdown JSON fence, but it must still parse and satisfy the existing typed output/evidence contract.
- Present creator-direct generation as a single asset activity derived from the exact tool, not as a truncated production pipeline.
- Treat terminal transport and attached terminal provider-job state as authoritative when legacy action rows remain `running`.

## Changes

- Preserved `task_kind` and `origin_kind` in the public run store projection and
  added typed standalone image/video/audio presentation plus completion metadata.
- Hid proposal, storage, report, and feedback actions only from creator-facing
  progress while retaining their immutable history.
- Made terminal parent/job state authoritative over stale running actions and
  added explicit stage catalog metadata for standalone media tools.
- Added a dedicated one-step asset rail, asset-ready terminal copy, and matching
  project-overview summary; full production-pipeline groups remain unchanged.
- Split model terminal instructions into text and domain-JSON modes, with strict
  normalization of at most one whole-response JSON fence.
- Added API, parser/model, desktop project-overview, desktop run, and mobile run
  regressions and updated the owning system/testing documents.

## Validation evidence

- Targeted API suite: 40/40 passed across run projections, catalog metadata,
  domain completion, and model routing.
- API and web TypeScript checks passed.
- Focused Chromium E2E: 11/11 passed for `run-progress.spec.ts` and
  `project-upload-more.spec.ts`.
- Focused mobile Chrome E2E: 1/1 passed for standalone image completion.
- After review fixes, the final bounded desktop set passed 3/3 and the final
  standalone mobile check passed 1/1, including negative production-copy and
  failed-parent/succeeded-stage assertions.
- `pnpm agent:lint:fix` passed.
- `pnpm agent:validate -- --scope all` passed, including repository policy,
  migration, RPC/relation boundaries, and API/web type checks.
- The first broad Playwright invocation unintentionally ran the full 95-test
  matrix: the two new strict-locator failures were corrected, while one existing
  mobile cancellation test timed out; the same cancellation test and all 11
  affected Chromium tests passed on the focused rerun.

## Independent reviews

- Research: `/root/research_review` reproduced the original and retry state, identified the stale projection and completion-instruction conflict, and recommended a standalone activity surface plus terminal-state authority.
- Plan: `/root/research_review` approved the plan after requiring explicit
  standalone success semantics, durable origin/task identity, audio coverage,
  terminal-state authority, and preservation of hidden action history.
- Implementation: `/root/research_review` found two presentation leaks: terminal
  standalone failure was understated on the project overview, and the run header
  could still infer Shots/Visuals. Both were fixed with explicit parent-state
  summary copy, presentation-aware header labels, and desktop/mobile assertions.
- Wrap-up: `/root/research_review` approved the final diff with no remaining
  correctness, regression, scope, test, documentation, or handoff blockers
  after standalone-only copy replaced the residual production-pipeline framing.

## Blockers and risks

- Historical rows can contain valid ready assets alongside failed/stale control-plane state; projections must improve readability without rewriting immutable history.
- The UI change spans shared run surfaces, so video-production grouping must retain its existing behavior.

## Next action / handoff

- Commit and tag the validated worksheet state, push the branch, and open the
  required ready pull request.
