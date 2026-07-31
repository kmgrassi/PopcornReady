# Worksheet: ORCH-20260731-PR850-REVIEW

<!-- agent-summary: Durable record for addressing review feedback on PR 850. -->
<!-- agent-summary: The PR now targets main and remains open for review. -->
<!-- agent-summary: Pooled image revisions persist approved graph inputs. -->
<!-- agent-summary: Domain run and claim generation fence the pooled asset insert. -->
<!-- agent-summary: Keyed generated-asset retries reuse one deterministic action identity. -->
<!-- agent-summary: Database and focused API tests cover the corrected boundaries. -->
<!-- agent-summary: Use worksheet/ORCH-20260731-PR850-REVIEW as the completion tag. -->

## Goal and acceptance criteria

Retarget PR 850 to `main` and address all unresolved review comments without
activating the inert PR 3A executor. A revised image must retain the exact
approved graph inputs, a reclaimed Visuals worker must not mint a pooled asset,
and an idempotent job replay must not append a sibling running action.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`, `docs/NORTH_STAR.md`
- `docs/supabase-identity-and-rls.md`
- `docs/scopes/database-access-boundary.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `apps/api/src/lib/tool-tests/README.md`
- PR 850 unresolved review threads fetched through the GitHub connector and the
  thread-aware GraphQL helper.

## Decisions

- Update the existing pooled-regeneration RPC through a new migration, dropping
  its prior signature so PostgREST cannot see an ambiguous overload.
- Preserve the backward-compatible behavior when `p_inputs` is omitted by
  falling back to the predecessor inputs.
- Derive a UUID-shaped action identity from workspace, project, job type, and
  idempotency key only when the caller did not reserve an explicit action ID.
- Keep the production executor registry inert; these corrections harden the
  canonical generated-asset boundary consumed by the future activation PR.

## Changes

- Retargeted PR 850 from the PR 2 integration branch to `main` and merged the
  current `origin/main` into its head without conflicts.
- Passed the approved revision `graphInputs` and the durable job's run/claim
  fence through canonical image persistence.
- Replaced the pooled-regeneration RPC signature with a backward-compatible
  `p_inputs` parameter, using the effective inputs for the immutable row,
  fingerprint, and trigger-derived edges.
- Derived one UUID-shaped action identity for keyed generated-asset requests
  while preserving caller-reserved action IDs.
- Added unit, migration, generated-assets database, and stale-claim integration
  coverage for all three review threads.

## Validation evidence

- Focused non-DB test set: 12 passed, 12 DB-gated cases skipped as designed.
- Local Supabase stale-claim integration: 1 passed; the old claim minted no
  asset or edge and left its action non-applied.
- Local Supabase generated-assets targets: graph-input/edge revision and replay
  behavior passed together before the replay assertion was strengthened; the
  strengthened replay rerun was blocked twice by the local PostgREST stack's
  pre-existing 30-second workspace-visibility query timeout.
- `pnpm --filter @popcorn/api typecheck` — passed.
- `pnpm db:migrations:validate` — passed (91 migrations).
- `pnpm agent:lint:fix` — passed.
- API application smoke on port 4016 returned `200` from `/api/v1/health` with
  the Creative Director hierarchy enabled. The unrelated recovery worker logged
  missing-Supabase configuration because the smoke intentionally omitted DB env.
- `pnpm agent:validate -- --scope api` — passed, including API typecheck,
  migration validation, RPC/relation boundaries, and workflow-policy tests.

## Independent reviews

- Research review confirmed all three comments and identified the RPC input
  boundary and replay-cardinality requirements.
- Plan review approved the approach with explicit backward-compatibility,
  terminal-state, stale-claim, and post-push verification checks.
- Implementation review identified weak replay cardinality and missing durable
  stale-claim/grant assertions. After those were added, re-review approved with
  no remaining correctness, regression, or scope findings.
- Wrap-up review approved the final scope, documentation decision, validation
  record, branch/base state, and commit/push handoff with no remaining findings.

## Blockers and risks

- PR 850 includes the still-open PR 2 stack while PR 844 remains unmerged.
- Pooled minting is not itself idempotent by action ID after an asset insert;
  crash recovery at that narrower boundary remains a follow-up outside these
  three comments.

## Next action / handoff

- Commit, tag, push, and verify the open PR against `main`.
