# Worksheet: ORCH-20260730-PR3C-AUDIO

<!-- agent-summary: Durable record for selective-regeneration roadmap PR 3C. -->
<!-- agent-summary: This slice adds bounded Audio and picture-fit rerun executors. -->
<!-- agent-summary: Executors remain absent from the production registry until PR 5. -->
<!-- agent-summary: Audio outputs stay immutable and pooled until atomic application. -->
<!-- agent-summary: Exact proposal targets, pins, bindings, and causation remain authoritative. -->
<!-- agent-summary: Cross-domain picture/story gaps return typed root-owned prerequisites. -->
<!-- agent-summary: Use worksheet/ORCH-20260730-PR3C-AUDIO as the completion tag. -->

## Goal and acceptance criteria

Implement roadmap PR 3C behind the PR 2 executor interface for narration,
dialogue, soundtrack, sound-effect, and fit-to-picture outputs. Reuse canonical
Audio tool services, preserve typed script/story/timing inputs, never wake
Visuals for Audio-only work, and keep production execution disabled until PR 5.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`, `docs/NORTH_STAR.md`
- `docs/domain-agent-orchestration-contract.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `apps/api/src/lib/tool-tests/README.md`

## Decisions

- Work on a stacked branch from the reviewed PR 2 integration head while a
  separate agent creates the clean PR 2-to-main integration PR.
- Keep adapters constructible only through explicit test/integration registries;
  do not add them to `productionRerunExecutorRegistry`.
- Reuse the task-bound Audio domain tools and durable job gateway rather than
  duplicate provider logic.
- Treat missing picture duration or exact script/story scope as a typed blocked
  prerequisite owned by the Creative Director.

## Changes

- Added constructible Audio production, source-revision, and picture-fit
  executors behind the PR 2 registry interface without production
  registration.
- Projected the approved work item into one exact `DomainTask.v1`, including
  proposal/approval/execution causation, graph pins, output bindings, and a
  runtime-only callback fence.
- Reserved a deterministic child budget before domain dispatch and partitioned
  the approved maximum across billable bindings without rounding above the
  creator-approved cap.
- Recorded terminal domain reports through the proposal callback transaction;
  exact binding validation rejects extra, missing, or rebound outputs, while a
  late callback that lost cancellation/retry ownership cannot advance state.
- Required picture-fit work to name one exact beat. Unsupported semantic scope
  returns a typed Creative Director prerequisite instead of broadening Audio.
- Corrected proposal delegation preserve projection to use graph content hashes
  and the same stable selection-key semantics as target-scope validation.
- Updated the authoritative orchestration contract and cutover roadmap.

## Validation evidence

- `pnpm agent:lint:fix`
- `pnpm --filter @popcorn/api typecheck`
- `pnpm exec tsx --test` over Audio profile, proposal delegation, Audio rerun
  executor, and rerun lifecycle-focused suites: 24 passing after the final
  fit/callback hardening; earlier lifecycle coverage brought the combined
  focused total to 39 passing.
- Full repository validation, application-path smoke, and independent
  implementation/wrap-up review remain pending.

## Independent reviews

- Research/plan checkpoint reviewer slots were occupied by the three explicit
  parallel cutover lanes. Request an independent implementation and wrap-up
  review as soon as a slot becomes available.

## Blockers and risks

- PR 3C depends on PR 2 reaching `main`; the implementation branch is stacked
  on the PR 2 integration head and will be retargeted after that merge.
- Provider-backed production spend is not authorized for this adapter-only PR.

## Next action / handoff

- Rebase the payload onto the clean PR 2 integration branch, request
  independent implementation review, run full validation and a provider-neutral
  API smoke, then publish a ready stacked PR.
