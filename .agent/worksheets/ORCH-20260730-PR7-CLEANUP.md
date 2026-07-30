# Worksheet: ORCH-20260730-PR7-CLEANUP

<!-- agent-summary: Prepare the final selective-regeneration cleanup without racing the active PR 5 and PR 6 branches. -->
<!-- agent-summary: Remove only legacy surfaces that are behaviorally independent on the PR 2 integration base. -->
<!-- agent-summary: Do not edit files currently changed by the PR 6 UI and lifecycle cutover. -->
<!-- agent-summary: Defer route and schema deletion until every legacy caller has moved to proposals. -->
<!-- agent-summary: Remove the retired creative-director rollout health projection and CLI stage-restart command now. -->
<!-- agent-summary: Recheck active branch overlap before each provisional commit and before the final stack. -->
<!-- agent-summary: Keep this branch unpublished until PR 5 and PR 6 establish the final stack. -->

## Goal and acceptance criteria

Prepare the disjoint portion of PR 7 while PR 5 and PR 6 are still active.
The provisional patch must reduce retired compatibility surface without deleting
anything that an active caller or in-flight branch still needs.

- The health response no longer advertises the retired creative-director
  hierarchy rollout or fallback window.
- The legacy stage-restart command is no longer offered by the API CLI or its
  command reference.
- The still-live opt-in flat tool-loop flag remains unchanged until its driver
  and registry can be removed together on the final stack.
- No active PR 6 file or stack-dependent API/UI route is edited.
- Targeted tests, API typecheck, an API health smoke, and repository validation
  pass before handoff.

## Context and source-of-truth documents

`AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`,
`docs/repository-structure.md`, `docs/agent-system/README.md`, and
`docs/scopes/full-selective-regeneration-cutover-prs.md`.

## Overlap inventory

Direct active PR 6 files excluded from this branch:

- `apps/api/src/lib/api/v1/rerun-lifecycle-store.ts`
- `apps/api/src/routes/v1/rerun-proposals.ts`
- `apps/web/src/lib/api-client/v1-api.ts`
- `packages/shared/src/rerun-proposal.ts`
- `apps/web/src/components/ai-edit/RerunProposalDialog.tsx`
- `apps/web/src/components/ai-edit/RerunProposalDialog.module.css`
- `apps/web/src/lib/rerunProposalQueries.ts`
- PR 6's worksheet and feedback record

Stack-dependent legacy callers and route deletion also deferred:

- `AssetEditModal`, `ProgressView`, `studioQueries`, `queryClient`,
  `ProjectDetailPage`, `ProjectStepPage`, `RunProgressPage`, `StageRail`, and
  their web tests
- `orchestrator-runs.ts`, `orchestrator-run-board-revisions.ts`, and the
  timeline revision endpoints
- restart selection clearing, retired schema callers, flat profile removal,
  historical-root terminalization, and the `root_execution_profile` drop

## Plan

1. Remove the unconditional creative-director rollout compatibility projection
   from health and its dead helper/test coverage.
2. Remove the CLI `run restart` command and command-reference entry while
   leaving the API route for still-active UI callers.
3. Run focused orchestrator tests, API typecheck, a local health smoke, lint,
   and full repository validation.
4. Obtain independent implementation and wrap-up review, commit the provisional
   patch, and leave it unpublished until the final stack is available.

## Decisions

- A file being disjoint is insufficient if deleting it would break an active
  caller. Those changes remain deferred.
- `feature-flag.ts` remains temporarily because the flat tool-loop driver still
  consumes `isOrchestratorToolLoopEnabled`; only the retired hierarchy exports
  are removed.
- The CLI removal intentionally precedes endpoint deletion so new manual use no
  longer starts legacy stage restarts while the compatibility route remains for
  the PR 6 migration window.

## Validation evidence

- The focused orchestrator tool-loop suite passes (8/8), proving the retained
  opt-in tool-loop flag and driver behavior are unchanged.
- `pnpm --filter @popcorn/api typecheck` passes.
- CLI help runs locally and no longer lists `run restart`.
- A development API served `/api/v1/health` with HTTP 200. The response retained
  `status`, `authMode`, `commit`, `creatorDirectDatabase`, and `time`, and
  omitted `creativeDirectorHierarchy` and `fallbackUntil`.
- `pnpm agent:lint:fix` and full `pnpm agent:validate` pass, including both app
  typechecks, 90 migration checks, workflow policy, and database boundaries.
- A fresh PR 6 status check found no file overlap with this patch. PR 6 had
  expanded into additional web callers, reinforcing the decision to defer all
  UI and compatibility-route deletion.

## Independent reviews

- Research/plan: the cutover audit confirmed the final PR 7 removal inventory
  and the two-deploy schema sequence; this provisional plan adopted its
  caller-first boundary.
- Implementation: approved the split as behaviorally safe and confirmed no
  current PR 6 file overlap. The reviewer required the rollout system doc,
  scope status, worksheet evidence, and feedback record to accompany the code;
  all are now included. The reviewer also requested an explicit health-contract
  check; the local HTTP smoke recorded above verifies both retained and removed
  fields.
- Wrap-up: approved with no actionable findings. The reviewer confirmed the
  retired health helpers have no repository consumers, the unrelated tool-loop
  flag remains intact, CLI removal is coherent with retaining the live web
  compatibility route, and the documentation accurately marks deferred work.
  The shared roadmap status paragraph may conflict during the final stack and
  must be reconciled rather than blindly accepted.

## Blockers and risks

- The final PR 7 stack cannot be assembled until PR 5 and PR 6 finish.
- Removing the API restart/revision routes on the PR 2 base would break current
  web callers, so that work is deliberately not part of this provisional
  commit.

## Next action / handoff

Complete wrap-up review, commit the disjoint cleanup, and retain the branch
locally for later rebasing and completion on top of PR 5 and PR 6.
