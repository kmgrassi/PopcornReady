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
- Restrict story pointer moves to the three live canonical semantic snapshot
  heads; panels use asset/selection bindings.
- Issue a unique binding ID for every proposed output, including duplicate
  kind/role pairs; PR 2 must preserve that identity through task/report output.
- Derive clarification answer fingerprints exclusively on the server from the
  normalized question/options/targets and every freshness pin.
- Fail closed when an asset target is active in multiple selection slots; the
  model must name the intended selection target.

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

## Validation evidence

- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm --filter @popcorn/shared typecheck` — passed.
- `pnpm --filter @popcorn/shared test:types` — passed.
- Focused v1/v2 proposal/parser/context/HTTP smoke tests — 22 passed.
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

## Blockers and risks

- This PR is stacked on the scope PR and intentionally does not activate
  execution. PR 0 independently hard-locks all root creation to the hierarchy.
- No Supabase credentials are present in this isolated worktree, so the API path
  smoke uses a real in-process HTTP server plus deterministic service seams. No
  provider-backed smoke is required or authorized for this inert PR.

## Next action / handoff

- Publish the ready stacked PR and hand its URL/commit to the roadmap owner.
