# Worksheet: GEN-20260729-FULL-MIGRATION

<!-- agent-summary: Durable record for the full selective-regeneration migration scope. -->
<!-- agent-summary: The scope must convert shipped graph foundations into complete kind-aware execution. -->
<!-- agent-summary: The finish line removes fixed-stage restart and flat-root production fallbacks. -->
<!-- agent-summary: Work starts immediately through independently mergeable PRs with no deferred dependency gates. -->
<!-- agent-summary: The authoritative sources are NORTH_STAR and the new full-migration roadmap. -->
<!-- agent-summary: Validation covers documentation links, repository hygiene, and independent review. -->
<!-- agent-summary: Use worksheet/GEN-20260729-FULL-MIGRATION as the completion tag. -->

## Goal and acceptance criteria

Create an implementation-ready, authoritative scoping document for completing
the migration to Creative Director-owned, graph-aware selective regeneration
across every production object and asset kind. The roadmap must accurately
separate shipped foundations from missing work, internalize dependencies so
implementation can begin immediately, define ordered PRs with observable
acceptance tests, and end with deletion of fixed-stage and flat-root fallbacks.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, and
  `docs/repository-structure.md`.
- `docs/NORTH_STAR.md`.
- `docs/domain-agent-orchestration-contract.md`.
- `docs/scopes/graph-rerun-decisioning-prs.md`.
- `docs/scopes/regeneration-coverage-prs.md`.
- `docs/scopes/north-star-gap-audit.md`.
- `docs/scopes/specialist-agent-orchestration-prs.md`.

## Decisions

- Create one new authoritative completion roadmap instead of extending two
  overlapping, stale partial scopes.
- Treat model-backed blast-radius decisioning, kind-specific immutable
  execution, Request Changes integration, and fallback deletion as one
  migration with independently mergeable slices.
- Do not make OODA prompt learning a cutover dependency; preserve its separate
  roadmap and expose feedback hooks where useful.
- Require forward cutover rather than indefinite compatibility for fixed-stage
  restart and flat-root execution.

## Changes

- Added `docs/scopes/full-selective-regeneration-cutover-prs.md` as the
  authoritative completion roadmap.
- Defined immediate parallel hierarchy-lock and proposal-decision lanes, a
  durable execution coordinator, parallel Visuals/Audio coverage, root
  reconciliation, Request Changes integration, and final fallback deletion.
- Added explicit coverage for the shipped Request Changes bypass, empty domain
  scope/pins, and flat-era deterministic board-feedback shortcut.
- Marked the older graph-rerun, regeneration-coverage, and gap-audit scopes as
  historical/superseded.
- Corrected `NORTH_STAR.md`, `CLAUDE.md`, and `repository-structure.md` to record
  that the Next monolith is gone and link to the current completion plan.
- Addressed all five PR #832 review threads: preserved the live Request Changes
  path until the lifecycle UI cutover, delayed real adapter registration until
  atomic application, made `RerunProposal.v2` a discriminated outcome union with
  fingerprinted clarification, corrected the job-store path, and documented the
  flat registry as active compatibility production behavior until deletion.

## Validation evidence

- `pnpm agent:lint`: passed during drafting.
- `pnpm agent:lint:fix`: passed; no product-code rewrite was performed.
- `pnpm agent:validate -- --scope docs`: passed, including agent lint, two
  migration-validator tests, and validation of 85 Supabase migrations.
- `git diff --check`: passed.
- After addressing PR #832 comments, `pnpm agent:lint:fix`,
  `pnpm agent:validate -- --scope docs`, and `git diff --check` passed again.

## Independent reviews

- Research review confirmed the hierarchy and graph foundation are shipped,
  identified the Request Changes bypass, project-only delegation scope, legacy
  board-feedback shortcut, flat-root revival risk, and exact deletion targets.
  All findings were incorporated into the roadmap.
- Plan review found lifecycle/status incompatibility, a circular action ID,
  missing output-to-selection bindings, circular PR ordering, ambiguous
  failure/clarification semantics, an optional rather than decisive schema
  deletion, and remaining stale authoritative prose. Resolved by reusing the
  existing action statuses, separating claim leases and terminal execution
  actions, adding planned selection moves, splitting interface/activation/fan-in
  PRs, defining deterministic terminal policies, requiring profile-column
  deletion, and repairing the cited docs.
- Implementation review found ambiguous multi-output binding, early
  story/selection application risk, undefined target/pin types, missing PR 1
  authorization cases, ambiguous failed-execution storage, incomplete flat
  resume coverage, and three residual null-pointer/target/ordering issues.
  Resolved with stable work/output binding IDs, prospective staged inputs plus
  one final transaction, concrete canonical target/pin types, moved
  authorization tests, terminal execution actions for success/failure, explicit
  resume-route migration behavior, nullable story CAS, canonical transcript
  segment targets, and corrected PR ownership.
- Wrap-up review found no unresolved roadmap, correctness, security,
  documentation, or validation blockers and independently reran
  `pnpm agent:validate -- --scope docs` successfully.
- PR-comment research/plan review confirmed all five comments were valid and
  recommended the same safe sequencing: parallel v2 preview without changing
  live callers, adapter activation only in PR 5, a discriminated clarification
  contract, the real `jobs.ts` path, and truthful flat-registry status.
- PR-comment implementation review approved all five fixes and found no new
  roadmap contradiction.
- PR-comment wrap-up review independently reran docs validation and diff checks,
  confirmed the expected five-file scope, and approved commit/push.

## Blockers and risks

- No external blocker is accepted for starting the roadmap. Provider-backed
  tests may use deterministic fakes until an explicitly budgeted smoke is run.

## Next action / handoff

- Commit and push the PR #832 review fixes, resolve the five addressed threads,
  and wait for CI/re-review. After merge, start roadmap PR 0 and PR 1 in
  parallel.
