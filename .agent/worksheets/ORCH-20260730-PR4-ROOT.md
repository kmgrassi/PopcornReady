# Worksheet: ORCH-20260730-PR4-ROOT

<!-- agent-summary: Durable record for selective-regeneration roadmap PR 4. -->
<!-- agent-summary: This slice adds inert root story, assembly, and critique executors. -->
<!-- agent-summary: Root adapters consume approved prospective bindings without moving live pointers. -->
<!-- agent-summary: Story snapshots preserve stable relational row identities and immutable history. -->
<!-- agent-summary: Production registration and atomic application remain owned by roadmap PR 5. -->
<!-- agent-summary: Use worksheet/ORCH-20260730-PR4-ROOT as the completion tag. -->
<!-- agent-summary: Reviews, commands, risks, and PR evidence are recorded below. -->

## Goal and acceptance criteria

Implement roadmap PR 4 behind PR 2's executor interface: stage immutable
root-owned story snapshots, assemble a pooled cut from prospective approved
bindings, critique that prospective cut, and expose explicit completion and
follow-up-proposal semantics. Do not register any root executor in production
or move a live selection/story pointer before PR 5.

Acceptance requires:

- story revisions preserve the target row ID and link the staged snapshot to
  its pinned predecessor;
- assembly consumes only approved prospective bindings and preserves the prior
  active cut;
- critique consumes the prospective cut, surfaces retryable failure, and may
  recommend a successor proposal but never executes one recursively;
- media-neutral story work does not invent media output;
- production registry remains inert.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`, `docs/NORTH_STAR.md`
- `docs/domain-agent-orchestration-contract.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `apps/api/src/lib/tool-tests/README.md`

## Research

- PR 2 executes capability adapters through exact output bindings and persists
  every executor step before fan-in. Completed bindings are available through
  `resolveCompletedBindings()`.
- The current assembly and critique tools read active selections/pointers and
  activate their outputs. PR 4 needs a prospective, pooled boundary instead.
- PR 3A/B/C currently own visual-still, video, and audio adapter files. PR 4
  will use distinct root-executor/service files and avoid their implementation
  surfaces.
- The final transaction already requires exact primitive-action, budget, asset,
  and reconciliation causation. Root adapters must use the dispatch action as
  their deterministic primitive identity and settle even zero-cost reservations.

## Decisions

- Keep the production registry inert and make canonical root services explicit
  injected dependencies. PR 5 owns reviewed live-service wiring.
- Use exact target-aware story pointer move + pin pairs. Project,
  storyboard, scene, and beat targets retain their stable row identities while
  their staged assets use `story_blueprint`, `plan`, `plan`, and `beat` graph
  kinds respectively.
- Resolve prospective assets only through exact completed output bindings.
  Reject unknown, changed, or duplicate binding identity before assembly or
  critique.
- Reserve and settle explicit zero-cost ledger entries only for deterministic
  story/assembly services. Critique carries a service estimate and measured
  actual; returned provider spend settles before an estimate overage is
  terminalized, while a pre-result model failure retains its reservation for
  recovery.
- Persist an optional critique successor as inert durable provider metadata,
  excluded from primitive output causation. Never approve or execute it
  recursively.
- Keep the rerun work dispatch running until fenced completion validates the
  pooled output and settled budget. Generic child-domain finalization cannot
  apply or fail an active proposal work dispatch.

## Changes

- Added inert root story, prospective assembly, and prospective critique
  executor adapters.
- Added exact story target/pointer/pin checks, prospective binding fan-in,
  preservation pin checks, idempotency keys, measured child budget handling,
  and inert follow-up proposal metadata.
- Added target-aware durable output-kind validation for story snapshots while
  retaining the reviewed still/video/audio normalization.
- Added database enforcement that preserves active rerun dispatch actions until
  fenced work completion, plus measured-cost settlement that records provider
  overages instead of stranding reservations.
- Added the owning root-adapter contract and task feedback record.

## Validation evidence

- Focused root/lifecycle/transaction set: 37 passed after review hardening.
- API, web, and shared typechecks plus shared type fixtures passed.
- Migration tests/validation passed with 91 migrations.
- `pnpm agent:validate -- --scope all` passed, including RPC and relation
  boundaries at 48 targets / 47 expressions and 424 literal / zero dynamic
  relation calls.
- Development API health smoke on port 4014 returned `status: ok` with the
  creative-director hierarchy enabled.

## Independent reviews

- Research/plan review approved the adapter/service split with two constraints:
  provider-backed critique must preserve and measure cost, and staged story
  snapshots must carry exact stable row-to-snapshot identities without pointer
  mutation. It also required stale/missing/extra binding, crash replay, and
  non-recursive critique-follow-up coverage; these are in the focused tests.
- Independent implementation review requested four durability corrections:
  atomic dispatch application, inert follow-up metadata, settlement before
  overage failure, and post-result crash replay. The executor no longer updates
  actions, `completeWork` alone applies a running dispatch, successor identity
  is not primitive causation, measured overages settle first, and tests prove a
  replay reuses one staged asset and one durable settlement.

## Blockers and risks

- PR 5 still owns dependency-aware production activation and atomic
  selection/story-pointer application.

## Next action / handoff

- Run implementation review, application smoke, repository validation, and
  publish the ready stacked PR.
