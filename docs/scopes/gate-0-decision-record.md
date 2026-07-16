# Gate 0 — Creative-Director Hierarchy Decision Record

<!-- agent-summary: Gate 0 is resolved: PROCEED with the creative-director hierarchy, recorded 2026-07-16. -->
<!-- agent-summary: The decision was made on modularity and observability grounds, not a measured decision-quality comparison. -->
<!-- agent-summary: The decision-eval harness is repurposed as the non-inferiority regression bar for the PR 18 default-on cutover. -->
<!-- agent-summary: Before default-on routing, the hierarchy must route at least as well as the flat root on the paired scenario matrix. -->
<!-- agent-summary: Run pnpm --filter @popcorn/api evals:gate0 -- --samples 5 to measure both surfaces when PR 14/18 near landing. -->
<!-- agent-summary: The comparison is paired-scenario and fixture-only; never compare via live billable generation. -->
<!-- agent-summary: Standalone domain creation (PRs 10-13) is a required product track that was never contingent on this gate. -->

Status: **PROCEED — recorded 2026-07-16.** The creative-director hierarchy is
adopted on engineering and product grounds; the "defer" branch of this gate is
retired. The eval harness built for this gate is **repurposed as the
non-inferiority regression bar** that the PR 18 default-on cutover must clear.

Authoritative context:
[`specialist-agent-orchestration-prs.md`](specialist-agent-orchestration-prs.md)
("Decision Gate 0 — resolved: proceed with the root hierarchy") and
[`orchestrator-decision-evals.md`](orchestrator-decision-evals.md) (the harness
this record's regression bar runs on).

## The decision

**PROCEED (2026-07-16), decided on design grounds** rather than a measured
decision-quality comparison. Rationale, per the scope amendment:

- **Modularity:** each agent carries a small role-scoped prompt and registry,
  which is easier to program, test, and debug than one all-tools decision
  surface.
- **Observability:** creators cannot currently see what background generation
  is doing. Persistent domain sessions plus typed `done | blocked | question`
  reports give the observe-first UI
  ([`ui-interaction-model.md`](../ui-interaction-model.md), PR 17) a real
  hierarchy to narrate — which agent is working, on what, and what was handed
  off.
- Both architectures are judged capable of routing correctly; raw capability
  was not the deciding question.

Consequences:

- **PR 14 depends only on PRs 10–11** and no longer waits on a billable
  baseline study. Hierarchy work may start now.
- Default-on creative-director routing (PR 18) still requires the
  **non-inferiority regression bar** below, plus the scope's other rollout
  gates.
- **PRs 2–13 were never contingent on this gate.** In particular, standalone
  image/video/soundtrack creation (PRs 10–13) is a separate, required product
  track on its own product merits.

## The non-inferiority regression bar (blocks PR 18 default-on, not PR 14)

The harness's role changed from adoption gate to regression bar: before
creative-director routing is enabled **by default**, the hierarchy surface
must route **at least as well as** the flat root on the same paired
repeated-sample scenario matrix, across:

- wrong next-tool or premature-done decisions;
- performance as project history and available tools grow;
- cross-modality coherence decisions;
- recovery from within-domain and cross-domain precondition misses;
- unnecessary turns and repeated failed calls; and
- selective-regeneration decisions with stable graph IDs.

**The comparison is paired-scenario.** Every scenario in the Gate-0 matrix is
scored on BOTH surfaces: its flat form against the real production registry +
orchestrator model, and its deterministic hierarchy projection
(`apps/api/src/lib/orchestrator/evals/paired-projection.ts` — leaf media
history/expectations map onto `delegate_visuals`/`delegate_audio`, in-domain
self-heal failures project onto the specialist surface) against the
fixture-only simulation in
`apps/api/src/lib/orchestrator/evals/hierarchy-fixture.ts`. Both sides share
the same scenario ids, sample counts, and provider, so neither surface can
look better merely by being measured on a smaller or easier matrix. The
hand-written hierarchy-only cases run as `hierarchyDiagnostics` and are
**excluded from the regression comparison**. Both surfaces run decisions only
— no tool execution, no live generation, no billable providers beyond the
decision LLM calls themselves.

| Regression-bar dimension | Report metric | Flat production | Hierarchy fixture |
| --- | --- | --- | --- |
| Wrong next-tool decisions | `wrongTool` rate, overall + per family | PENDING | PENDING |
| Premature done | `prematureDone` on `premature_done` family (and overall) | PENDING | PENDING |
| Performance as history/tools grow | `long_context` + `tool_overload` family accuracy | PENDING | PENDING |
| Cross-modality coherence | `cross_modality` family accuracy | PENDING | PENDING |
| Recovery from precondition misses | `recovery` family accuracy | PENDING | PENDING |
| Unnecessary turns / repeated failed calls | `unnecessaryTurns` + `repeatedFailedCalls` counts | PENDING | PENDING |
| Selective regeneration with stable graph IDs | `selective_regeneration` family accuracy | PENDING | PENDING |

These measurements are **not a prerequisite for starting hierarchy work**
(PRs 14–17 development proceeds); they gate only the PR 18 default-on cutover.
Fill the table when PR 14/18 near landing, and record the raw JSON reports
(`--json`) alongside this file or link the run output in the PR that fills it.

## How to run the regression check (opt-in, billable)

Real-model runs require a provider key in a repo-root `.env`/`.env.local`
(`OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` with `LLM_PROVIDER=anthropic`).
Every sample is a billable decision call; there is deliberately no way to run
live generation from this harness.

```bash
# Repeated-sample comparison on both surfaces (recommended: 5 samples/scenario)
pnpm --filter @popcorn/api evals:gate0 -- --samples 5

# One surface at a time
pnpm --filter @popcorn/api evals:gate0 -- --surface flat --samples 5
pnpm --filter @popcorn/api evals:gate0 -- --surface hierarchy --samples 5

# Machine-readable output for recording in this document: stdout carries
# exactly ONE JSON document { mode, comparison, samplesPerScenario,
# pairedScenarioCount, flat, hierarchy, hierarchyDiagnostics }; all banners
# go to stderr, so the output can be piped/redirected directly.
pnpm --filter @popcorn/api evals:gate0 -- --samples 5 --json > gate0-baseline.json

# Free plumbing check (scripted decisions, NOT a measurement)
pnpm --filter @popcorn/api evals:gate0 -- --fixture
```

Run the comparison at least twice on different days before scoring it, and use
the same provider/model for both surfaces within a run. Score the bar only on
the paired `flat` vs `hierarchy` reports; `hierarchyDiagnostics` (the unpaired
hand-written cases) is context, not bar input. The per-scenario live tests
(`gate0-live-decision-evals.test.ts`) are pass/fail smoke checks; the
measurements that fill this record come from the report script. Note the
hierarchy surface here is the fixture simulation; once PR 14 lands the real
root profile, prefer wiring the paired matrix to the real root registry before
the final PR 18 scoring.

## Non-inferiority threshold

**Status: PROPOSED — requires team agreement before the regression run is
scored.** Agree on the bar before running so the result cannot be argued into
either outcome afterwards.

Proposed threshold (edit here and mark AGREED when the team signs off):

1. At ≥5 samples/scenario on the paired matrix, the hierarchy's overall
   non-acceptable rate (wrong tool + premature done + unnecessary turns +
   repeated failed calls) must be **no more than 2 percentage points worse**
   than the flat root's on the same run.
2. No individual family's accuracy may regress by more than
   **5 percentage points** versus the flat root.
3. The `recovery` family specifically must show **zero additional**
   `repeated_failed_call` samples versus the flat root (blind retries are the
   costliest failure in production).

## Record

| Field | Value |
| --- | --- |
| Gate 0 decision | **PROCEED** |
| Decided / recorded | 2026-07-16, on design grounds (scope amendment PR #793) |
| Basis | Modularity + observability; capability judged equivalent, not deciding |
| Non-inferiority threshold agreement | PENDING |
| Flat regression measurement | PENDING (required before PR 18 default-on, not before PR 14) |
| Hierarchy regression measurement | PENDING (required before PR 18 default-on, not before PR 14) |
| PR 18 cutover bar cleared | PENDING |
