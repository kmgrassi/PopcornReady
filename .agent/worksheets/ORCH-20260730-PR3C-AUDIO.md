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
- Routed each canonical generated-asset provider claim into a nested child
  reservation under the proposal ceiling using the exact child run, primitive
  action, and provider job. Deterministic picture-fit reserves and settles one
  zero-cost child operation.
- Recorded terminal domain reports through the proposal callback transaction;
  exact binding validation rejects extra, missing, or rebound outputs, and the
  callback derives its primitive actions and settled budget keys from durable
  output causation. A late callback that lost cancellation/retry ownership
  cannot advance state.
- Kept fit critiques pooled by reusing the engine's child action without
  appending the legacy active `audio_fit:*` selection.
- Required picture-fit work to name one exact beat. Unsupported semantic scope
  returns a typed Creative Director prerequisite instead of broadening Audio.
- Corrected proposal delegation preserve projection to use graph content hashes
  and the same stable selection-key semantics as target-scope validation.
- Updated the authoritative orchestration contract and cutover roadmap.

## Validation evidence

- `pnpm agent:lint:fix`
- `pnpm --filter @popcorn/api typecheck`
- `pnpm exec tsx --test` over Audio fit, Audio profile, proposal delegation,
  generated-asset nested admission, Audio rerun executor, and rerun
  lifecycle-focused suites: 52 passing with 8 database-gated tests skipped
  when local Supabase is not configured across the final focused runs.
- Full repository validation and application-path smoke passed before the
  independent review. The review found three DB-causation/accounting blockers;
  the nested canonical reservation, pooled fit, and callback-causation changes
  above resolve them. Final independent re-review approved the hardened lane.

## Independent reviews

- Research/plan checkpoint reviewer slots were occupied by the three explicit
  parallel cutover lanes; an independent adapter agent performed the
  implementation and wrap-up reviews once its lane reached validation.
- Independent implementation review initially requested changes: domain
  callbacks lacked DB-provable primitive/budget causation, budget allocation
  bypassed canonical pricing, and fit retries could duplicate a critique.
- Final re-review approved after canonical nested provider reservations,
  exact execution-parent causation loading, pooled zero-cost fit admission, and
  deterministic fit artifact replay were implemented.

## Blockers and risks

- PR 3C depends on PR 2 reaching `main`; the implementation branch is stacked
  on the clean PR 2 integration head.
- PR 4's dispatch-finalization guard must land before PR 5 activates any
  proposal-origin domain adapter; it prevents ordinary child finalization from
  applying the shared work dispatch before fenced `completeWork`.
- Provider-backed production spend is not authorized for this adapter-only PR.

## Next action / handoff

- Publish the approved ready stacked PR and keep the production registry inert
  until PR 4's dispatch guard and PR 5's activation land.
