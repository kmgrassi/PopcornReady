# Worksheet: ORCH-20260729-FULL-CUTOVER

<!-- agent-summary: Durable record for the Creative Director full production cutover. -->
<!-- agent-summary: Every new root run defaults to the creative_director execution profile. -->
<!-- agent-summary: Already-created roots retain their immutable pinned execution profile. -->
<!-- agent-summary: Only the explicitly enabled, future-expiring flat fallback can pause the cutover. -->
<!-- agent-summary: Production health must report hierarchy enabled before handoff is complete. -->
<!-- agent-summary: Controlled production testing replaces a pre-cutover soak because there are no production users. -->
<!-- agent-summary: Billable media generation is not started implicitly as part of deployment verification. -->

## Goal and acceptance criteria

Cut production fully to the Creative Director hierarchy for all newly created
full-video root runs, retain a bounded rollback, and verify the deployed runtime
reports the hierarchy enabled.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, and
  `docs/repository-structure.md`.
- `docs/NORTH_STAR.md`.
- `docs/scopes/specialist-agent-orchestration-prs.md`.
- `docs/agent-system/creative-director-rollout.md`.
- `docs/railway-deployment.md`.

## Decisions

- Make the accepted Creative Director hierarchy the code default rather than
  relying on a Railway opt-in variable.
- Preserve the existing immutable per-run execution profile.
- Preserve only the explicit, future-expiring flat fallback for rollback.
- Define full cutover as every newly created root. Explicit resumptions of
  already-pinned flat or legacy test runs retain their immutable surface.
- Do not start billable production work merely to prove the deployment flag.

## Changes

- Removed the opt-in hierarchy variable from profile resolution so new roots
  default to `creative_director`.
- Retained the explicit flat fallback switch plus future UTC expiry.
- Updated rollout, scope, Gate-0, and eval documentation to record the
  default-on production-testing decision and immutable legacy-run exception.
- Added payload-level assertions that normal and anonymous new-root persistence
  defaults to `creative_director` and honors the active flat fallback.
- Kept Asset Studio configuration independent.

## Validation evidence

- Final focused hierarchy/runtime suite: 76 passed, 9 local-Supabase tests
  skipped, including normal/anonymous persistence payload coverage.
- `pnpm --filter @popcorn/api typecheck`: passed.
- Full API suite: 947 passed, 118 skipped, 3 TODO, and 4 unrelated failures:
  two tests reference retired guest-retention migration filenames;
  `discover.test.ts` has a pre-existing UUID expectation failure; and the
  orchestrator projection metadata fixture omits merged `delegate_domains`.
- Local API health smoke at `http://127.0.0.1:4318/api/v1/health` returned
  `creativeDirectorHierarchy.enabled: true` with no rollout variables.
- `pnpm agent:lint:fix` and `pnpm agent:validate -- --scope api`: passed;
  migration validation covered 85 migrations and API typecheck passed.
- Two earlier targeted-test commands did not execute behavior because they were
  launched outside the API package's TypeScript path-alias context; the
  corrected package-scoped command produced the focused passing result above.

## Independent reviews

- Research/plan review: the independent reviewer confirmed default-on is sound
  for every new root and inspected normal/anonymous profile pinning. The review
  identified that Request Changes can explicitly resume an already-pinned flat
  run; this immutable-profile exception is now documented.
- Implementation review found contradictory soak wording and missing
  persistence-payload coverage. Both were corrected before final validation.
- Wrap-up review confirmed the prior findings were resolved, reran 25 focused
  tests with no failures, and found no release-blocking code or documentation
  issue.

## Blockers and risks

- A production health check proves the selected default but not a complete
  provider-backed video generation.

## Next action / handoff

- Complete implementation, targeted validation, independent review, PR, deploy,
  and production health verification.
