# Gate 0 — Creative-Director Hierarchy Adoption Record

<!-- agent-summary: This record decides whether the root creative-director hierarchy is worth activating. -->
<!-- agent-summary: The decision input is the repeated-sample Gate-0 decision baseline, never live billable generation. -->
<!-- agent-summary: Run pnpm --filter @popcorn/api evals:gate0 -- --samples 5 to measure both surfaces. -->
<!-- agent-summary: The material-improvement threshold must be agreed before the comparison run is scored. -->
<!-- agent-summary: The decision is currently PENDING; no baseline has been purchased yet. -->
<!-- agent-summary: A defer decision blocks PR 14 and hierarchy successors, never PRs 2 through 13. -->
<!-- agent-summary: Standalone domain creation (PRs 10-13) is a required product track independent of this gate. -->

Status: **PENDING** — instrumentation is merged (specialist-agents PR 1); the
opt-in real-model baseline runs have not been purchased or recorded yet.

Authoritative context:
[`specialist-agent-orchestration-prs.md`](specialist-agent-orchestration-prs.md)
("Decision Gate 0") and
[`orchestrator-decision-evals.md`](orchestrator-decision-evals.md) (the harness
this gate extends).

## What this gate decides

Whether replacing the flat all-tools root orchestrator with the proposed
creative-director hierarchy (root coherence tools + `delegate_visuals` /
`delegate_audio` dispatches + specialist Visuals/Audio registries) is justified
by a **measured, material improvement** in decision quality. More agents are
not automatically better; the hierarchy must earn the cutover.

Two things this gate explicitly does **not** decide:

- **PRs 2–13 proceed regardless.** The shared domain runtime, contract,
  schema, and Asset Studio work do not depend on a proceed outcome.
- **Standalone image/video/soundtrack creation (PRs 10–13) is a separate,
  required product track.** It is a product requirement in its own right and
  is not contingent on this eval result.

A **defer** decision blocks **PR 14 and hierarchy-specific successors
(PRs 15–19 root-cutover work)** only.

## Baseline dimensions and measured values

Both surfaces run the same fabricated project states through decisions only —
no tool execution, no live generation, no billable providers beyond the
decision LLM calls themselves. The flat surface is the real production
registry + orchestrator model; the hierarchy surface is the fixture-only
simulation in
`apps/api/src/lib/orchestrator/evals/hierarchy-fixture.ts`.

| Gate-0 dimension | Report metric | Flat production | Hierarchy fixture |
| --- | --- | --- | --- |
| Wrong next-tool decisions | `wrongTool` rate, overall + per family | PENDING | PENDING |
| Premature done | `prematureDone` on `premature_done` family (and overall) | PENDING | PENDING |
| Performance as history/tools grow | `long_context` + `tool_overload` family accuracy | PENDING | PENDING |
| Cross-modality coherence | `cross_modality` family accuracy | PENDING | PENDING |
| Recovery from precondition misses | `recovery` family accuracy | PENDING | PENDING |
| Unnecessary turns / repeated failed calls | `unnecessaryTurns` + `repeatedFailedCalls` counts | PENDING | PENDING |
| Selective regeneration with stable graph IDs | `selective_regeneration` family accuracy | PENDING | PENDING |

Record the raw JSON reports (`--json`) alongside this file or link the run
output in the PR that fills this table in.

## How to run the comparison (opt-in, billable)

Real-model runs require a provider key in a repo-root `.env`/`.env.local`
(`OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` with `LLM_PROVIDER=anthropic`).
Every sample is a billable decision call; there is deliberately no way to run
live generation from this harness.

```bash
# Repeated-sample baseline on both surfaces (recommended: 5 samples/scenario)
pnpm --filter @popcorn/api evals:gate0 -- --samples 5

# One surface at a time
pnpm --filter @popcorn/api evals:gate0 -- --surface flat --samples 5
pnpm --filter @popcorn/api evals:gate0 -- --surface hierarchy --samples 5

# Machine-readable output for recording in this document
pnpm --filter @popcorn/api evals:gate0 -- --samples 5 --json

# Free plumbing check (scripted decisions, NOT a baseline)
pnpm --filter @popcorn/api evals:gate0 -- --fixture
```

Run the comparison at least twice on different days before scoring it, and use
the same provider/model for both surfaces within a run. The per-scenario
live tests (`gate0-live-decision-evals.test.ts`) are pass/fail smoke checks;
the baseline that fills this record comes from the report script.

## Material-improvement threshold

**Status: PROPOSED — requires team agreement before the comparison is scored.**
Per the scope, the threshold must be agreed **before** running the comparison
so the result cannot be argued into either outcome afterwards.

Proposed threshold (edit here and mark AGREED when the team signs off):

1. The flat baseline must first show real suffering: overall accuracy below
   90%, or any single Gate-0 family below 80%, at ≥5 samples/scenario.
   If the flat root is not measurably failing, record **defer** — do not
   activate a hierarchy to fix a problem the data does not show.
2. Given (1), the hierarchy fixture must cut the overall non-acceptable rate
   (wrong tool + premature done + unnecessary turns + repeated failed calls)
   by **at least half relative**, or by **≥10 percentage points absolute**, on
   the same scenarios/samples/provider.
3. The hierarchy must not regress any individual family by more than
   5 percentage points accuracy.

## Decision

| Field | Value |
| --- | --- |
| Threshold agreement | PENDING |
| Flat baseline recorded | PENDING |
| Hierarchy fixture baseline recorded | PENDING |
| Which failure mode the hierarchy addresses | PENDING (name the failing family/metric from the flat baseline) |
| Decision (**proceed** / **defer**) | **PENDING** |
| Decided by / date | PENDING |

Consequences once decided:

- **Proceed** → PR 14 (root creative-director profile) may start; rollout
  still requires the separate gates in the scope's "Rollout gates" section.
- **Defer** → PR 14 and hierarchy-specific successors stay blocked; PRs 2–13,
  including the standalone Asset Studio product track, continue unaffected.
  Re-open this record with fresh baselines before reconsidering.
