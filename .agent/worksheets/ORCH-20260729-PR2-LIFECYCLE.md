# Worksheet: ORCH-20260729-PR2-LIFECYCLE

<!-- agent-summary: Durable record for selective-regeneration roadmap PR 2. -->
<!-- agent-summary: This slice adds a fenced proposal lifecycle and inert executor boundary. -->
<!-- agent-summary: Provider-backed adapters remain unavailable until roadmap PR 5. -->
<!-- agent-summary: Proposal output bindings survive delegation and terminal domain reports exactly. -->
<!-- agent-summary: The live v1 Request Changes path remains unchanged until roadmap PR 6. -->
<!-- agent-summary: Use worksheet/ORCH-20260729-PR2-LIFECYCLE as the completion tag. -->
<!-- agent-summary: Reviews, commands, risks, and PR evidence are recorded below. -->

## Goal and acceptance criteria

Implement roadmap PR 2: durable approve, reject, refresh, clarification, and
execute lifecycle operations; token-fenced execution reservations; an inert
kind-executor coordinator with deterministic test fakes; and exact proposal
binding identity through domain tasks and reports. No production provider
adapter may register or spend in this slice.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`, `docs/NORTH_STAR.md`
- `docs/domain-agent-orchestration-contract.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `docs/scopes/database-access-boundary.md`
- `docs/supabase-identity-and-rls.md`
- `apps/api/src/lib/tool-tests/README.md`

## Decisions

- Keep execution reservations separate from action status and fence workers by
  both a rotating UUID token and monotonic lease generation.
- Materialize a nullable proposal's root run only inside the atomic execution
  reservation transaction, after approval and freshness checks succeed.
- Preflight executor coverage before approval, reservation, or spend. The
  production registry is intentionally empty until PR 5; fake executors are
  injectable only in tests.
- Treat `audio_fit` as a distinct bound output kind instead of normalizing it
  to `audio_track`.
- Make refreshes exact-fingerprint, exact-cause successor proposals; identical
  retries replay the existing successor and a different cause fails closed.
- Pre-create callback fences before external dispatch, renew execution leases
  while work is active, and resume accepted work from durable callback results
  without invoking the executor again.
- Admit nested provider/model costs beneath the proposal's canonical budget
  reservation and derive terminal actual cost only from settled children.
- Require exact proposal approval, work binding, dispatch action, primitive
  action, child run, output asset, and reconciliation causation.
- Preserve the live v1 Request Changes and board-feedback behavior.

## Changes

- Added database-owned lifecycle state transitions for proposal approval,
  rejection, refresh, execution admission, work claims, callbacks, failure,
  cancellation, recovery, and terminal settlement.
- Extended the canonical orchestrator budget reservation surface with
  proposal-scoped parent reservations and guarded child admission.
- Added authoritative selection, asset, and story-pointer pin revalidation
  while the referenced rows are locked. The compatibility storyboard pin
  revalidates `story_blueprints.provenance.planAssetId` without restoring the
  retired storyboard table.
- Added an execution coordinator with deterministic terminal replay, renewable
  leases, relational per-executor step replay, callback resume, and failure
  recovery.
- Added a capability/output-level executor registry with `succeeded`,
  `accepted`, and typed `blocked` outcomes. The production registry remains
  empty and cannot launch provider work.
- Carried proposal approval and exact output-binding identity through domain
  tasks and terminal reports, with strict report-side causation validation.
- Added approve, reject, refresh, execute, and cancel v2 proposal endpoints.
  The v1 Request Changes path remains unchanged.
- Updated the domain-orchestration contract and selective-regeneration roadmap
  with the durable lifecycle and downstream adapter boundary.
- Replaced all 15 lifecycle RPC call sites with typed direct-Postgres
  transactions under the exact `popcorn_api` column/RLS capability surface.
  The API inventory returned to 47 expressions / 48 targets.
- Centralized semantic-output validation for both domain completion and durable
  work completion. Image, poster, anchor, storyboard, and keyframe bindings map
  to stored `image` assets; clip maps to `video`; audio track maps to `audio`;
  audio fit maps to `critique`; composite and render retain their graph kinds.
- Addressed PR 839 threads `PRRT_kwDOSqQ6Xc6VJvzU`,
  `PRRT_kwDOSqQ6Xc6VJvzb`, `PRRT_kwDOSqQ6Xc6VJvzd`, and
  `PRRT_kwDOSqQ6Xc6VJvzg`: direct transactions, database-clock terminal
  fences/fresh recovery generation, mandatory root reconciliation, and
  execution → work → callback lock ordering.

## Validation evidence

- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/shared typecheck` — passed.
- Final direct-transaction, lifecycle-service, readiness, and migration
  regression set: 34 passed.
- Clean local Supabase reset applied all 89 migrations, including
  `20260729160000_rerun_proposal_lifecycle.sql` and
  `20260730170000_rerun_lifecycle_postgres_role.sql`.
- The direct `popcorn_api` regression passed expired-worker rejection, fresh
  recovery fencing, exact/canonical callback and failure replay, DB-clock
  callback expiry, forged child-budget/output rejection, mandatory
  reconciliation, and concurrent replay/finalization without deadlock.
- Local database lifecycle integration suite passed all eight cases after the
  final executor-step additions: concurrent admission/idempotency, null-root
  exact refresh, shared-root budget settlement and causation, stale storyboard
  pins, lease/callback/cancel/root-ownership recovery, blocked-work terminal
  release, expired-worker callback repark, and two independently persisted
  child executor steps with exact primitive budgets and crash replay. A clean
  database reset applied all 89 migrations before the final run.
- Full API suite: 989 passed, 123 skipped, 3 todo, and 4 unrelated baseline
  failures (two missing historical guest-retention migration fixtures, the
  existing discover UUID assertion, and the existing orchestrator projection
  metadata assertion).
- API application smoke on port 4012 returned healthy status with the creative
  director hierarchy enabled. Lifecycle HTTP behavior is covered by focused
  in-process route tests using fake executors.

## Independent reviews

- Research/plan review produced the concurrency, refresh identity, failure
  recovery, actual-cost, causation, pin, parent-budget, lease-takeover, and
  local-database acceptance matrix implemented here.
- Downstream adapter-wave review required capability-granular dispatch, async
  accepted/blocked outcomes, trusted authority context, prospective binding
  reads, primitive cost/causation, and callback fences; those seams are present.
- Initial implementation review found 15 callback, stale-state, storyboard-pin,
  per-executor durability, terminal replay, failure precedence, blocked-work,
  output/budget causation, approval, registry, root-lifecycle, reconciliation,
  and canonical-equality defects. Each was corrected and covered by focused or
  real-database tests.
- Second-pass review closed those 15 findings and identified three deeper
  child-budget ownership, singular work fan-in, and fast-callback/lease-recovery
  defects. The lifecycle now persists one relational executor step per
  capability, binds child budgets to the exact child run, activates callback
  fences before launch, skips completed steps after crash, and reparks live
  callbacks after worker expiry.
- Final independent review verified the step-backed reconciliation path
  end-to-end and returned merge-ready with no remaining actionable findings.
- PR 839 re-review verified the complete typed-transaction port, exact
  least-privilege capability/readiness surface, database-clock fences, global
  lock order, causation parity, and replay behavior and returned approved with
  no remaining findings.
- `pnpm agent:validate -- --scope all` — passed after hardening.
- `pnpm db:rpc-boundary:test` and `pnpm db:rpc-boundary:validate` — passed with
  48 production targets across 47 expressions.
- Main integration replay: focused lifecycle, transaction, readiness,
  migration, HTTP, and semantic-output normalization tests passed after
  replaying the two reviewed PR 2 commits onto current `origin/main` (38
  passed).
- Main integration replay: API/shared typechecks, migration tests/validation
  (90 migrations), RPC boundary tests/validation, and
  `pnpm agent:validate -- --scope all` passed.
- Main integration replay: relation boundary tests/validation passed at 424
  literal calls and zero dynamic calls; the development API health smoke on
  port 4012 returned `status: ok` with the creative-director hierarchy enabled.

## Blockers and risks

- None. Provider-backed execution is deliberately unavailable in this PR.

## Next action / handoff

- Merge the ready main-targeted integration PR. PRs 3A, 3B, 3C, and 4 must
  target this integration branch while it is open, or rebase onto `main` after
  it lands, so they inherit the reviewed PR 2 transaction and executor
  contracts without carrying the old stacked PR 1 history.

## Main integration replay

PR 839 was reviewed and merged into
`codex/selective-regen-pr1-main-integration`, not into `main`. After PRs 835 and
837 landed, the reviewed PR 2 payload commits were replayed onto current
`origin/main` as a clean main-targeted branch. The reconciliation preserved the
current relation-validation boundary, PR 0 hierarchy lock, and PR 1 canonical
story-pointer semantics. PR 1's already-landed merge-resolution commit was
empty on current main and was intentionally skipped.
