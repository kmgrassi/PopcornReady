# Worksheet: ORCH-20260730-PR5-ACTIVATION

<!-- agent-summary: Durable record for selective-regeneration roadmap PR 5. -->
<!-- agent-summary: This slice activates reviewed adapters only with atomic graph application. -->
<!-- agent-summary: Production registration is composed from modular adapter families. -->
<!-- agent-summary: Selection and stable story-pointer moves commit in one fenced transaction. -->
<!-- agent-summary: Reconciliation and measured cost must be durable before terminal success. -->
<!-- agent-summary: Failed or canceled work leaves completed outputs pooled and inactive. -->
<!-- agent-summary: Use worksheet/ORCH-20260730-PR5-ACTIVATION as the completion tag. -->

## Goal and acceptance criteria

Activate the complete PR 3/4 adapter set behind PR 2's durable proposal
lifecycle. Mixed-domain work must fan out concurrently, park on durable fan-in,
and apply every approved selection and stable story pointer together only after
causation, freshness, reconciliation, and measured-cost checks pass.

Acceptance requires:

- production registry coverage is exact and modular, with no duplicate owner;
- mixed Visuals and Audio execution overlaps and fans in exactly once;
- every planned move resolves through its exact approved output binding;
- selection heads and story pointers revalidate under the final transaction;
- stale, failed, or canceled execution leaves all generated assets pooled;
- terminal execution records moved pointers, child runs, reconciliation, and
  settled actual cost exactly once.

## Dependency stack

- PR 2 integration: `771c0af3` / PR #844.
- PR 3C Audio: `9e2e8cb3` / PR #848.
- PR 4 root adapters: `1ae5c1cf` / PR #847.
- PR 3B and PR 3A are not yet published. Final merge order is
  PR 2 → PR 3C → PR 3B → PR 3A → PR 4 → PR 5, preserving PR 3C callback
  fencing and PR 4 dispatch/provider-result/accounting invariants.

## Research

- Work items already dispatch concurrently through `Promise.allSettled`; each
  item durably reserves its dispatch and callback fences before invoking its
  executor plan.
- Current finalization verifies completed work, reconciliation, and settled
  child budgets, but writes `movedSelections: []` and does not apply approved
  selection or story-pointer moves.
- Selection state is append-only. Atomic application must lock current heads,
  compare both expected asset and sequence, then insert `expectedSeq + 1`.
- Stable story heads live on `story_blueprints.asset_id`,
  `story_blueprint_scenes.scene_asset_id`, and `story_beats.beat_asset_id`.
  The historical `storyboard` discriminator maps to typed blueprint provenance
  and needs an explicit reviewed write contract.
- PR 3C and PR 4 merge cleanly. PR 3A overlaps generated-assets, executor
  lifecycle/registry, shared domain contracts, and docs; PR 3B is based on PR
  3C and currently overlaps PR 4 mainly in documentation.

## Decisions

- Keep production registration in a new composition module instead of adding
  imports to the registry class or lifecycle service.
- Keep final graph application inside the direct Postgres finalization
  transaction, after all work and reconciliation checks and before terminal
  action/reservation updates.
- Resolve each move through a unique durable binding result; never infer an
  output by kind, role, ordering, or active state.
- Treat estimates as admission authority and settled actuals as accounting
  facts. A successful application still cannot exceed the approved ceiling.

## Changes

- Pending implementation.

## Validation evidence

- Pending implementation.

## Independent reviews

- Stack order and provisional PR3C+PR4 base approved by the coordinator.
- Research review requested before atomic-application implementation.

## Blockers and risks

- PR 3A and PR 3B heads are still unpublished, so complete production coverage
  cannot be activated yet.
- Root canonical prospective story/assembly/critique service wiring must remain
  provider-neutral in automated tests.

## Next action / handoff

- Implement atomic graph application and modular registry composition without
  depending on unpublished adapter files.
