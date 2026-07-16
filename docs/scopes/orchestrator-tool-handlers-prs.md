# Orchestrator tool handlers — sculpting unwired stages into parallel PRs

Sculpts the **remaining pipeline stages into one buildable PR per tool**. The
orchestrator engine is done ([`orchestrator-cutover-prs.md`](orchestrator-cutover-prs.md)
PR 1 + PR 2). The executable registry and harness batteries are the source of
truth for which capabilities are wired or pending; this historical breakdown
does not preserve a count that will drift. This doc is the **PR 3.x track** from
the cutover roadmap, exploded into independent, parallelizable scopes.

> **This is a proposed breakdown — edit freely.** There are no production users
> and no backwards-compat constraint (per [`CLAUDE.md`](../../CLAUDE.md) "No
> legacy/compat code"). Each tool PR is independently reviewable and gated by its
> [tool-test harness](../../apps/api/src/lib/tool-tests) battery before the live
> flip (cutover PR 4). The media *primitives* these tools call are scoped
> separately in
> [`generation-engine-media-stages-prs.md`](generation-engine-media-stages-prs.md)
> — **this doc wraps them as orchestrator tools; it does not re-scope the
> generators.**

## Principles aligned (from [`NORTH_STAR.md`](../NORTH_STAR.md))

- **Stages are tools the agent calls.** Each PR here adds one tool to the
  vocabulary the orchestrator model selects from — not a fixed conveyor stage.
- **Autonomous by default; stops are opt-in.** Only `request_approval` parks the
  run; everything else returns `succeeded`/`accepted` and the loop keeps going.
- **State flows through the asset graph.** Every tool reads its inputs from
  `assets`/`asset_edges`/`selections` and writes its outputs back with provenance
  edges — never through raw in-prompt text. `priorResults` is only the model's
  short-term memory.
- **Determinism lives in tool contracts, not order.** Each tool validates input,
  fails fast with an actionable `PreconditionMiss` + `suggestedNextTools`, and the
  loop self-heals by calling the suggested tool.
- **Resolve-or-generate / per-beat durability.** Media tools resolve a beat's slot
  from the pool first and only generate the gap; each asset is pooled + selected
  as it completes so re-entry recomputes only empty/invalidated slots.

## The repeatable contract (every tool PR implements this shape)

Read this once; each PR below only states what's *different*. Model the
implementation on the four wired tools —
[`plan-shots.ts`](../../apps/api/src/lib/orchestrator-tools/plan-shots.ts) (sync),
[`generate-storyboard.ts`](../../apps/api/src/lib/orchestrator-tools/generate-storyboard.ts) +
[`storyboard-job.ts`](../../apps/api/src/lib/orchestrator-tools/storyboard-job.ts)
(async + worker resume), and
[`plan-visual-anchors.ts`](../../apps/api/src/lib/orchestrator-tools/plan-visual-anchors.ts).

A tool PR adds **one file** `apps/api/src/lib/orchestrator-tools/<tool>.ts` exporting
a `create<Tool>Tool(deps)` factory that returns a
[`ToolDefinition<TInput, TOutput>`](../../apps/api/src/lib/orchestrator-tools/types.ts:122)
with:

1. **`name` / `description` / `usage`** — `usage.preconditions`, `usage.produces`,
   `usage.useWhen` are composed onto the description so the model picks the tool
   proactively instead of probing by trial-and-error.
2. **`inputSchema` / `outputSchema`** — JSON Schema with `additionalProperties:
   false`. Inputs are typically thin (`{ feedback?, revisionInstruction? }`);
   real state comes from the graph, not the call.
3. **`execution`** — `"sync"` (returns `succeeded` inline), `"async"` (enqueues a
   job, returns `accepted` + `jobId`, a `<tool>-job.ts` worker writes assets +
   calls `resumeOrchestratorRun`), or `"approval"` (returns
   `waiting_for_approval` + `gateId`).
4. **`parseInput`** — hand-validates and throws `ToolInputError` on bad shape
   (recoverable, `kind: "invalid_input"` — the schema-rejection invariant).
5. **Precondition checks in `execute`** — read required upstream assets via the
   `lib/api/v1/store` getters; if missing, return `status: "failed"` with
   `kind: "precondition_unmet"`, an `unmetRequirements[]` `PreconditionMiss`, and
   `suggestedNextTools` pointing at the tool that produces the missing asset.
6. **Asset-graph writes** — persist outputs via the store with `graphInputs`
   recording each upstream `{ assetId, relation: "input", role, contentHash }`
   for stale-detection, and set the active selection so the output becomes the
   project's current asset of that role.
7. **`estimateCost`** — best-effort `ToolCostEstimate` (media tools scale with
   beat/provider).

Then the PR:

8. **Registers the tool** — add the factory + its deps field to
   [`default-registry.ts`](../../apps/api/src/lib/orchestrator-tools/default-registry.ts)
   (one `registry.register(...)` line + one `DefaultToolRegistryDeps` field).
9. **Replaces the `pending` harness battery** in
   [`apps/api/src/lib/tool-tests/`](../../apps/api/src/lib/tool-tests) with real
   cases: model selects the tool with schema-valid input, the real DB write
   succeeds, **and** a schema-rejection invariant case.

## What already exists (reuse — do NOT reinvent)

- **Media/agent primitives (KEEP layer).** `lib/generative/*` (keyframe, clip,
  providers, character-anchors, elevenlabs, storyboard-tile) and `packages/agent`
  (`planEdit`, `critique`, `selectClips`). Per
  [`orchestrator-cutover-prs.md`](orchestrator-cutover-prs.md) these are the
  durable framework the tools call directly. The higher-level "generate one beat
  keyframe/clip" wrappers are being ported to a shared lib in
  [`generation-engine-media-stages-prs.md`](generation-engine-media-stages-prs.md)
  **PR G0** — media tools here should call those shared functions (coordinate so
  the orchestrator tool and the G0 wrapper are the *same* generator, not a fork).
- **Asset pool + resolve-or-generate.** `lib/assets/pool.ts`
  (`addAsset`/`setSelection`/`resolveActiveAsset`) and the `resolveBeatAsset`
  resolver (G1). Role enum in `packages/shared/src/assets/types.ts`.
- **Job system + run resume.** `lib/agent-api/jobs` (`createOrGetJob`) and
  `resumeOrchestratorRun` ([`engine.ts`](../../apps/api/src/lib/orchestrator/engine.ts)) —
  async tools fire a job and the worker resumes the parked run, exactly like
  `storyboard-job.ts`.
- **Approval gates.** The relational `orchestrator_run_gates` table +
  `waiting_for_approval` parking are already in the engine; `request_approval`
  only needs to open a gate row.

## Unwired-tool inventory

| Tool | Exec | Reads (graph) | Writes (graph) | Track | Status |
| --- | --- | --- | --- | --- | --- |
| `request_approval` | approval | (preview artifacts) | opens `orchestrator_run_gates` row | A (gate) | ⬜ todo |
| `develop_story_blueprint` | sync | brief | `story_blueprints` row + asset | B (text, off critical path) | ⬜ todo |
| `draft_script` | sync | brief / blueprint | `script_drafts` row + asset | B (text, off critical path) | ⬜ todo |
| `generate_anchor` | async | visual_anchor_plan | `character_anchor`/`scene_anchor` image assets | C (media) | ⬜ todo |
| `generate_keyframe` | async | plan beat + anchor + storyboard tile | `beat_keyframe` asset/beat | C (media) | ⬜ todo |
| `generate_clip` | async | `beat_keyframe` (first frame) | `beat_clip` asset/beat | C (media) | ⬜ todo |
| `generate_audio` | async | plan / script | `voiceover`/`soundtrack` assets | C (media) | ⬜ todo |
| `assemble_timeline` | sync | `beat_clip`s + audio + uploads | timeline | C (media) | ⬜ todo |
| `critique_timeline` | sync | timeline | critique/notes asset | C (media) | ⬜ todo |
| `export_video` | async | timeline | final output artifact | C (media) | ⬜ todo |

## PR roadmap (one PR per tool)

### PR T0 — `request_approval` (the gate tool) *(Track A — fully parallel, no data deps)*
- **Files:** new `orchestrator-tools/request-approval.ts`; register in
  `default-registry.ts`.
- **Contract:** `execution: "approval"`. Input names the step/artifacts to review
  (e.g. `{ step, previewArtifactIds, note? }`). `execute` opens an
  `orchestrator_run_gates` row and returns `{ status: "waiting_for_approval",
  gateId, resumesWhen: "approval_terminal", previewArtifactIds }`. The engine
  already parks on this and resumes on gate resolution (and allows one
  regeneration on reject).
- **Constraint — the parked gate must be UI-resolvable (`reached`), not
  `pending`.** Today gates are only inserted by `createOrchestratorRun` (the
  pre-selected set, as `pending`) in
  [`orchestrator-store.ts`](../../apps/api/src/lib/api/v1/orchestrator-store.ts):198
  — there is **no dynamic mid-run gate-insert helper yet**, so T0 must add one. The
  approve/reject routes only act on gates whose status is `reached`
  ([`routes/v1/orchestrator-runs.ts`](../../apps/api/src/routes/v1/orchestrator-runs.ts):
  `gates.find((c) => c.status === "reached")`). The **static** pre-selected-gate
  path transitions `pending → reached` via `markGateReached` when the model picks a
  gated tool ([`engine.ts`](../../apps/api/src/lib/orchestrator/engine.ts):368),
  **but the `waiting_for_approval` park branch (`engine.ts`:440) does not** — so a
  `request_approval` that merely inserts a `pending` row parks the run on a gate
  the UI can never approve or reject. Fix this **inside T0**: either (a —
  recommended) have the tool create the gate already in `reached` status (the loop
  *has* arrived — `reached` is the correct semantics), or (b) have the engine's
  `waiting_for_approval` branch call `markGateReached` on the returned `gateId`
  before parking. Do **not** widen the routes to resolve `pending` gates — that
  would also expose not-yet-reached static gates.
- **Why first / parallel:** depends only on the done engine + existing gate table
  — no upstream asset. Build it immediately alongside Track C. It's the mechanism
  the opt-in "stop at these steps" UX rides on.
- **Done when:** a run that selects this tool parks on a gate row in `reached`
  status; the existing approve/reject routes resolve it and the loop resumes;
  rejecting it allows one regeneration. Real harness battery replaces the
  `pending` one, **including a case asserting the parked gate is resolvable by the
  approve route** (the regression Codex flagged), plus schema-rejection.

### PR T1 — `generate_anchor` *(Track C — depends on `plan_visual_anchors` ✅)*
- **Files:** new `orchestrator-tools/generate-anchor.ts` + `generate-anchor-job.ts`.
- **Contract:** `async`. Precondition: an active `visual_anchor_plan` (else fail
  with `suggestedNextTools: [plan_visual_anchors]`). Worker generates one
  reference image per anchor (`character`/`location`/`style`) via
  `generateCharacterAnchor` / `lib/generative` providers; pools each as
  `character_anchor`/`scene_anchor` with `graphInputs` → the anchor-plan asset;
  resumes the run.
- **Constraint:** **minors → Gemini** (OpenAI image-edit rejects photorealistic
  minors).
- **Reuse:** `lib/api/v1/character-anchors.ts` `generateCharacterAnchor`, G0/G3
  decision logic — build the "does this anchor need generating?" check so the
  shared function and this tool agree.
- **Done when:** an anchor plan with a recurring character yields pooled anchor
  image assets with provenance edges; a plan with no anchors produces none.

### PR T2 — `generate_keyframe` *(Track C — depends on plan ✅ + storyboard ✅; integrates T1 anchors)*
- **Files:** new `orchestrator-tools/generate-keyframe.ts` + `generate-keyframe-job.ts`.
- **Contract:** `async`. Per-beat **resolve-or-generate**: `resolveBeatAsset(beat_keyframe,
  beatId)` first; only generate empty/invalidated slots. Generate via the G0
  `generateBeatKeyframe` (seeded by the storyboard sketch as structural-only
  reference + the T1 anchor for character invariants). Pool + select **per beat**
  for durability; `graphInputs` → plan beat + anchor + storyboard tile.
- **Constraint:** minors → Gemini; never use a `beat_storyboard` sketch as a
  photoreal first frame (guardrail already in `keyframe.ts`). Ideogram v3
  currently consumes only the first caller-ordered generic reference because its
  generate endpoint accepts one character-reference image; additional requested
  anchors/storyboard references remain provenance inputs but are not effective
  Ideogram conditioning until references carry typed character/style/structural
  roles and provider-aware routing.
- **Done when:** a run produces pooled `beat_keyframe` assets per beat with active
  selections + provenance; a beat with a filled/selected slot (incl. a user
  `upload`) is skipped.

### PR T3 — `generate_clip` *(Track C — depends on T2)*
- **Files:** new `orchestrator-tools/generate-clip.ts` + `generate-clip-job.ts`.
- **Contract:** `async`. Precondition per beat: a `beat_keyframe` (else
  `suggestedNextTools: [generate_keyframe]`). Resolve-or-generate `beat_clip`;
  generate via G0 `generateBeatClip` using the keyframe as first frame
  (`selectClipFirstFrame` guardrail). Pool + select per beat; `graphInputs` →
  `beat_keyframe`. Provider selection from job input (Sora/Veo/Cosmos/Runway/LTX).
- **Done when:** pooled `beat_clip` assets per beat with provenance back to their
  keyframe; pre-filled/uploaded clip slots are honored, not regenerated.

### PR T4 — `generate_audio` *(Track C — depends on plan ✅ / script; parallel to T1–T3)*
- **Files:** new `orchestrator-tools/generate-audio.ts` + `generate-audio-job.ts`.
- **Contract:** `async`. Reads the plan (and `draft_script` output if present) for
  narration text; generates `voiceover` per beat and/or a `soundtrack` via
  ElevenLabs (`lib/generative/providers/elevenlabs.ts`). Resolve-or-generate (a
  user-supplied VO/music asset is honored). Pools as `voiceover`/`soundtrack`.
- **Parallel:** consumes only text assets, so it runs concurrently with the visual
  chain (T1–T3) — no dependency on keyframes/clips.
- **Done when:** runs produce pooled audio assets with provenance; user-supplied
  audio is honored over generation.

### PR T5 — `assemble_timeline` *(Track C — depends on T3 (+ T4))*
- **Files:** new `orchestrator-tools/assemble-timeline.ts`.
- **Contract:** `sync`. Precondition: pooled `beat_clip`s (else
  `suggestedNextTools: [generate_clip]`). Feed the agent `selectClips`
  (`packages/agent`) the pooled `beat_clip` + `upload` + audio assets **with their
  `role`** (role-aware, not uploaded-footage-only) and persist a relational
  timeline with `graphInputs` → the selected clips/audio.
- **Reuse:** cross-refs G5 — surface `Asset.role` to the selection signal; build
  the selection input once so G5 and this tool share it.
- **Done when:** the assembled timeline references generated `beat_clip`s + any
  uploads, chosen by role/content, with provenance edges.

### PR T6 — `critique_timeline` *(Track C — depends on T5)*
- **Files:** new `orchestrator-tools/critique-timeline.ts`.
- **Contract:** `sync`. Precondition: an active timeline. Runs the agent
  `critique` over the assembled timeline and persists a critique/notes asset
  (`graphInputs` → timeline). The model uses it to decide whether to regenerate
  beats or proceed to export — pure advisory, no gate (that's `request_approval`).
- **Done when:** produces a persisted critique asset linked to the timeline; the
  loop can act on it (regenerate a beat or continue).

### PR T7 — `export_video` *(Track C — depends on T5)*
- **Files:** new `orchestrator-tools/export-video.ts` + `export-video-job.ts`.
- **Contract:** `async`. Precondition: an active timeline. Worker renders the
  timeline to a final artifact via the mounted `timelines/:timelineId/exports`
  render path; pools the output artifact (`graphInputs` → timeline); resumes the
  run. Back the workspace Outputs list so exports surface (cross-ref G6 / Studio
  redesign PR 9).
- **Done when:** a completed run yields a downloadable output artifact listed
  under the workspace, with provenance to its timeline.

### PR T8 / T9 — `develop_story_blueprint` / `draft_script` *(Track B — build, but off the media critical path)*
- **Owning design:** these two are **not** thin data-asset wrappers — they are the
  orchestrator-tool surface of the
  [`story-development-agent-handoff.md`](story-development-agent-handoff.md) scope:
  the "writing layer" (premise/arc/acts/characters → scene-level dialogue &
  narration) that the brief→`EditPlan` flow skips. Per that doc and the
  asset-graph rule, story blueprints and script drafts are **canonical creative
  artifacts**, so they get **dedicated relational tables**
  (`public.story_blueprints`, `public.script_drafts` — DDL sketched in the handoff
  doc), each linked back to its `brief`/`blueprint` asset for lineage. They are
  **not** stored as opaque JSONB data-assets.
- **Why off the critical path:** for short-form (≤30s) `plan_shots` works straight
  off the brief, so the media chain (T1–T7) does **not** depend on these. They
  matter for longer-form — the handoff doc's duration model makes the script draft
  *recommended* at 2m+ and *required* at 10m+, tied to the
  [`request_approval`](#pr-t0--request_approval-the-gate-tool-track-a--fully-parallel-no-data-deps)
  gates over 120s. So build them in parallel, but never block T1–T7 on them.
- **Sequencing within the track:** **T8a** lands the additive migration +
  store/read-write functions for `story_blueprints`/`script_drafts` (the table
  work the handoff scope specifies); **T8** then wires `develop_story_blueprint`
  (reads brief → writes a `story_blueprints` row + provenance asset); **T9** wires
  `draft_script` (reads brief/blueprint → writes a `script_drafts` row), whose
  output `generate_audio` (T4) reads for narration text when present. Standard
  sync-tool contract; `graphInputs` → brief/blueprint.
- **Coordinate, don't fork:** if the `story-development-agent-handoff` workstream is
  already building those tables, T8a is *that* PR — own it jointly rather than
  creating a parallel `story_blueprints` schema. This doc only owns the tool
  handlers (T8/T9); the table/migration is shared with the handoff scope.
- **Done when:** each tool reads its upstream and persists a relational row +
  provenance asset; `plan_shots` and `generate_audio` consume them when present; a
  ≤30s run still completes with neither (they're optional below the duration
  threshold).

## Dependency graph & parallelization

```
            (engine done — PR 1 + PR 2)
                       │
  ┌────────────────────┼─────────────────────────────────────┐
  │ Track A            │ Track C (media critical path)        │ Track B (off critical path)
  │                    │                                       │
  T0 request_approval  T1 generate_anchor ──► T2 generate_keyframe ──► T3 generate_clip ──┐
  (no deps, build now) │                                                                  │
                       T4 generate_audio (parallel; text only) ───────────────────────────┤
                            ▲                                                             ▼
                            │ (narration text, when present)                T5 assemble_timeline
                            │                                                  │          │
  T8a story tables ──► T8 develop_story_blueprint ──► T9 draft_script ─────────┘  T6 critique  T7 export
  (shared w/ handoff scope)        (build in parallel; T1–T7 never block on these)
```

- **Build immediately, no waiting:** **T0** (gate infra), **T4** (audio, text
  inputs only), and **Track B** (T8a→T8→T9, story-writing layer) have no
  dependency on the visual chain — assign them first to parallel agents.
- **Track B is parallel, never blocking:** T1–T7 must complete a ≤30s video with
  no blueprint/script present. T9's script is an *optional* narration input to T4,
  not a precondition.
- **Visual chain order:** T1 → T2 → T3 are a data chain, but each is independently
  reviewable behind its harness battery, so an agent can start T2/T3 against the
  upstream asset *contract* before T1 merges (stub the upstream asset in tests).
- **Converge at T5:** `assemble_timeline` needs clips (T3) and ideally audio (T4);
  **T6** and **T7** both depend only on T5 and parallelize after it.
- **Track B owns its own table work:** T8a (the `story_blueprints`/`script_drafts`
  migration) gates T8/T9 but is shared with the
  [story-development-agent-handoff](story-development-agent-handoff.md) scope —
  build it once, jointly, not twice.

## Merge hotspots

- **`default-registry.ts` is the one shared edit** every PR touches (one
  `register()` line + one `DefaultToolRegistryDeps` field). With 8–10 parallel
  PRs this *will* conflict. **Recommendation:** keep each PR's change to a single
  appended `register(create<Tool>Tool(deps.<tool>))` line and a single deps field
  so conflicts are trivial three-way merges; or land registration in a fixed tool
  order. Do **not** refactor the registry shape inside a tool PR.
- **`lib/tool-tests/` batteries** — each tool owns its own battery file, so no
  collision as long as PRs don't share a spec file.
- **`generation.ts` / `selectClips`** — T5 here overlaps G5 in
  [`generation-engine-media-stages-prs.md`](generation-engine-media-stages-prs.md);
  same owner or build the role-aware selection input once and share it.

## Relationship to the other scopes

- [`orchestrator-cutover-prs.md`](orchestrator-cutover-prs.md) — **this doc is its
  PR 3.x track, exploded.** The cutover doc owns the live-route flip (PR 4) and the
  staged-controller deletion (PR 5); those land *after* enough tools here exist for
  a full video.
- [`generation-engine-media-stages-prs.md`](generation-engine-media-stages-prs.md)
  — owns the **media primitives** (G0 port, G1 resolver, G3 anchor decision).
  T1–T7 here are the orchestrator-tool wrappers around those generators — reuse,
  don't fork. If a G-stage and a T-tool generate the same asset, they must call the
  same shared function.
- [`north-star-orchestrator-tools.md`](north-star-orchestrator-tools.md) — the
  tool-contract + self-healing-loop design these handlers implement.
- [`../NORTH_STAR.md`](../NORTH_STAR.md) — the authoritative vision.

## Definition of done

- Every declared tool is registered in `default-registry.ts` — no tool resolves to the
  `failedUnimplemented` stub anymore. The two story-writing tools persist to their
  relational `story_blueprints`/`script_drafts` tables (shared with the
  [story-development-agent-handoff](story-development-agent-handoff.md) scope), not
  to loose JSONB.
- Every wired tool has a green harness battery including a schema-rejection
  invariant case; no battery is still `pending`.
- An autonomous prompt drives brief → plan → anchors → storyboard → keyframes →
  clips → audio → timeline → critique → export through the orchestrator loop with
  zero user round-trips, every artifact pooled with provenance edges; a gated
  prompt parks only at the steps the user selected via `request_approval`.
- Re-entry recomputes only empty/invalidated beat slots — regenerating one beat
  leaves the others untouched.
