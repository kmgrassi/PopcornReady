# Worksheet: ORCH-20260730-PR7-CLEANUP

<!-- agent-summary: PR 7A is the non-destructive application cleanup stacked on final PR 6 head 3430cec7. -->
<!-- agent-summary: Legacy revision and stage-restart routes, clients, and controls are deleted. -->
<!-- agent-summary: Production registry construction is role-owned; flat runtime compatibility is deleted. -->
<!-- agent-summary: Application code routes by agent role and no longer reads or writes root_execution_profile. -->
<!-- agent-summary: A replay-safe PREP migration keeps older binaries compatible during the rolling deploy. -->
<!-- agent-summary: Creator-direct readiness tolerates but does not require the temporary profile grants. -->
<!-- agent-summary: PR 7B separately removes the compatibility trigger, profile schema, grants, and monitoring. -->

## Goal and acceptance criteria

Complete the forward application cutover after the proposal lifecycle, executor,
adapter, activation, and Request Changes PRs:

- remove every production caller and endpoint for reject/restart-from-stage,
  board revision, asset revision, and timeline revision;
- remove the flat aggregate registry, generic root prompt, deterministic
  board-feedback router, legacy driver, and feature flag;
- construct only explicit Creative Director, Visuals, and Audio registries;
- remove application profile types, reads, writes, health fields, and routing;
- preserve rolling-deploy safety without reintroducing legacy application
  behavior; and
- leave destructive profile-schema removal to PR 7B after PR 7A is fully
  deployed.

## Stack and ownership

This branch is based on final PR 6 commit `3430cec7`, which is stacked on final
PR 5 commit `fc941092`. Its pull request must target
`codex/selective-regen-pr6-ui` so the diff contains only PR 7A.

Source-of-truth documents consulted and updated:

- `AGENTS.md`, `AGENT_WORKFLOW.md`, and `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/NORTH_STAR.md`
- `docs/domain-agent-orchestration-contract.md`
- `docs/agent-system/README.md`
- `docs/agent-system/creative-director-rollout.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`

## Implementation decisions

1. Role registries own their primitive definitions directly through neutral
   registry dependencies. The only aggregate registry is test-only.
2. Engine startup has no eager all-tools registry or default fallback.
3. Root execution is identified by durable `agent_role`; application code does
   not know the historical profile column.
4. The PREP migration fills the retained profile only when an older or newer
   caller omits it for a Creative Director root. It does not label Visuals or
   Audio children.
5. Existing profile constraints, routines, policies, and grants remain for
   older binaries until PR 7B. Readiness therefore permits the exact
   transitional SELECT/INSERT profile grants but does not require them, so the
   same PR 7A binary is healthy before and after PR 7B.
6. Legacy HTTP paths are absent rather than redirected. Request Changes enters
   only through the durable proposal lifecycle shipped by PR 6.

## Validation evidence

- API and web typechecks pass on the final stack.
- Focused API coverage passes 122/122 across registry ownership, durable
  orchestration/recovery, proposal transactions, migration safety, route
  removal, observability, and historical projections.
- Focused web target-mapping coverage passes 5/5.
- A live local API smoke returned HTTP 200 for health and HTTP 404 for all five
  retired route families.
- `pnpm agent:lint:fix` changed no files.
- `pnpm agent:validate` passes, including both app typechecks and the complete
  94-migration chain.
- The focused creator-direct readiness suite passes 10/10 after the
  mixed-schema privilege adjustment.
- A fresh post-review `pnpm agent:lint:fix` and `pnpm agent:validate` pass,
  including both app typechecks and the complete 94-migration chain.

## Independent review

- Research and plan review established the two-deploy PR 7A/PR 7B sequence and
  the rolling compatibility constraint.
- Implementation review verified the route/runtime removal and found one
  mixed-schema readiness issue: the PR 7A binary still required the profile
  grant that PR 7B will remove.
- The fix removes the profile from required privilege inventory while narrowly
  allowing only its temporary SELECT/INSERT grants; unrelated excess
  `orchestrator_runs` privileges remain rejected.
- Wrap-up review also identified and prompted correction of stale North Star,
  domain contract, rollout, testing-inventory, and worksheet claims.

## Remaining risk and handoff

PR 7B must not deploy until PR 7A is fully rolled out. It owns removal of the
temporary trigger, `root_execution_profile` column, profile-bound database
signatures/constraints/policies/grants, transitional readiness allowance, and
profile-based monitoring queries. Before dropping the profile fence, PR 7B must
make terminal flat/null rows structurally non-resumable and prove storyboard
approval and insufficient-credit retry cannot reopen them. Terminal historical
runs remain readable.
