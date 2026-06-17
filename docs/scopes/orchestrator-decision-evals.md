# Orchestrator Decision Evals — Scope

## Objective

Verify, against a **real LLM**, that the orchestrator makes the **right routing
decision** at each high-level stage of the pipeline: given a fabricated
"state-so-far," does it pick an acceptable next tool (or stop)? This is the
narrow, cheap-to-check question — *routing*, not generation quality — and it is
exactly what the orchestrator model owns (`chooseTool` / `tool_choice: auto`).

This complements, and is deliberately lighter than:

- **`tool-tests/` batteries** (`pnpm --filter @popcorn/api test:tools`): real
  model + throwaway sandbox/DB + tool execution + DB assertions. Heavy; verifies a
  tool *runs* and persists correctly.
- **`packages/eval`** (the stage-eval / LLM-as-judge framework): grades generation
  *output quality* (story arc, keyframe on-prompt, stitched cut).

The decision evals sit below both: **no sandbox, no DB, no tool execution** — just
`orchestratorModel(fabricated state) → next-tool decision`, scored against an
acceptable set.

## Design

- **State is fabricated as `priorResults`** in the exact shape the model sees each
  turn (engine `toPriorResult`: `{ tool, status, outputAssetIds }`, plus error
  guidance on failures). The model only ever sees IDs + status, so the scenarios
  do too — no real assets needed.
- **Full tool vocabulary is exposed** every scenario (all 14 `TOOL_NAMES`), so the
  model must pick correctly among everything, as in production.
- **Acceptable-set assertions, not a single golden.** Each scenario lists `oneOf`
  acceptable next tools. The boundary transitions (fresh→brief, plan→visual prep,
  critique→export, exported→done) are tight and high-signal; the per-beat loop
  stages (keyframe/clip) are intentionally generous, because ID-level state alone
  cannot tell the model whether more beats remain.
- **Sampling.** A scenario can be sampled N times; it passes only if *every* sample
  is acceptable (`--samples 3` surfaces nondeterministic misroutes).

## Scenarios (`evals/scenarios.ts`)

The nine high-level steps as forward routing decisions, plus self-heal recovery:

| Scenario | State so far | Acceptable next |
|---|---|---|
| `step1_fresh_start` | nothing | `create_or_load_brief` |
| `step2_after_brief` | brief | `develop_story_blueprint` / `draft_script` / `plan_shots` |
| `step3_after_plan` | …plan | `plan_visual_anchors` / `generate_anchor` / `generate_storyboard` |
| `step4_after_anchors` | …anchors | `generate_storyboard` / `generate_keyframe` / `generate_anchor` |
| `step5_after_keyframes` | …keyframes | `generate_keyframe` / `generate_clip` |
| `step6_after_clips` | …clips | `generate_clip` / `generate_audio` / `assemble_timeline` |
| `step7_after_audio` | …clips + audio | `assemble_timeline` / `generate_clip` |
| `step8_after_assemble` | …timeline | `critique_timeline` / `export_video` |
| `step9_after_critique` | …critique | `export_video` |
| `step10_after_export` | …export | **done** |
| `recover_missing_brief` | `plan_shots` failed (needs brief) | `create_or_load_brief` |
| `recover_missing_keyframe` | `generate_clip` failed (needs keyframe) | `generate_keyframe` |

The recovery cases assert the system-prompt self-heal behavior: satisfy the
surfaced precondition, never blindly retry the failed tool.

## How to run

A real provider call per scenario, so it is **gated on an API key** and skipped
otherwise (CI stays green without secrets).

- As tests (one per scenario): `pnpm --filter @popcorn/api test` with a key in a
  repo-root `.env`/`.env.local` (or inline `OPENAI_API_KEY=…`).
- As a report: `pnpm --filter @popcorn/api evals:orchestrator` (add
  `-- --samples 3` for stability). Prints `PASS/FAIL  <id>  want […]  got […]` and
  exits non-zero if any scenario fails.

## Follow-ups

- **Calibrate acceptable sets** after observing real-model behavior; tighten the
  loop-stage sets if the model is consistently decisive.
- **Add ambiguity/negative cases** (e.g. should *not* export before a timeline
  exists; should *not* re-plan after a good plan).
- **Promote to CI** once stable: run `evals:orchestrator` on a schedule or on
  orchestrator-prompt changes, treating a drop as a regression — mirrors the
  meta-eval intent in `stage-eval-framework.md`.
- **Multi-turn variant**: extend from single-decision scoring to driving the full
  engine loop and asserting the whole tool *sequence* (builds on the propagation
  test added in #365).
