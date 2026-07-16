# North Star — Agent-Orchestrated, Non-Linear Video Generation

> **Status:** Vision + scope — **the foundation is now largely built.** This
> remains the authoritative reference for how generation should evolve. The
> data-model direction (§5) and the core orchestrator/tool runtime (§6–§7 P1/P2)
> have shipped against the asset graph; what's left is retiring the legacy Next
> monolith, feeding graph stale candidates into the agent's rerun decision path, and
> closing the feedback loop (§7 P3). New work (human or agent) should align to it;
> any deviation should be a conscious, documented decision. Last updated 2026-07-14
> (status pass; original design 2026-06-08).

## Implementation status (2026-06-22)

The 2026-06-08 original was forward-looking design; most of the foundation has
since landed. Map below (details inline per section). **§3 describes the model we
*replaced* — kept as a guardrail against reintroducing it, not current state.**

- ✅ **Asset-graph data model (§4; intent in §5)** — `assets` + `asset_edges` +
  `selections` + `actions` are the live trunk, with per-asset `inputs` /
  `inputs_fingerprint`, immutability + delete guards, and a `downstream_assets()`
  stale-candidate query
  (`supabase/migrations/20260610120000_asset_graph_model.sql`). It is now the
  authoritative model — see the **Asset-Graph Migration Rule** in `CLAUDE.md`.
- ✅ **Stable ids on every node (§4)** — relational storyboards
  (`storyboard_scenes` / `storyboard_beats` / `storyboard_panels`) carry stable ids
  and link to immutable asset snapshots via `*_asset_id`
  (`supabase/migrations/20260610130000_storyboard_relational_model.sql`).
- ✅ **Orchestrator + tools (§6; §7 P2)** — a durable run loop, autonomous through
  storyboard and explicitly continued into production
  (`apps/api/src/lib/orchestrator/engine.ts`; `orchestrator_runs` /
  `orchestrator_run_gates` tables), drives the registered tool surface
  (`apps/api/src/lib/orchestrator-tools/default-registry.ts`). **Pending:** restart
  / rerun decisions still need to consume `downstream_assets()` stale candidates
  instead of relying on the fixed stage restart path.
- ✅ **Regeneration = a new immutable version (§5)** — the `regenerate_asset_version`
  RPC mints a new version (same `lineage_id`, `version+1`) and repoints
  selections/panels
  (`supabase/migrations/20260622150000_regenerate_asset_version_rpc.sql`).
- 🟡 **One engine (§7 P1)** — the orchestrator *is* the unified trunk, but the
  legacy Next monolith (`src/app/api/oneshot`, on `.local/` JSON) still exists and
  is being retired; new generation work targets `apps/api` (`CLAUDE.md`).
- 🟡 **Inspection / feedback loop (§7 P3)** — artifacts, gates, and approvals ship;
  the prompt-improving OODA loop (`docs/scopes/ooda-feedback-loop.md`) is the main
  open piece.

## 0. What Popcorn Ready is (the positioning)

**Popcorn Ready is the agent harness for video.** Coding harnesses — Codex,
Claude Code, and the like — turned software into something you *direct* instead
of hand-build: you state intent, and an agent plans, writes, and edits the code.
Popcorn Ready is that harness for video. You describe what you want; the agent
plans the beats, generates the assets, edits the cut, and renders. This is the
AI-first way video gets made.

This is not a tagline bolted on after the fact — it *is* the architecture below.
A harness is only a harness because **the agent owns the whole flow and every
stage is a tool it calls** (§2, Principle 1). Everything in this document — the
non-one-directional pipeline, stages-as-tools, selective regeneration, the
provenance graph the agent reasons over — is what makes the harness framing
true. Conversely, the model we must NOT entrench (§3, the forward-only "edit the
timeline with patches" conveyor belt) is the *opposite* of a harness: it's a
fixed pipeline with AI bolted on. Keep new work on the harness side of that line.

This positioning is the product's public value proposition (the landing page and
[`scopes/website-and-productization.md`](scopes/website-and-productization.md)
lead with it); align marketing and product copy to it.

## 1. The North Star (read this first)

We want **one continuous generation pipeline that runs end-to-end on its own**,
where a **central agent owns every step as a callable tool** and can **drop into
or re-trigger any part of the flow**.

The agent sets the high-level goal, produces the **schema** (the plan: beats +
reference anchors), and moves through asset generation with **feedback loops at
each stage**. As assets pop out — the plan, the anchor images, the per-beat
keyframes, the clips, the cut — the user can look at them, stop, and say "redo
this."

Crucially, the flow is **not one-directional**. When something changes — "rethink
the audio" — the agent decides the **minimal set of work to redo**. That might be
audio-only, or it might ripple *back* and re-do a couple of shots. We must not
trap ourselves in the old, forward-only "edit the timeline with patches" model.

**Storyboard-first is the default production boundary.** The agent works
autonomously from a prompt through the complete storyboard, then stops for the
creator to inspect its visual plan. Only an explicit **Generate video** action
continues into photoreal keyframes, clips, audio, assembly, and export. This is
not a return to a forward-only conveyor belt: the asset graph still enables
targeted re-entry and selective regeneration. It is the deliberate point at
which a creator sees the plan before the expensive media work begins.

## 2. Principles (the mental-model shift)

1. **The agent owns the flow; stages are tools.** `brief → plan → anchors →
   keyframes → clips → audio → assemble → critique → export` are **tools the
   agent calls**, not a fixed conveyor belt. Give the agent latitude; don't be
   prescriptive about order.
2. **Autonomous through storyboard; production is explicit.** The default run
   creates a complete storyboard, then waits for the creator to choose
   **Generate video** before it spends work on keyframes, clips, audio,
   assembly, or export. Additional gates can still pause other artifacts.
3. **Non-one-directional / selective regeneration — the agent decides, not a
   rigid cascade.** Changing one input should affect only the impacted
   sub-video(s), never all of them. The dependency graph + fingerprints (§5)
   cheaply compute a **candidate** "possibly affected" set; the target runtime
   passes that set, **plus the stable IDs and provenance, to the agent, which
   makes the final call** — and may prune the cascade when it judges a change
   semantically irrelevant (e.g. a prompt edit that has nothing to do with a given
   image). Determinism scopes the *possibilities*; the agent decides the
   *actuals*. The graph primitive exists; wiring those candidates into the agent
   rerun path is still pending (§7 P2).
4. **A dependency/provenance graph is the foundation — not the agent's
   cleverness.** Minimal re-runs are only possible if the data records *what each
   asset was built from* (which beat, which anchors, which audio, which prompt /
   model / seed). Build the graph; the agent reasons over it. This is no-regret:
   you need it whether a human, a rule, or the agent decides the re-run.
5. **Propose before expensive redo.** The agent proposes a re-run plan ("to fix
   the audio I'll re-score only — no image changes" / "this needs beats 2 & 5
   re-shot, ~$X — go?") before spending. This *replaces* rigid gates with natural
   human-in-the-loop.
6. **One engine.** The synchronous one-shot route and the async run pipeline
   **converge into a single engine**. The staged "run" model is the trunk; the
   quick call becomes a thin entry into it.
7. **Determinism lives in the tool contracts, not in a fixed order — and the
   agent self-heals.** Each tool (API call) **deterministically validates its
   inputs** ("a video with a main character requires a character likeness";
   "because you have X you also need Y") and, on a miss, returns a **structured,
   actionable failure** instead of doing the wrong thing. The failure bounces
   back to the agent, which **satisfies the precondition (e.g. generates the
   missing anchor image) and retries.** Step ordering is therefore *emergent*
   from the contracts — the agent reacts to what each step says it needs rather
   than following a hardcoded sequence. This is what makes the flow both flexible
   (agent-driven) and reliable (every step guards its own preconditions), and it
   is how the "deterministic first pass" is achieved without prescribing order.
8. **Compose recursively; generate in parallel; stitch.** An asset is either
   *atomic* (a generated clip/image/audio) or *composite* (an ordered selection
   of other assets, referenced by ID). Composition is **recursive and uniform** —
   clip → scene → sub-video → movie are the *same* "composite asset" concept at
   different levels. So long videos are **decomposed, not brute-forced**: a
   90-minute movie is nine 10-minute sub-videos (each scenes, each clips),
   generated **in parallel** and stitched. A repeated scene is **one composite
   referenced many times** (reuse, not regeneration). Today's timeline is just
   one composite kind; we generalize so composites can contain composites, and
   the composition tree and the dependency graph become the same graph. **The
   agent owns this decomposition** — deciding *when and how* to split a long
   piece into parallel sub-videos is a higher-order strategy call the agent makes
   itself, not a user instruction or a deterministic rule. (We needn't build
   feature-length tooling now; the model just assumes the agent drives it.)
9. **Nothing is throwaway — everything is persisted.** Every asset, including
   intermediate anchors/keyframes and every composite, is persisted in the pool
   (never a temp file). Beyond reuse, persistence is the **audit trail** for *why
   the agent did what it did*.
10. **Every change flows through the agent — nothing is edited in isolation.**
    The user never directly mutates an asset, a beat, the brief, or the story
    through a one-off form control. Every change — "make this shot brighter,"
    "give the hero a denim jacket," "tighten the open," "rename the protagonist"
    — is expressed as **intent to the agent**, which decides the blast radius
    (Principle 3), proposes the minimal re-run (Principle 5), and recomputes only
    the affected assets over the provenance graph (Principle 4). This is what
    makes upstream/downstream consistency a **property of the system rather than
    the user's burden**: because the agent is the *only writer*, an upstream edit
    can ripple into every dependent keyframe, clip, caption, and cut without the
    user hunting them down — and conversely the agent can prune ripples it judges
    irrelevant. A direct, isolated field edit is exactly the forward-only patch
    model we reject (§3): it mutates one node and silently desynchronizes its
    dependents. The single carve-out is **selection, not creation** — pointing a
    slot at an already-generated pooled asset (§5, "I like image 10 — use it
    here") re-points an active selection rather than authoring content; even then
    the agent reconciles any downstream effect. The UI consequence — an
    observe-first dashboard whose primary edit affordance is **"Request Changes"** — is
    the source-of-truth interaction model in
    [docs/ui-interaction-model.md](ui-interaction-model.md).

## 3. Where we came from (the model we must NOT re-introduce)

This is the model the legacy Next monolith had and that the asset-graph foundation
**replaced.** It is kept here as a guardrail: do not rebuild any of it. Each bullet
notes what superseded it.

- Generation was **forward-only and all-or-nothing.** Plan → timeline flowed via
  append-only patches; any upstream change triggered a **full re-run.**
  → *Replaced by* the dependency graph + `downstream_assets()` candidate stale set
  and tool-scoped regeneration (§5; Principle 3).
- The old agent surface (`planEdit`, `critiquePlan`, `critique`, `revise`, …) only
  edited a **single timeline forward** via `Patch`es keyed by `segmentId`, with
  **no op to regenerate an asset, change a beat, or swap a reference**, and **no
  orchestrator.** → *Replaced by* the orchestrator + registered tool surface (§6) and the
  `regenerate_asset_version` RPC.
- There were **two drifted pipelines** and **two `GenerationRun` definitions** (the
  sync one-shot route and the async job stack). → *Replaced by* one orchestrator
  engine on `orchestrator_runs`; the legacy `src/app/api/oneshot` monolith still
  exists but is being retired (§7 P1), not extended.
- There were **no dependency edges**: beats had **no stable id**, and generated
  assets stored the prompt but **not the beat/anchor** they served, so "beat 3
  changed → regenerate clip 3" **could not be computed from data.** → *Replaced by*
  stable storyboard ids + per-asset `inputs` / `inputs_fingerprint` and
  `asset_edges` (§4, §5), which make blast radius computable.

## 4. The current data model (the asset graph — shipped)

The dependency-edges + invalidation + orchestrator gap that this section used to
describe is **now built.** The live model is the immutable asset graph in
`apps/api` on Supabase (migrations `20260610120000_asset_graph_model.sql` and
`20260610130000_storyboard_relational_model.sql`), read/written through
`apps/api/src/lib/api/v1/store.ts`. The legacy monolith seams it replaced
(`Clip.generatedBy`, `VersionedTimeline.provenance`, `EditGraph`,
`OverlayAnchor`, the per-asset `asset_generation` jobs in `src/lib/…`) are
historical — do not build on them.

**The graph (`assets` + `asset_edges` + `selections` + `actions`):**

- **Self-describing, immutable assets.** Each `assets` row carries `kind`,
  `project_id`, `lineage_id` + `version`, `content` / `params`, a write-once
  `inputs` snapshot (`[{assetId, relation, role?, position?, contentHash}]`), a
  `content_hash`, and an `inputs_fingerprint`. `assets_guard_immutable` /
  `assets_guard_delete` triggers forbid mutating semantic fields or deleting —
  changes mint a **new version**, never edit in place.
- **Dependency edges, auto-synced.** `asset_edges` (`from_id` consumer → `to_id`
  input, with `relation` + ordered `position`) is maintained by the
  `assets_sync_edges` trigger off each asset's `inputs`, and is strictly
  intra-project. `downstream_assets()` is the recursive **candidate stale set**
  query (a signal to the agent, per Principle 3).
- **Active selections, append-only.** `selections` points each slot at the pooled
  asset it currently uses (`active_asset_id`, with `seq` for CAS); the
  `current_selections` view reads the head. Regeneration **appends** a new
  selection rather than mutating — old assets stay reusable (Principle 9).
- **Actions = the agent decision log.** `actions` records every tool invocation
  (`tool`, `params`, `input_asset_ids`, `output_asset_ids`, `rationale`,
  `proposal`, `status`, cost) — the provenance of *why the agent did what it did*.
- **Relational product surfaces over the graph.** `storyboard_scenes` /
  `storyboard_beats` / `storyboard_panels` are first-class rows with **stable ids**
  that link to immutable asset snapshots via `*_asset_id`; a semantic beat edit is
  forced to mint a new snapshot (`storyboard_beats_require_snapshot`), which moves
  the fingerprint and makes downstream assets stale.

**Formerly "missing" — now shipped:**

1. ~~No dependency edges / no stable ids.~~ **Shipped** — stable storyboard ids +
   per-asset `inputs` and `asset_edges`. "Beat 3 changed → which assets are stale"
   is now computable (`downstream_assets()`).
2. ~~No invalidation / staleness.~~ **Shipped** — `inputs_fingerprint` (nested
   upstream hashes) is the deterministic candidate-stale signal.
3. ~~Generation is not a graph node.~~ **Shipped** — every generation is an
   `action` with input/output asset ids; regeneration is the
   `regenerate_asset_version` RPC, not a side effect.
4. ~~Patches are timeline-forward only.~~ **Shipped** — the orchestrator's tool
   vocabulary (§6) replaces forward-only patches.
5. ~~No central orchestrator.~~ **Shipped** — `apps/api/src/lib/orchestrator/`
   (§6, P2).
6. ~~Two drifted run models / one mutable `default` project.~~ **Mostly shipped** —
   one orchestrator engine on `orchestrator_runs`; the legacy Next monolith is the
   only remaining drift and is being retired (§7 P1).

## 5. Target data model (now realized in the asset graph)

> **Status:** This was the design direction; it is now **built** as the live asset
> graph (§4). The bullets below are the intent — read them as "why the schema is
> shaped this way," with §4 as the as-built map. One important gap remains: the
> graph can compute stale candidates, but the runtime has not yet fed those
> candidates into the agent's rerun decision path.

- **Stable ids on every node.** Beats get ids; anchors already have ids (PR #89);
  audio, keyframes, and clips are addressable. Derived assets reference the ids
  of their inputs.
- **A dependency/provenance graph.** Each generated asset records its inputs
  (`beatId`, `anchorIds[]`, `audioId?`, prompt/model/seed fingerprint). The graph
  makes blast radius **computable**: change beat 3 → its keyframe + clip (and
  maybe audio + the cut) are stale; nothing else.
- **Generation as a first-class node**, not a side effect — so the graph can say
  "this node is stale, regenerate it" and the timeline remains a pure projection.
- **Atomic vs composite assets (recursive).** An asset is either *atomic*
  (generated media) or *composite* (an ordered list of child asset IDs it
  stitches). The same shape models a clip, a scene, a sub-video, and a whole
  movie; composites can contain composites. Independent composites generate **in
  parallel**; a reused scene is one composite referenced many times. The
  composition tree and the provenance/dependency graph are the same graph.
- **Invalidation via input fingerprints — a *signal to the agent*, not a hard
  rule.** Each asset stores a content hash of its semantic inputs (including
  upstream asset hashes), so a change yields a cheap, deterministic **candidate
  stale set**. **Pending runtime integration:** pass those IDs, provenance, and
  candidates to the agent so it can make the final regeneration decision and
  prune cascades it judges irrelevant. (Stable IDs on every node are the
  prerequisite — the agent reasons over IDs.)
- **A regeneration vocabulary** beyond timeline patches: `regenerate_asset`,
  `change_beat`, `swap_anchor`, `rescore_audio`, … — the agent's tools.
- **Assets live in a reusable pool; locations point at an "active" one.**
  Generated assets (anchors, keyframes, clips, audio) are **immutable items in a
  shared pool — never deleted.** Each **location/slot** (a beat, an anchor role,
  a timeline segment) carries an **active selection** referencing the pooled
  asset it currently uses. Regeneration **adds** a new asset to the pool and may
  flip the slot's active pointer; the previous asset stays available and **can be
  reused in a different location** (an asset that's wrong for slot A may be right
  for slot B). "Not in use" ≠ "unusable." This generalizes today's `Clip[]` pool
  + `TimelineSegment.clipId` reference to every asset kind, and is exactly what a
  future dashboard browses ("I like image 10 — use it here" = re-point a slot's
  active selection, no regeneration).
- **One project-scoped asset pool — not multiple stores.** A **project** (one
  video creative effort, under a workspace) is the only container: **every asset
  carries a `projectId`** and lives in a single flat pool, never deleted.
  Relationships are carried **on the assets themselves** (provenance + input IDs
  + role / what-it-depicts) and by the plan/timeline's **active selections** (IDs
  pointing into the pool) — not by separate versioned-store collections. The
  agent pulls the project's pool and reasons over it **by ID**; tools receive the
  specific asset IDs (and prompts) they need. Versioning falls out for free:
  assets are immutable in the pool, selections move. **Prerequisite: assets must
  be self-describing** — kind, provenance (what it was generated from, by ID),
  and what it depicts/role — or the agent can't decide which asset feeds which
  call. (Today `Clip.generatedBy`/`characterBinding` do half of this; we make it
  consistent across every asset kind and add `projectId`.)
- **An orchestrator agent** that holds the creative state, calls the tools, runs
  a sensible default order on the first pass, and computes + **proposes** the
  minimal re-run on any change.

## 6. Tool surface (capabilities the orchestrator calls — shipped)

Realized as the orchestrator tool registry
(`apps/api/src/lib/orchestrator-tools/default-registry.ts`), driven by the run
loop in `apps/api/src/lib/orchestrator/engine.ts`. The executable registry is the
source of truth for the currently registered vocabulary; documentation must not
freeze a hand-maintained count. Its capabilities cover planning, media
generation and revision, assembly, critique, approval, export, and optional
publication. Image regeneration uses immutable versioning; broader regeneration
coverage across kinds is still filling in.

Each tool is **granular, idempotent, and records its inputs** (as an `action`) so
the graph stays accurate. Each tool also **validates its pre/postconditions and
returns typed, actionable errors** (missing inputs, implied requirements) so the
orchestrator can **self-heal and retry** (Principle 7). The dependency graph (§4)
is largely *expressed* by these contracts: a tool declaring "I need a character
likeness" is the edge from a clip to its anchor.

## 7. Scope & phasing (each independently shippable — do NOT implement ahead of agreement)

- **P0 — Design (this doc). ✅ Shipped.** North Star + data-model direction agreed.
- **P1 — Foundation. ✅ Shipped** (one caveat): stable storyboard ids + the
  dependency/provenance graph + granular idempotent generation tools are live on
  the asset graph; the orchestrator is the single engine. **Remaining:** the legacy
  Next monolith (`src/app/api/oneshot`, `.local/` JSON) is not yet retired — it's
  the last of the "two pipelines."
- **P2 — Orchestrator agent. 🟡 Partially shipped.** The agent calls the tools via
  the run loop; initial runs are durable and autonomous through their complete
  storyboard, then require an explicit production continuation
  (`orchestrator_run_gates`), and carry a budget ceiling
  (`orchestrator_runs.budget_usd` / `spent_usd`). **Pending:** graph-based
  "minimal re-run on any change" decisioning is not wired into the restart path
  yet. `downstream_assets()` is exposed through stale-candidate reads, but
  `apps/api/src/routes/v1/orchestrator-runs.ts` still restarts from fixed
  `GENERATION_STAGE_ORDER` boundaries and clears selections.
- **P3 — Inspection, gates & feedback loop. 🟡 In progress:** artifacts are visible
  as they pop (every tool call is an `action`), and approve/regenerate-any-stage
  ships (gates + `regenerate_asset_version`). **Open:** the approvals/edits →
  better-prompts feedback loop (`docs/scopes/ooda-feedback-loop.md`). First pass
  stays a reliable default ordering; agent latitude shines in the edit/re-run loop.

## 8. Design decisions (all resolved 2026-06-01)

These were the open P0 questions; all were decided 2026-06-01 and are implemented
or in flight in the asset graph (§4) + orchestrator (§6). Kept here with their
resolutions as the design record (the "why" behind the as-built schema).

- ~~**Invalidation granularity**~~ **— DECIDED:** per-asset content fingerprints
  (with nested upstream hashes) produce a *candidate* stale set. **Shipped:** the
  graph can compute candidates. **Pending:** the orchestrator restart path must
  feed those IDs/provenance/candidates to the agent so it can make the final call.
  Stale is a signal, not a command (Principle 3, §5).
- ~~**First pass vs edits**~~ **— DECIDED (Principle 7):** no hardcoded order;
  determinism lives in each tool's input validation, and the agent self-heals by
  reacting to structured failures.
- ~~**Re-run downstream policy**~~ **— DECIDED:** an asset **pool** model —
  assets are immutable and never deleted; each location has an **active**
  selection; regeneration adds to the pool and may flip the active pointer;
  idle assets stay reusable across locations. The agent proposes which slots to
  refresh (Principle 5); old outputs are superseded, not destroyed.
- ~~**Trunk for creative state**~~ **— DECIDED:** collapse to **one
  project-scoped asset pool** (no dual store). A project (under a workspace) is
  the container; every asset carries `projectId`; relationships live on the
  assets (self-describing: provenance/input-IDs/role) plus the plan/timeline's
  active selections. Drop the heavy versioned-store machinery; immutable assets +
  moving selections give versioning for free.
- **Pool scope — default for now:** project-scoped; recursive composition
  (Principle 8) handles long-video scale *within* a project. Cross-video reuse
  (promote a recurring character/logo up to the **workspace**) is deferred.
- ~~**Cost guardrails**~~ **— DECIDED (keep it simple first):** cheap ops
  (planning, images/anchors/keyframes) just run; expensive/fan-out ops (video,
  big regenerations) **propose an estimate first**, and autonomous runs honor a
  **budget ceiling** (pause + ask when hit). The first-pass estimate is
  deliberately **crude** — a rough rate (~$0.50/sec) plus a few high-level
  heuristics (e.g. audio) — refine later. Most relevant once videos exceed ~1
  minute.
- ~~**Retire the single-hero character path**~~ **— DECIDED:** fold character
  into the anchor model (a character is an anchor with identity invariants);
  retire the single-hero `generateCharacterHeroFrame` / single-`CharacterProfile`
  path.

## 9. Provenance & related reading

- **UI source of truth:** [`docs/ui-interaction-model.md`](ui-interaction-model.md)
  — the observe-first dashboard + "Request Changes" editing model that Principle 10
  implies. Read it before building any dashboard/editor surface.
- **As-built reference (the live model):** migrations
  `supabase/migrations/20260610120000_asset_graph_model.sql` +
  `20260610130000_storyboard_relational_model.sql` +
  `20260613120000_orchestrator_runs.sql`; code in `apps/api/src/lib/api/v1/store.ts`
  and `apps/api/src/lib/orchestrator/`. `CLAUDE.md` — **Asset-Graph Migration Rule.**
- **Agent memory:** `generation-pipeline-architecture` (mirrors this doc).
- **PRs:** #89 (per-beat keyframes + planner-decided anchors), #90 (pre/post
  generation critique loops), #526 (regenerate as a new immutable asset version).
- **Related scopes:** `docs/scopes/ooda-feedback-loop.md`,
  `docs/scopes/ai-native-edit-graph.md`, `docs/scopes/project-model-storage.md`,
  `docs/scopes/jobs-processing.md`,
  `docs/scopes/generation-review-checkpoints.md`,
  `docs/scopes/character-consistency-generation.md`,
  `docs/scopes/video-snapshot-review.md`,
  `docs/scopes/north-star-gap-audit.md`,
  `docs/scopes/graph-rerun-decisioning-prs.md`,
  `docs/scopes/ooda-feedback-implementation-prs.md`,
  `docs/scopes/regeneration-coverage-prs.md`.
- **Research:** `docs/research/character-consistency-video.md`.
