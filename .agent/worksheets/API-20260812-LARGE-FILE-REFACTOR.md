# Worksheet: API-20260812-LARGE-FILE-REFACTOR

<!-- agent-summary: The orchestrator-runs route facade owns entrypoint and lifecycle policy. -->
<!-- agent-summary: Read-only run detail assembly and asset/job metadata loading live separately. -->
<!-- agent-summary: Existing route and projection exports remain compatible for callers and tests. -->
<!-- agent-summary: The extraction must preserve project authorization and operator diagnostics gating. -->
<!-- agent-summary: API typecheck and focused orchestrator route tests validate the refactor. -->
<!-- agent-summary: Repository lint and agent validation run before PR handoff. -->
<!-- agent-summary: This worksheet ships with the implementation and matching feedback entry. -->

## Goal and acceptance criteria

- Refactor the oversized `apps/api/src/routes/v1/orchestrator-runs.ts` into
  smaller cohesive modules without changing its route contract.
- Keep the facade below 1,000 lines and preserve all public test/caller exports.
- Validate detail projection, authorization, diagnostics gating, type safety, and
  repository workflow checks.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/agent-system/README.md`, `docs/agent-system/reviews.md`,
  `docs/agent-system/worksheets-and-feedback.md`

## Decisions

- Extract the read-only detail boundary: durable run/gate/action reads, asset
  metadata, job loading, hierarchy assembly, and the detail route adapter.
- Keep entrypoint creation, approval, rejection, cancellation, retry, and router
  registration in the original route facade.
- Re-export moved helpers from the original module to avoid caller churn.

## Changes

- Added `orchestrator-run-details.ts` with detail projection and metadata loading.
- Reduced `orchestrator-runs.ts` from 1,018 to 874 lines.
- Added no product behavior or schema changes.

## Validation evidence

- `pnpm install --offline --frozen-lockfile` — passed using the local pnpm
  cache; no lockfile changes.
- `pnpm --filter @popcorn/api exec tsx --test
  src/routes/v1/__tests__/orchestrator-runs.test.ts
  src/routes/v1/__tests__/orchestrator-run-observability.test.ts` — 50/50
  passed, including detail authorization/diagnostics and job loading.
- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm agent:lint:fix` — passed; `git diff --check` — passed.
- `pnpm agent:validate -- --scope api` — passed, including workflow,
  migration, RPC/relation boundary, and API typecheck checks.

## Independent reviews

- Research/plan/implementation/wrap-up review requested through the repository
  review adapter; unavailable because `AGENT_REVIEW_COMMAND` is not configured
  in this environment. Local review covered the extracted module's imports,
  preserved facade exports, and focused route tests.

## Blockers and risks

- The independent reviewer adapter is unavailable; no behavior or validation
  blocker remains.

## Next action / handoff

- Commit worksheet/feedback with implementation, push, and open a non-draft PR.
