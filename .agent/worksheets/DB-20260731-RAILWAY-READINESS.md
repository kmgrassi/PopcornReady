# Worksheet: DB-20260731-RAILWAY-READINESS

<!-- agent-summary: Repair the Railway healthcheck failure after the story-spine migration. -->
<!-- agent-summary: The container built and started, but exact database readiness returned unavailable. -->
<!-- agent-summary: Direct scene snapshot access was missing from the readiness allowlist. -->
<!-- agent-summary: Two unused stable-identity grants also drifted beyond the direct-role boundary. -->
<!-- agent-summary: A forward migration revokes those grants instead of widening application authority. -->
<!-- agent-summary: Unit, migration, real-role, live-health, lint, and API validation evidence belong here. -->
<!-- agent-summary: Commit the implementation, documentation, worksheet, and feedback record together. -->

## Goal and acceptance criteria

Restore Railway promotion for the selective-regeneration cutover while
preserving the exact least-privilege `popcorn_api` boundary. Production
readiness must allow the semantic scene snapshot pointer required by direct
transactions, reject unused stable-identity access, and pass against a fully
migrated local database as the real application role.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/supabase-identity-and-rls.md`
- `docs/scopes/database-access-boundary.md`
- `docs/scopes/selective-regeneration-activation-contract.md`
- `docs/railway-deployment.md`

## Decisions

- Treat the latest failed Railway deployment as a healthcheck failure, not a
  build or migration failure: its container started and listened on port 8080.
- Add `story_snapshot_asset_id` to the exact direct-role readiness contract
  because both proposal freshness and atomic graph application read it.
- Do not bless the two `stable_id` grants: direct TypeScript transactions do
  not read them, so a forward migration revokes them.
- Prove the contract with complete-array unit assertions and the existing
  real-Postgres readiness check running under `popcorn_api`.

## Changes

- Added the required semantic scene pointer to the exact readiness grant map.
- Added complete-array unit coverage for both direct story tables.
- Added forward migration `20260731155000` to revoke the two unused stable-ID
  column grants without touching the required snapshot pointer.
- Added static migration coverage for both revocations and pointer retention.
- Updated the database-access boundary to require grant/readiness changes and
  real-role coverage to ship together.
- Added this worksheet and its task-scoped feedback record.

## Validation evidence

- Pre-fix production evidence: Railway deployment `221be65c` built, started
  Express, and failed during the network healthcheck phase after 4m38s.
- Pre-fix local real-role command could not start because this worktree had no
  installed `tsx`; `pnpm install --frozen-lockfile` installed the locked
  workspace dependencies.
- Focused readiness tests pass 11/11, including the exact story-column arrays.
- Focused lifecycle-migration tests pass 7/7, including the forward revokes.
- Migration validation passes for 98 migration files.
- `npx supabase migration up --local` applied migration `20260731155000`.
- The real creator-direct integration passes 1/1 as `popcorn_api`; its final
  readiness assertion returns `{ ready: true, checked: true }`.
- The real rerun-lifecycle integration passes 2/2 after the revokes, including
  mixed story/selection application and stale compare-and-set rollback.
- A development API process served `/api/v1/health` with HTTP 200 and drained
  cleanly after the request.
- A production-mode local health request could not provide additional evidence
  because the Docker-published Postgres port repeatedly timed out; direct
  `pg_isready` and `psql` timed out at the same boundary. The temporary local
  role login was restored to `NOLOGIN` (`rolcanlogin = false`).
- `pnpm agent:lint:fix` passes for all seven changed implementation,
  documentation, worksheet, feedback, and migration files.
- `pnpm agent:validate -- --scope all` passes workflow policy, 98-migration
  validation, RPC/relation boundaries, and web/API typechecks.

## Independent reviews

- Research/plan review confirmed that the stale exact-grant contract is
  sufficient to force health to return 503 and recommended a complete-array
  unit assertion plus the existing real-role integration.
- The reviewer identified that only `story_snapshot_asset_id` is required by
  direct transactions; the stable-ID grants can be revoked for stricter least
  privilege.
- Implementation review approved the forward migration, fail-closed rollout
  ordering, exact allowlist, tests, documentation, and real-role evidence with
  no blocker.
- Wrap-up review approved commit, worksheet tag, push, and open-PR publication
  with no remaining implementation, security, rollout, test, or documentation
  blocker.

## Blockers and risks

- Railway and Supabase deploy independently. Until the forward revocation
  migration applies, the new API will continue to fail closed; Railway should
  retry health during promotion and retain the old healthy deployment.

## Next action / handoff

Commit and tag the worksheet, then push and publish an open PR.
