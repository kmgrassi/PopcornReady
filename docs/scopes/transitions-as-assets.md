# Transitions as First-Class Assets — Scope

Status: in progress (PR #1 = foundation)
Owner: TBD
Related: [docs/NORTH_STAR.md](../NORTH_STAR.md), [docs/data-model.md](../data-model.md),
[docs/scopes/story-spine-unification.md](story-spine-unification.md)

## Goal

Make a **transition** between two clips a first-class, agent-addressable,
re-triggerable object in the asset graph — instead of an untyped entry buried in
a composite asset's `content.children[]` JSONB. A transition is exactly the kind
of object the Asset-Graph Migration Rule points at: the agent targets it by name
("simplify the transition between beat 2 and 3"), the user sees and requests
changes to it, and it has structured type/timing/alternatives.

## Decision: a transition is its own asset

A transition is its own node — `kind='transition'`, `media='data'` — not a new
relational table. It plugs into machinery the graph already has:

- **Spec lives in the asset's typed `content`** (`transition.v1`): `method`,
  `type`, `durationMs`, `params`, `reason`, `confidence`, `alternatives`. This
  resurrects the retired `EditGraph.TransitionDecision` shape as a graph node.
- **Boundary identity is a selection slot** `transition:${fromBeatId}` — the
  outgoing beat owns its single trailing transition. The slot holds the active
  transition and its ranked alternatives (the agent proposes, the user approves).
- **Endpoints are `asset_edges`**: transition → from-clip (`role: from`),
  transition → to-clip (`role: to`). Provenance + edit-propagation come for free —
  re-time/replace a clip and its boundary transitions land in the dirty set.
- **Produced by an action** (`plan_transitions`) → re-triggerable per NORTH_STAR.

Why asset-only (not a relational `transitions` table): an asset is itself a
first-class row with a selectable identity, real edges, and schema-versioned
content — so it satisfies the relational-not-JSONB rule without a new table. We
only add a relational head later if transitions grow rich editable structure /
heavy querying / their own children — the same bar beats cleared before earning
`story_beats`.

## Two realizations, one node

The difference between "fade out clip 2 / fade into clip 3" and "a generated
bridge video" is just `content.method` plus whether the node has a media child:

| | `method: 'effect'` | `method: 'generated_clip'` |
|---|---|---|
| New media | none | a `kind='clip'` bridge asset (child edge) |
| Endpoints | from/to clip edges | from/to clip edges + the bridge clip |
| Render | renderer overlaps/fades the two clips | renderer inserts the bridge between them |
| Cost | free/instant (spec only) | a generation job (conditioned on endpoint frames) |
| Timing | overlaps (neutral/negative) | **adds** duration to the timeline |

## Hard cuts: empty slot = hard cut

A boundary with **no** transition asset renders as a hard cut. Boundaries are
**derived from beat order** (every consecutive beat pair), not from the
transition assets — so an empty boundary stays visible and addressable ("add a
crossfade between beat 2 and 3" targets the always-existing slot). Deciding a
real transition later just fills the previously-empty `transition:${fromBeatId}`
slot; nothing about the empty state blocks it. A *chosen* hard cut can also be
materialized as an explicit `type:'hard_cut'` asset so it appears alongside other
options in the picker — empty-default and explicit-hard-cut render identically.

## Production: the `plan_transitions` stage

A discrete, re-triggerable stage (fits the deterministic-stops engine). The agent
decides each boundary with spine context — within-scene → usually a hard cut;
across scenes/acts → a dissolve/longer device; plus endpoint mood, pacing, brief
style — and writes the active transition + ranked alternatives into each slot.
For `effect` transitions the decision *is* the creation; for `generated_clip` it
hands off to a generation job (≈`generate_clip` conditioned on the from-clip's
last frame + to-clip's first frame; the from/to edges supply those endpoints).

## The composite is a projection, not the source

The composite/timeline asset stops owning transition data in JSONB and becomes a
**compiled projection** of (selected beat clips + selected transitions): walk
beats in order, resolve each boundary's selected transition, compile to Remotion.
Source of truth = the transition assets + their slots.

## PR breakdown

1. **Foundation (this PR).** DB: add `transition` to the `assets_kind_media`
   constraint + a `trans` ref prefix (`20260625120000_transition_asset_kind.sql`).
   Shared: `transition.v1` content types + slot-role helpers
   (`packages/shared/src/transitions.ts`). This scope doc. No wiring yet.
2. **Store layer.** `insertTransitionAsset` + selection-slot read/write for the
   `transition:${fromBeatId}` family + endpoint edges; boundary enumeration from
   the spine.
3. **`plan_transitions` tool.** Register the orchestrator tool; effect decisions
   inline, generated-bridge via a generation job; ranked alternatives into slots.
4. **Composite projection / renderer.** Read selected transitions into the render
   plan (effect overlap vs inserted bridge); duration math per method.
5. **UI + Request Changes.** Render transitions between panels/clips; route edits
   through the object-scoped "Request Changes" modal.

## Open decisions (defaults chosen)

- **Edge encoding** — `relation='input'` + `role∈{from,to}` (reuse existing
  columns) vs. a dedicated `relation='transition'`. **Default: reuse.**
- **Lead-in / lead-out** — a transition with one null endpoint (fade from black /
  to black) → the slot exists with a single edge.
- **Explicit hard-cut assets** — materialized only when offered as a chosen
  alternative; absence is the implicit default.
