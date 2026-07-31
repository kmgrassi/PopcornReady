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

- PR 2 main integration: `codex/selective-regen-pr2-main-integration`.
- PR 3C Audio: `9e2e8cb3` / PR #848.
- PR 3B video: `80f4c847` / PR #849.
- PR 3A stills: `377b3348` / PR #850.
- PR 4 root adapters: `1ae5c1cf` / PR #847.
- Final branch assembled in the approved order:
  PR 2 → PR 3C → PR 3B → PR 3A → PR 4 → PR 5. The one generated-assets
  conflict kept PR 3C's exact callback/child-budget causation path.

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

- Added one production registry composition point for all reviewed still,
  video, Audio, and root adapters. The base registry class no longer owns an
  inert production singleton.
- Added production root services that reuse canonical story derivation/planning,
  timeline assembly, and timeline critique semantics while writing only
  replay-safe pooled outputs. Mixed assembly graph inputs include the exact
  prospective plan, video, Audio, and preserved semantic assets.
- Added exact replay validation for pooled root artifacts and their ordered
  `action_assets` attribution.
- Added durable binding-to-move resolution with exact work, proposal role, and
  intrinsic asset-role checks.
- Added transaction-scoped per-selection advisory locking and append-only
  asset/sequence compare-and-set. Story writes are exposed only through a
  fixed-shape security-definer function that proves the live execution,
  approved move, completed binding, destination role, and expected pointer.
- Finalization now creates exact reconciliation, applies every selection and
  story move, records before/after state and actual cost, and terminalizes in
  one direct Postgres transaction.
- Stale or over-budget application rolls back and is retried as a failed
  terminalization, leaving every completed output pooled.
- Fixed direct completion SQL array typing and expanded the `popcorn_api`
  least-privilege/readiness inventory for atomic graph access.
- Reconciliation replay now compares its exact input and output causal arrays,
  and budget settlement persists/revalidates the complete measured-cost and
  billing tuple.
- Added the activation contract and updated the roadmap status.

## Validation evidence

- API TypeScript typecheck passed.
- Provider-neutral focused suites: 86 passed before final formatting and 64
  passed afterward, covering production coverage,
  mixed Visuals/Audio overlap, callback recovery, role/binding validation,
  root adapters, stale/over-budget terminal fallback, graph move resolution,
  and database-readiness expectations.
- Clean local Supabase reset applied all 93 migrations, including bounded
  story-pointer authority and exact billing-settlement replay.
- Direct `popcorn_api` integration: 2 passed, including expired/recovered
  lifecycle fences, exact callback and budget causation, successful mixed
  selection/story application, terminal reconciliation, and rollback of the
  earlier selection append when the later story CAS was stale.
- Actual production readiness against the clean local database returned
  `{ ready: true, checked: true }`.
- `pnpm agent:lint:fix` and `pnpm agent:validate -- --scope all` passed,
  including both app typechecks, 93-migration validation, 48 reviewed RPC
  targets, and 433 literal relation calls with no retired relations.
- The full API suite retained the four pre-existing baseline failures recorded
  by PR 2 (1,101 pass, 135 skipped, 3 todo); no PR 5 regression was introduced.

## Independent reviews

- Stack order and provisional PR3C+PR4 base approved by the coordinator.
- Research review required deterministic lock order, exact binding
  destinations, complete move recomputation, zero moves after cancellation or
  late callbacks, actual-cost settlement before overage failure, and race /
  rollback / replay tests. Those constraints shaped the implementation.
- Initial implementation review found four blocking issues: incomplete mixed
  Audio causation, placeholder root semantics, incomplete reconciliation
  replay checks, and broad story UPDATE authority. Re-review then found failure
  accounting gaps in replay and structured-call error paths. Every finding was
  corrected, and the final independent wrap-up verdict was approved with no
  remaining blocker.

## Blockers and risks

- No dependency blocker remains.
- Canonical storyboard/scene/beat planning, assembly, and critique are
  model-backed. Proposal decisioning now reserves conservative nonzero
  structured-call ceilings, action-scoped usage is measured, and exact cost is
  settled before terminal application.

## Next action / handoff

- Publish the ready stacked PR and hand its exact head to PR 6.
