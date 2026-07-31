# Worksheet: ORCH-20260731-MEDIA-WAIT

<!-- agent-summary: Durable record for the domain media-job waiting-state repair. -->
<!-- agent-summary: The production failure was a database constraint rejection after an accepted Visuals tool job. -->
<!-- agent-summary: Audit every orchestrator transition into waiting, not only the observed image path. -->
<!-- agent-summary: Preserve explicit media_job, domain, and approval wait semantics across runtime and schema. -->
<!-- agent-summary: Add observable regression tests that fail against the production-broken transition. -->
<!-- agent-summary: Validate the API application path and repository agent checks before handoff. -->
<!-- agent-summary: Link independent reviews, feedback, validation, and the ready PR here. -->

## Goal and acceptance criteria

Repair the durable orchestrator transition used after an asynchronous provider job is accepted. A finite Visuals or Audio run must park with a database-valid, queryable `media_job` wait reason; root runs and approval/domain waits must retain their existing semantics. Cover every affected caller and recovery path with targeted tests, run the API path, and publish a ready pull request.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, `docs/repository-structure.md`
- `docs/NORTH_STAR.md`, `docs/domain-agent-orchestration-contract.md`
- `docs/scopes/orchestrator-step-durability.md`, `docs/scopes/specialist-agent-orchestration-prs.md`
- `docs/supabase-identity-and-rls.md`, `docs/scopes/database-access-boundary.md`
- `apps/api/src/lib/tool-tests/README.md`

## Decisions

- Keep the existing enum and database constraint. They already encode the intended finite-run contract.
- Require every engine `park` caller to name `media_job`, `domain`, or `approval`; remove the ambiguous null default.
- Persist all named reasons for Visuals/Audio runs. Preserve null media/approval reasons for Creative Director roots and the explicit `domain` reason for root delegation.
- Prefer the durable `media_job` reason in generation projections while retaining action-job inference for historical/root waits.

## Changes

- Created this worksheet before implementation.
- Updated all engine async-job, recovery, review-gate, approval, and delegation parking paths with explicit semantic reasons.
- Added a schema-enforcing fake plus Visuals, Audio, recovery, approval, and root-compatibility regression coverage.
- Updated the generation projection and durability documentation.

## Validation evidence

- Production log evidence: accepted `generate_image_asset` job followed by PostgreSQL `23514` on `orchestrator_runs_wait_reason_shape` while updating the run to waiting.
- Baseline: 47 engine/delegation tests passed before implementation, demonstrating that the prior permissive fake did not reproduce the database constraint.
- Targeted post-change suite: 74 tests passed across engine, delegation, and run-projection tests.
- Focused engine rerun after making the fake transaction-shaped: 44 tests passed.
- `pnpm --filter @popcorn/api typecheck` — passed.
- Full API suite ran 1,285 tests: 1,139 passed, 138 skipped, 3 todo, and 5 unrelated pre-existing failures remained in guest-retention migration filenames, graph-snapshot fixture shape, discover UUID validation, and projection-catalog inventory. None touches this diff; the targeted changed paths passed in the same run.
- API application path: started Express locally on port 4011 and received `HTTP 200` from `/api/v1/health`; the detached worker separately reported that local Supabase credentials were not configured.
- `pnpm agent:lint:fix` — passed for seven task files.
- `pnpm agent:validate -- --scope api` — passed, including repository lint, workflow policy, migration validation (98 migrations), RPC/relation boundaries, and API typecheck.

## Independent reviews

- Research/plan: `/root/wait_reason_research_review` confirmed the code-only fix, mapped every parking site to its semantic reason, and requested schema-shaped tests plus durable projection use.
- Implementation: `/root/wait_reason_impl_review` approved with no findings after auditing all ten parking callers, persistence rules, recovery clearing, projections, constraint-shaped tests, and documentation.
- Wrap-up: `/root/wait_reason_impl_review` approved the seven-file scope, validation record, worksheet/feedback contract, and readiness for a non-draft PR; the reviewer independently reran API agent validation successfully.

## Blockers and risks

- An accepted provider job may outlive a failed state transition, so recovery behavior and duplicate callback handling must remain safe.
- No migration is required; production already has the correct enum and constraint.

## Next action / handoff

- Commit, tag `worksheet/ORCH-20260731-MEDIA-WAIT`, push, and open a ready PR.
