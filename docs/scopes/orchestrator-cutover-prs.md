# Orchestrator cutover — V1 keep/replace/delete + PR roadmap

Tracks the work to move Popcorn Ready's live generation **off the V1 staged
engine and onto the orchestrator tool-calling loop** — an agent that calls one
server-owned tool per turn, runs autonomously to a finished video by default, and
recomputes only affected assets via the asset graph. Scoped into PRs that
parallelize; each lists its dependencies.

> **This is a proposed breakdown — edit freely.** There are **no production
> users**, so there is **no backwards-compatibility constraint**: we migrate
> forward and delete the old controller outright (per
> [`CLAUDE.md`](../../CLAUDE.md) "No legacy/compat code"). Current progress and
> the concrete next-step ordering live in
> [Execution status & next steps](#execution-status--next-steps-updated-2026-06-15) below.

## Execution status & next steps (updated 2026-06-15)

Verified against the codebase on 2026-06-15. This section is the live status
overlay on the roadmap below; update it as PRs land.

### Why this section exists

The live "generate" button (`POST /projects/:id/generation-entrypoints/prompt`)
still drives the **V1 staged controller**, which persists run state into the
`generation_runs.gates` JSONB column — the temporary compatibility bridge this
cutover exists to delete. That column violates the asset-graph data-model rule
(product structure — stages, items, artifacts, review-gate state — hidden in
loose JSONB) and recently broke run creation outright (a schema-marker mismatch
against `generation_runs_gates_schema_check`). The fix is **not** to harden the
bridge; it is to finish the cutover so the column is deleted, with gates living
in the relational `orchestrator_run_gates` table that already exists.

### Verified state

- **PR 1 ✅** — tool-call harness merged. Batteries fail loud if a declared tool
  lacks one; unwired tools carry `pending` batteries (`lib/tool-tests/`).
- **PR 2 ✅** — orchestrator engine is in place: `runOrchestratorToCompletion` /
  `resumeOrchestratorRun` (`lib/orchestrator/engine.ts`) drive turns to
  completion, park on async jobs + approval gates, and resume. The relational
  run model (`lib/api/v1/orchestrator-store.ts`) covers `orchestrator_runs`,
  `orchestrator_run_gates`, and `actions`.
- **PR 3.x 🟡 — 3 of ~13 tools wired** in
  `lib/orchestrator-tools/default-registry.ts`: `create_or_load_brief`,
  `plan_shots`, `generate_storyboard`. The rest exist only as `pending`
  batteries. No media tools (keyframe/clip/audio/export) are wired yet.
- **PR 4 ❌** — no live orchestrator route exists; only the dev-only harness
  endpoint (`routes/v1/dev-tool-tests.ts`). The generate button still hits V1.
- **PR 5 ❌** — blocked on PR 4 parity. Deletion is additionally blocked by
  `lib/api/v1/store.ts` reading `generation_runs` in `assertRunBudgetAllows`
  (~`:887`) and `WorkspaceGenerationRunSummary` (~`:3109`).

### Ordered next steps

**Phase A — finish the media tool chain (critical path; one PR per tool).** Each
tool: back it with the existing `lib/generative/*` + `packages/agent` primitives,
declare preconditions, write `assets` + `asset_edges` + `selections`, register in
`default-registry.ts`, and replace its `pending` battery with real cases incl.
the schema-rejection invariant. Ordered by data dependency:

1. `plan_visual_anchors` → 2. `generate_anchor` → 3. `generate_keyframe`
   (minors must route to Gemini, not OpenAI image-edit) → 4. `generate_clip` →
   5. `generate_audio` → 6. `assemble_timeline` → 7. `critique_timeline` →
   8. `export_video`. Plus `request_approval` (the gate tool) and, if still in
   scope, `develop_story_blueprint` / `draft_script`. These parallelize except
   where one consumes another's asset.

**Phase B — PR 2.5 detangle (concurrent with A).** Extract
`briefToStoryContext` / `assetToClip` out of `lib/v1/generation/prepare.ts` into
a shared util; repoint `assertRunBudgetAllows` + `WorkspaceGenerationRunSummary`
off `generation_runs` onto `orchestrator_runs` + `actions`. Unblocks deletion.

**Phase C — PR 4 flip the live route (where the relational gate model surfaces).**
Replace the `generation-entrypoints/prompt` handler: from the prompt + the
up-front gate selection, create an `orchestrator_run` + its
`orchestrator_run_gates` rows, kick `runOrchestratorToCompletion`, return the
`runId` (default: no gates → fully autonomous). Replace the run-status/gate API
(`routes/v1/generation-runs.ts`) with orchestrator reads (`getOrchestratorRun`,
`listRunGates`, `resolveGate`) — the UI now reads gates from the relational
table, and progress is a projection over `actions` + jobs. Behind
`POPCORN_ORCHESTRATOR_TOOL_LOOP`; wire the gate-selection UI in `apps/web`.

**Phase D — PR 5 delete.** Remove the DELETE-bucket files; additive **drop**
migration for `generation_runs` (the `gates` column dies with it) — no history
rewrite. Done when nothing imports `lib/v1/generation-runs` and `store.ts` no
longer reads `generation_runs`.

### Outcome for the JSONB question

`gates` is not reduced or re-marked — it is **deleted** in Phase D. Gates become
relational `orchestrator_run_gates` rows. The only run-model JSONB that survives
is the structured `error` payload on `orchestrator_runs`, which the data-model
rule explicitly allows.

## Design is owned elsewhere — this doc is the execution plan

This roadmap **consumes** the existing design docs rather than restating them:

- [`structured-outputs-to-tool-calls.md`](structured-outputs-to-tool-calls.md) —
  the target contract: server-owned tools, the orchestrator decides order, the
  server keeps validation/persistence/jobs/auth.
- [`north-star-orchestrator-tools.md`](north-star-orchestrator-tools.md) — the
  tool-contract layer + self-healing loop + precondition vocabulary.
- [`north-star-unified-engine.md`](north-star-unified-engine.md) — the staged
  engine the orchestrator replaces/hosts.
- [`generation-engine-media-stages-prs.md`](generation-engine-media-stages-prs.md)
  — resolve-or-generate + per-beat durability; the media primitives to reuse.
- [`../NORTH_STAR.md`](../NORTH_STAR.md) — the authoritative vision.

What's **new here**: the concrete keep/replace/delete decision on the existing V1
code, the PR ordering with the test harness as the gate, and the autonomy/gate
default.

## The decision: V1 is two layers with opposite fates

"Keep V1 or delete V1?" is the wrong question — V1 is **two layers**:

- **The capability/framework layer → KEEP.** The asset-graph store
  (`lib/api/v1/store.ts`: assets, projects, workspaces, actions, selections,
  storyboards), the asset/project/brief/timeline/plan **API routes**, the agent
  LLM functions (`packages/agent`: `planEdit`, `critique`, `selectClips`), the
  media-generation primitives (`lib/generative/*`: keyframe, clip, audio,
  storyboard-tile, providers), and the job system (`lib/agent-api`,
  `lib/v1/store.ts` job/timeline persistence). **The orchestrator tools call
  directly into this** — the wired `create_or_load_brief` tool already does
  (`store.addProjectBrief`).
- **The forward-only staged *controller* → DELETE.** `runGenerationJob`
  (`lib/v1/generation.ts`), `run-execution.ts`, the 9-stage ordering + seed
  stages, `story-flow-tools.ts`, and the per-stage review-gate machinery. This is
  the model [`NORTH_STAR.md`](../NORTH_STAR.md) explicitly says **not to
  entrench**, and it's only a partial driver anyway — it runs
  `plan → storyboard → timeline → critique` and **never executes
  keyframe/clip/audio/export** (see generation-engine-media-stages-prs.md).
- **The run lifecycle → REPLACE.** `lib/v1/generation-runs/*` (stage-oriented
  run/stage/artifact persistence + progress + status) is superseded by an
  orchestrator-native run model (runs / turns / tool-invocations), ideally folded
  onto the asset-graph `actions` table per North Star.

### Boundary table (the part that must be detangled)

| V1 surface | Bucket | Note |
| --- | --- | --- |
| `lib/api/v1/**` (store, assets, projects, brief, schemas, auth, jobs, provenance) | **KEEP** | The durable framework; tools read/write here. |
| `lib/generative/**`, `lib/agent-api/**`, `packages/agent/**` | **KEEP** | Media/job/agent primitives tool handlers call. |
| `lib/v1/store.ts`, `supabase-client.ts`, `actor.ts`, `logger.ts`, `redact.ts`, `errors.ts`, `http.ts` | **KEEP** | Job/timeline persistence + shared utils. |
| `lib/v1/generation/{create-job,prepare,storyboard}.ts` | **KEEP** | Job record + `briefToStoryContext`/`assetToClip` + tile fan-out. |
| `lib/v1/generation-runs/**`, `generation-progress.ts`, `eval/inline-hook.ts` | **REPLACE** | Stage-run lifecycle → orchestrator run model. |
| `routes/v1/generation-runs.ts` | **REPLACE** | Stage-run + gate API → orchestrator-run API. |
| `lib/v1/generation.ts`, `generation/run-execution.ts`, `generation/story-flow-tools.ts`, `generation-runs/recovery.ts` | **DELETE** | The forward-only controller. |
| `routes/v1/generations.ts`, `routes/v1/generation-entrypoints.ts` | **DELETE** | Staged-engine entry/runner routes. |
| `lib/generation-run/fixtures.ts`, `lib/oneshot/*` | **DELETE** | Staged-run fixtures / orphaned (verify before delete). |

### Cross-boundary couplings to sever first

KEEP code currently reaches into REPLACE/DELETE code — these block deletion:

1. `briefToStoryContext` + `assetToClip` live in `lib/v1/generation/prepare.ts`
   (adjacent to the controller) but are pure transforms imported by KEEP code
   (`lib/api/v1/plan.ts`, `routes/v1/timelines.ts`, `lib/v1/assemble.ts`).
   → **Extract to a shared util** (`packages/shared` or `lib/story-context`).
2. `lib/api/v1/store.ts` (KEEP) imports `lib/v1/generation-runs/store` and queries
   the `generation_runs` table directly (`assertRunBudgetAllows`, workspace run
   summaries). → **Repoint at the orchestrator run model** once it exists.

## Gating model (confirmed)

**Autonomous by default.** A run with no gates goes prompt → finished video with
**no user round-trips**. The UI prompts the user up front — "which steps do you
want it to stop at?" — and if they select none, the run is fully autonomous.

- Gates are an **opt-in, per-run** set chosen before the run starts.
- Mechanism already modeled in the driver: a tool returns `waiting_for_approval`
  (→ run parks on an approval gate) only when a gate is requested; otherwise the
  loop keeps selecting the next tool. Async media tools return `accepted` + a
  jobId and the loop parks on the job, resuming when it terminates.
- "Checks at each step" = **tool preconditions** (the declared but unused
  `PreconditionMiss` / `unmetRequirements` / `suggestedNextTools` contract): each
  tool fails fast with an actionable miss if its inputs aren't in the asset graph,
  and the loop self-heals by calling the suggested tool. State passes stage→stage
  **through the asset graph** (assets/edges/selections), not through raw in-prompt
  outputs — `priorResults` is only the model's short-term memory.

## PR roadmap (ordered; harness gates every step)

> **PR 1 + PR 2 are done; PR 3.x is 3/13 wired (as of 2026-06-15 — see
> [Execution status](#execution-status--next-steps-updated-2026-06-15)).** Each
> generation-tool PR (PR 3.x) is independently reviewable and verified by its
> harness battery before the live flip (PR 4).

- **PR 1 — Tool-call test harness ✅ (merged, [#317](https://github.com/kmgrassi/PopcornReady/pull/317)).**
  The end-to-end rig: dev endpoint + CLI, throwaway sandbox + teardown, one
  battery per tool. Verifies "model calls the right tool with schema-valid input
  and the real DB write succeeds" as each tool is wired.

- **PR 2 — Autonomous orchestrator engine (backbone). ✅ done.** Depends on PR 1.
  - Persist runs / turns / tool-invocations (new tables, or projected onto the
    asset-graph `actions` table — coordinate with store-consolidation).
  - The **multi-turn driver loop**: re-invoke the model until `done` /
    `export_video` completes; park on `accepted` jobs and `waiting_for_approval`
    gates and resume; thread accumulated `priorResults`; enforce the per-run gate
    set (default: none → fully autonomous) + a crude cost guardrail.
  - This is where the end-to-end one-shot lives. No new generation capability yet
    — drives the existing `plan_shots` + `create_or_load_brief` tools to prove the
    loop runs autonomously start→finish.

- **PR 2.5 — Detangle the keep/delete boundary.** Can run concurrent with PR 2.
  Extract `briefToStoryContext`/`assetToClip` to a shared util; repoint
  `lib/api/v1/store.ts` off `generation_runs` onto the PR 2 run model. Unblocks
  deletion in PR 5.

- **PR 3.x — Wire the generation tools (parallelizable, one per tool).**
  Depends on PR 2. Each backs an orchestrator tool with the **existing**
  `lib/generative/*` primitives + `packages/agent` functions, implements its
  preconditions, writes assets+edges+selections (resolve-or-generate, per-beat
  durability — see generation-engine-media-stages-prs.md), and **replaces its
  `pending` harness battery with real cases** (✅ = wired as of 2026-06-15):
  `plan_shots` ✅ (persists the plan asset) · `generate_storyboard` ✅ ·
  `plan_visual_anchors` · `generate_anchor` · `generate_keyframe` ·
  `generate_clip` · `generate_audio` · `assemble_timeline` · `critique_timeline`
  · `request_approval` · `export_video` · `develop_story_blueprint` ·
  `draft_script`. (`create_or_load_brief` ✅ landed with PR 2.)

- **PR 4 — Flip the live route.** Depends on PR 2 + enough of PR 3.x for a full
  video. Point the generation entrypoint (and the UI's "generate" action) at the
  orchestrator engine behind `POPCORN_ORCHESTRATOR_TOOL_LOOP`; run a real prompt
  end-to-end autonomously; wire the gate-selection UI.

- **PR 5 — Delete the staged controller.** Depends on PR 2.5 + PR 4 parity.
  Remove the DELETE-bucket files + the REPLACE-bucket staged run lifecycle once
  nothing imports them. Drop `generation_runs`/stage tables via an additive
  drop+create migration (no history rewrite — see
  [`../no-migration-history-rewrites`](../../CLAUDE.md)).

## Definition of done

- A prompt with no gates produces a finished video through the orchestrator loop
  with zero user round-trips; a prompt with gates pauses only at the selected
  steps.
- Every wired tool has a green harness battery, including a schema-rejection
  invariant case.
- The `lib/v1` staged controller + `routes/v1/generations*.ts` are gone; nothing
  imports `lib/v1/generation-runs`; `lib/api/v1/store.ts` no longer reads
  `generation_runs`.
