# Worksheet: ORCH-20260801-COMPLETION-REPAIR

<!-- agent-summary: Durable record for repairing malformed finite-domain terminal completions. -->
<!-- agent-summary: A production Visuals run created and persisted its requested image before report validation failed. -->
<!-- agent-summary: Repair retries only the no-tools terminal response and never regenerates successful media. -->
<!-- agent-summary: Trusted criteria and validated run-owned output ids define the correction contract. -->
<!-- agent-summary: Regression coverage must reproduce malformed evidence after a successful async asset job. -->
<!-- agent-summary: Validate the focused engine path and run the API locally before handoff. -->
<!-- agent-summary: Link independent reviews, feedback, validation, commit, tag, and ready pull request here. -->

## Goal and acceptance criteria

Prevent a successfully generated finite-domain asset from being stranded when the specialist returns malformed terminal JSON. The engine must make a bounded completion-only correction attempt, preserve the successful action and asset, avoid invoking or charging for another media tool, finalize a valid corrected report, and retain terminal failure after repair exhaustion.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, `docs/repository-structure.md`
- `docs/NORTH_STAR.md`, `docs/domain-agent-orchestration-contract.md`
- `docs/scopes/orchestrator-step-durability.md`, `docs/scopes/specialist-agent-orchestration-prs.md`
- `docs/agent-system/testing-policy.md`, `docs/agent-system/reviews.md`
- `apps/api/src/lib/tool-tests/README.md`

## Decisions

- Treat report-shape correction as a separate no-tools model turn, not a normal orchestrator turn.
- Provide only trusted task criteria, validated run-owned output ids, and the safe validation message to the correction turn.
- Permit one correction attempt before preserving the existing terminal `invalid_input` behavior.

## Changes

- Added typed, repairable terminal-validation errors while keeping output-state
  and ownership failures non-repairable.
- Added one structured completion-only repair call with no tool registry and a
  trusted contract containing exact criteria, required bindings, and validated
  ready run-owned output metadata.
- Centralized the finite-domain terminal instruction/schema and reused it in
  Visuals, Audio, normal model turns, and correction turns.
- Revalidated repaired output through the existing report parser and preserved
  distinct `invalid_input`, `provider_failed`, and `timeout` outcomes.
- Added regression coverage for the production async-image sequence, repair
  exhaustion, state-error bypass, provider failure, prompt injection handling,
  timeout, malformed questions without outputs, bound-turn output guidance,
  unsatisfied evidence, and role-prompt parity.
- Addressed PR review feedback by validating unbound completion coverage with a
  one-asset-per-semantic-slot allocation derived from persisted asset roles.
- Split partial inventory authorization from complete output coverage so a
  malformed question can be repaired after partial work without weakening the
  normal `done` parser.

## Validation evidence

- Production Railway logs showed the Visuals tool job accepted, parked, reconciled, and resumed before the run terminalized.
- The operator projection showed the generated image job and stage succeeded while the run failed with `Domain done completion must include one acceptance evidence item per criterion.`
- The output asset remained persisted as a ready standalone image with durable storage.
- Local baseline reproduction passed: output validation succeeded first, then
  the empty `acceptanceEvidence` completion failed with the production error.
- API typecheck passed.
- Focused orchestrator suite passed after review fixes: 74 tests, 0 failures.
- `pnpm agent:lint:fix` passed.
- `pnpm agent:validate -- --scope api` passed, including lint, workflow policy,
  migration, RPC-boundary, relation-boundary, and API typecheck checks.
- Full API suite ran; all affected orchestrator tests passed. Two unrelated
  guest-retention tests failed because their historical migration fixtures
  `20260706120000_guest_retention_purge.sql` and
  `20260706150000_guest_retention_anonymous_user_purge.sql` are absent from the
  checked-in baseline.
- Local API started on port 4012 and `GET /api/v1/health` returned HTTP 200
  with `status: ok` and local auth. The background recovery worker logged the
  expected missing-Supabase warning because this worktree has no local service
  credentials; the HTTP server started and drained cleanly.

## Independent reviews

- Research: `/root/research_reviewer` confirmed that media generation and reconciliation succeeded, report validation failed afterward, and the engine currently provides no correction attempt.
- Plan: `/root/plan_reviewer` required a dedicated no-tools boundary, exact
  trusted binding context, parser reuse, non-repairable state errors, distinct
  provider/timeout handling, and explicit per-drive retry semantics; the
  implementation and tests follow those constraints.
- Implementation: `/root/implementation_reviewer` found three issues: unknown
  bound outputs were represented as an impossible empty inventory, no-output
  questions could not reach repair, and `done` accepted `satisfied: false`.
  All three were fixed with regression tests.
- Implementation re-review: `/root/implementation_reviewer` confirmed the
  original findings were resolved, then identified one question-option prompt
  conflict; the identifier restriction was narrowed and asserted in a test.
- Wrap-up: `/root/implementation_reviewer` found no remaining code or
  documentation issues. Its process-only request to record lint-fix and API
  validation is satisfied above.
- PR review plan: `/root/implementation_reviewer` required partial inventory to
  retain readiness, ownership, graph-kind, and semantic-role checks; semantic
  classification to derive from persisted assets; unknown roles to fail closed;
  and corrected `done` reports to retain full distinct coverage. The follow-up
  implementation and regression tests apply those constraints.
- PR implementation review: `/root/implementation_reviewer` found that partial
  inventory still needed an authoritative asset-readiness check and that bound
  semantic/duplicate claim validation needed direct tests. The asset query now
  requires `status = ready`, and pure bound-claim regressions cover both an
  image used for an anchor binding and one asset claimed for two bindings.
- PR wrap-up re-review: `/root/implementation_reviewer` confirmed both findings
  are resolved, the corrected `done` path remains authoritative, and no
  actionable code, test, or documentation findings remain.

## Blockers and risks

- The correction prompt must not trust or replay arbitrary raw creator content as instructions.
- A correction attempt must not expose tools, mutate graph state, duplicate costs, or broaden output ownership.

## Next action / handoff

- Commit and push the reviewed follow-up to the existing ready pull request.
