# Worksheet: ORCH-20260729-PR1-PROPOSALS

<!-- agent-summary: Durable record for selective-regeneration roadmap PR 1. -->
<!-- agent-summary: This slice adds an inert model-backed RerunProposal.v2 preview. -->
<!-- agent-summary: Existing Request Changes and board-feedback behavior remains live. -->
<!-- agent-summary: The server owns target authorization, pins, estimates, risk, and approval. -->
<!-- agent-summary: No proposal execution, provider activation, or selection mutation belongs here. -->
<!-- agent-summary: Use worksheet/ORCH-20260729-PR1-PROPOSALS as the completion tag. -->
<!-- agent-summary: Reviews, commands, risks, and PR evidence are recorded below. -->

## Goal and acceptance criteria

Implement roadmap PR 1: a bounded Creative Director decision packet, strict
`RerunProposal.v2` decision parsing, server policy derivation, immutable action
persistence, and an explicit inert v2 preview API. Preserve the current v1
preview and every live Request Changes/board-feedback route until PR 6.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`, `docs/NORTH_STAR.md`
- `docs/domain-agent-orchestration-contract.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `docs/supabase-identity-and-rls.md`
- `apps/api/src/lib/tool-tests/README.md`

## Decisions

- Add `/rerun-proposals/v2` beside the existing endpoint instead of changing its
  request or response shape.
- Treat model output as a proposal decision only; all cost, risk, approval,
  pins, and planned pointer moves are server-derived.
- Keep the adapter injectable so observable tests use deterministic decisions
  and never contact a provider.
- Restrict story pointer moves to the four typed semantic snapshot heads:
  blueprint asset, storyboard plan, scene asset, and beat asset; panels use
  asset/selection bindings.
- Issue a unique binding ID for every proposed output, including duplicate
  kind/role pairs; PR 2 must preserve that identity through task/report output.
- Derive clarification answer fingerprints exclusively on the server from the
  normalized question/options/targets and every freshness pin.
- Fail closed when an asset target is active in multiple selection slots; the
  model must name the intended selection target.
- Keep inert proposals unbound when no active hierarchy root exists; never
  create queued transport state during preview.
- Resolve project, timeline-item, and transcript-segment targets to bounded
  semantic rows and backing graph assets before graph closure.

## Changes

- Added the shared discriminated `RerunProposal.v2` contract and server-issued
  work/output binding types.
- Added strict semantic-only model decision parsing and a structured Creative
  Director adapter.
- Added a bounded fresh decision packet with graph closure, lineage/siblings,
  canonical story rows, semantic asset summaries, independently bounded causal
  actions/reports, capabilities, budget, and deterministically capped pins.
- Added server validation and derivation of bindings, pointer moves, estimates,
  risk, and approval policy.
- Added an explicit inert `/rerun-proposals/v2` route beside the unchanged v1
  and live Request Changes paths.
- Addressed four PR review threads: removed queued ghost-root creation, added
  semantic target/backing-asset resolution, reserved explicit story rows before
  the story budget remainder, and rejected contradictory no-op checklists.
- Follow-up review separated storyboard plan pins from blueprint pins and made
  large project packets reserve semantic backing assets before selection heads,
  then omit any semantic row whose backing asset/pin did not fit the bound.
- PR #837 review follow-up authorizes retained project-level semantic rows,
  derives quotes from canonical timed media pricing, issues null/sequence-zero
  pins only for server-recognized empty slots, and binds project-level story
  snapshots to the story blueprint pointer.

## Validation evidence

- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/shared typecheck` — passed.
- `pnpm --filter @popcorn/shared test:types` — passed.
- Focused v1/v2 proposal/parser/context/HTTP smoke tests — 25 passed after PR
  review changes.
- `pnpm agent:lint:fix` — passed.
- `pnpm db:migrations:validate` — passed (85 migrations).
- `pnpm --filter @popcorn/web typecheck` — passed.
- `pnpm agent:validate -- --scope all` — passed.
- Full `pnpm --filter @popcorn/api test` — 968 passed, 118 skipped, 3 todo, and
  4 unrelated baseline failures: two tests reference absent historical guest
  retention migration files; the discover UUID-shape fixture fails; and the
  run-projection expectation omits the already-shipped `delegate_domains`
  catalog entry. None touch this diff; focused affected tests pass.

## Independent reviews

- Research and plan summaries sent to the root agent; the root owns independent
  checkpoint review for this parallel lane.
- Independent plan review approved the separate inert endpoint and required
  strict server ownership, bounded collections, and pre-write authorization.
- Contract audit required canonical story pointer names and end-to-end binding
  identity; both findings are implemented and tested.
- Independent implementation review required six hardening changes: server-owned
  clarification fingerprints, explicit handling of multi-slot assets, nested
  context caps/deduplication, semantic and causal context, canonical timeline
  identity authorization, and active-root enforcement. All six are implemented
  with focused regression coverage.
- Re-review found one final cap-order edge case. Explicit selection/story
  targets now reserve their real pins before the bounded remainder, and missing
  explicit pins fail closed instead of fabricating null/sequence-zero state.
- Final independent re-review approved the corrected implementation with no
  remaining blockers.
- PR review follow-up is being validated locally; per handoff instructions the
  GitHub threads remain unresolved and no reply/commit/push is performed here.
- Review follow-up validation passed: API/shared/web typechecks, shared type
  tests, agent lint/validation, migration validation (85), focused API smoke,
  and `git diff --check`.
- Independent follow-up review found storyboard/blueprint pin aliasing and a
  project-scale semantic/backing-asset budget mismatch; both are covered by
  distinct-identity and >120-selection regressions.
- Independent integration review confirmed both replayed commits are
  patch-equivalent to the reviewed originals, the `main...HEAD` range contains
  no unrelated source, and the PR 0 base-only retarget preserves its existing
  implementation.
- Independent PR #837 review approved all four follow-up fixes: bounded semantic
  authorization, fail-closed empty-slot recognition, canonical default-provider
  timed pricing, and project-to-blueprint snapshot binding.

## Main integration validation

- Focused proposal parser/context/service/in-process HTTP tests — 29 passed
  after PR #837 review changes.
- API, shared, and web typechecks — passed.
- Shared contract type tests — passed.
- `pnpm agent:lint:fix` — passed.
- `pnpm db:migrations:validate` — passed (86 migrations).
- `pnpm agent:validate -- --scope all` — passed.
- `git diff --check origin/main..HEAD` — passed.

## Blockers and risks

- The original PR was stacked on the scope PR and intentionally does not
  activate execution. After GitHub merged it into that already-merged branch,
  the two reviewed implementation commits were replayed unchanged onto current
  `main` in `codex/selective-regen-pr1-main-integration`.
- PR 0 independently hard-locks all root creation to the hierarchy. Its open PR
  was retargeted from the scope branch to `main`; no replacement implementation
  or rebase was required.
- No Supabase credentials are present in this isolated worktree, so the API path
  smoke uses a real in-process HTTP server plus deterministic service seams. No
  provider-backed smoke is required or authorized for this inert PR.

## Next action / handoff

- Merge the ready integration PR into `main`, then merge the separately
  retargeted PR 0 hierarchy lock. PR 2 can then build on both foundations.
