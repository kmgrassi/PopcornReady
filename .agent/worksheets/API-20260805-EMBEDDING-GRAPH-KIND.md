# Worksheet: API-20260805-EMBEDDING-GRAPH-KIND

<!-- agent-summary: Durable record for one bounded task. -->
<!-- agent-summary: Update this file as evidence arrives, then commit it with the work. -->
<!-- agent-summary: Use worksheet/API-20260805-EMBEDDING-GRAPH-KIND as the git tag after completion. -->
<!-- agent-summary: Do not include secrets, private prompts, or customer data. -->
<!-- agent-summary: A successor agent should be able to continue from this document alone. -->
<!-- agent-summary: Keep command outcomes factual; do not imply checks that did not run. -->
<!-- agent-summary: Link related reviews, feedback entries, and PRs. -->

## Goal and acceptance criteria

Fix the production asset-embedding boundary so persisted graph kind and physical
media remain separate. A standalone generated image persisted as
`kind=image, media=image` must be embedded as graph kind `image`, never inferred
as `keyframe` from provenance.

Acceptance criteria:

- Embedding enqueue and worker paths re-read a tenant-scoped persisted source.
- The source carries database `kind` and `media` without reconstructing either.
- Generic images remain eligible for embedding.
- Existing source text/hash behavior is unchanged except where the old inferred
  graph kind was wrong.
- Provider-free tests cover database-shaped generic-image and keyframe identity.
- Targeted API tests, API typecheck, API smoke, and agent validation pass.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/NORTH_STAR.md`
- `apps/api/src/lib/tool-tests/README.md`
- `docs/scopes/asset-embeddings.md`
- User-provided typing and boundary-design audit

## Decisions

- First slice is limited to the production embedding boundary.
- Keep the public `V1Asset` response contract unchanged.
- Do not switch source text to the newer shared embedding builder in this PR;
  that would change hash material broadly and could cause an unplanned
  re-embedding/provider-cost wave.
- Add a private store projection that carries persisted graph kind and media,
  and use it at enqueue and processing time.
- Generated Supabase types and rerun-output contract hardening remain follow-up
  slices because they have distinct blast radii.

## Changes

- Added a private `V1AssetEmbeddingSource` contract with required persisted
  `graphKind` and `media` fields.
- Added a tenant-scoped store getter that reads both fields from the raw asset
  row while preserving the existing V1 metadata envelope.
- Updated enqueue and worker paths to re-read that persisted projection.
- Removed graph-kind inference from the production source builder, added generic
  image eligibility, and validated kind/media pairs.
- Added source and job-path tests for generic images, keyframes, metadata
  preservation, raw database-row projection, and invalid kind/media pairs.
- Updated `docs/scopes/asset-embeddings.md` to describe the implemented boundary.

## Validation evidence

- `pnpm install --frozen-lockfile` — passed; lockfile unchanged.
- Focused embedding tests — 19 passed.
- `pnpm --filter @popcorn/api typecheck` — passed.
- After implementation-review fixes, focused embedding tests — 20 passed.
- `pnpm --filter @popcorn/shared test:types` — passed.
- Local API smoke: started `@popcorn/api` with `NODE_ENV=development`,
  `AUTH_MODE=local`, and `PORT=4310`; `GET /api/v1/health` returned HTTP 200.
  Supabase was not configured in this worktree, so no live database mutation or
  provider call was attempted; raw-row projection and job loading were covered
  provider-free.
- `pnpm agent:lint:fix` — passed.
- `pnpm agent:validate -- --scope api` — passed, including agent lint, workflow
  policy, migration, RPC/relation boundary, and API typecheck checks.

## Independent reviews

- Research: independent reviewer confirmed the lossy V1 projection and active
  production reachability; recommended the private persisted-source boundary.
- Plan: independent reviewer approved the private projection and required
  database-derived identity, kind/media eligibility validation, metadata
  preservation, and a narrow job-path assertion.
- Implementation: independent reviewer found no blocking issue and identified
  two P2 evidence gaps. Resolved by testing the pure raw-row projection and by
  narrowing data-asset eligibility/documentation until canonical planning
  content is wired into the production worker.
- Implementation re-review: both P2 findings resolved; no remaining blocking
  issue.
- Wrap-up: independent reviewer confirmed the implementation, tests,
  documentation, worksheet, and feedback are consistent and appropriately
  scoped; ready to commit, tag, push, and open a non-draft PR.

## Blockers and risks

- Correctly labeled assets retain their existing source format and hashes.
- Previously mislabeled generic images receive a corrected source hash on their
  next refresh or backfill, intentionally scheduling bounded provider work.

## Next action / handoff

Ready-for-review PR: https://github.com/kmgrassi/PopcornReady/pull/894

After review, continue the prevention plan in a separate slice: harden
`BoundRequiredOutput.kind` and completion/finalization authorization, then plan
the generated Supabase database-type rollout and canonical vocabulary facade.
