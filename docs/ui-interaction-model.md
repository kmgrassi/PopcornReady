# UI Interaction Model — Observe-First, AI-Mediated Editing

> **Status:** Source of truth for how the dashboard/editor *behaves* (not how it
> looks). This is the UI counterpart to [NORTH_STAR.md](NORTH_STAR.md): the North
> Star defines the agent-orchestrated generation model, and this doc defines the
> single interaction model every authenticated surface must follow from it. New
> UI work (human or agent) aligns to this; deviations are conscious and
> documented. Last updated 2026-06-21.

## 0. The one rule

**The dashboard is for *seeing*. The agent is for *changing*.**

Every authenticated surface — project, storyboard, scene, beat, asset, timeline
item, export — is **observe-first**: it exists to let the user understand what
the system has produced and what state it's in. The **only** way to change any of
it is to **request changes**. There is no direct-edit form that mutates content in
isolation.

This is the direct UI consequence of [NORTH_STAR.md](NORTH_STAR.md) **Principle
10** ("every change flows through the agent — nothing is edited in isolation").
The agent is the only writer; the UI never writes content behind its back.

## 1. Why (don't skip this — it's load-bearing)

If the UI lets the user edit one thing directly — retype a beat, tweak a prompt,
swap an image with a raw form field — it has just created an **isolated mutation
the provenance graph can't reason about**. That node now disagrees with its
dependents and nobody recomputes them. That is precisely the forward-only,
"edit the timeline with patches" conveyor belt the North Star rejects (§3 there).

Routing every change through the agent is what makes consistency **the system's
job, not the user's**:

- The user says "rename the protagonist to Mara." The agent owns the blast
  radius — it knows every keyframe, clip, caption, and title card that depends on
  the hero anchor and recomputes only those (NORTH_STAR Principles 3–5).
- The user says "make the open punchier." The agent decides whether that's a cut
  change, a re-score, or a beat re-shoot — and proposes the minimal, costed plan
  before spending.
- The user never has to know *what's downstream of what*. That knowledge lives in
  the graph and the agent, not in the user's head or in a pile of edit buttons.

A dashboard full of direct-edit controls quietly pushes that burden back onto the
user and re-entrenches the model we're leaving. So we don't ship those controls.

## 2. The two interaction primitives

Every screen is built from exactly two kinds of interaction:

### 2.1 Observe (the default, ~everything)

Read-optimized presentation of state. The user can:

- **Navigate** — move between projects, storyboards, scenes, beats, assets,
  runs, outputs.
- **Inspect** — open any object to see its current value, its **provenance**
  (what it was generated from, by which prompt/model/seed), its status
  (draft / generating / stale / ready), and its place in the dependency graph.
- **Play / preview** — watch the cut, scrub a clip, view an image, hear audio.
- **Compare** — see the alternatives in the pool for a given slot (the assets the
  agent generated but didn't select).

Observe surfaces carry **no input boxes and no edit buttons.** Their job is to
make "what's going on" legible at a glance.

### 2.2 Request Changes (the single edit affordance)

The **only** path to changing content. Selecting an object and choosing to change
it opens the **Request Changes modal** (§3) — a scoped prompt to the agent. The user
describes intent in natural language; the agent does the rest.

There is no third primitive. If a proposed interaction is neither "observe" nor
"request changes," it does not belong in the product without an explicit, documented
exception (§5).

## 3. The "Request Changes" modal

Clicking an object the user wants to change — a project, a storyboard, a scene, a
beat, an asset card, a timeline item — opens a modal whose primary content is
**"Request Changes"**: a prompt box scoped to that object.

**Scope & context.** The modal is **anchored to the object that opened it** and
passes that object's identity to the agent: its stable ID, its kind, its current
value, and its provenance/dependency context. "Request Changes" from a beat is
implicitly *about that beat*; from the whole project, it's about the project. The
user types intent ("brighter," "swap the jacket for a hoodie," "cut two seconds
off the open"); they do **not** restate which thing they mean.

**What it shows.**

1. The **current state** of the object (the image, the beat text, the clip, the
   cut) — so the ask is grounded in what the user is looking at.
2. Its **provenance/lineage** (what it was built from) — context for both the
   user and the agent.
3. A **prompt box** + submit: "Request Changes."
4. After submit: the agent's **proposed plan and blast radius** — what it will
   recompute, what stays, and (for expensive/fan-out work) a rough cost — per
   NORTH_STAR Principle 5. The user **confirms**; the agent executes and
   recomputes only the affected assets.

The preview is a durable lifecycle, not a one-shot mutation. The UI reads the
proposal by action ID after reload, keeps approval separate from execution,
polls waiting/running work, and reports applied, failed, canceled, or rejected
state from the server. A stale preview must be refreshed and reviewed again
before execution. Provider and model choice remain server-owned; creator
authority is the requested intent, exact target, and approved maximum cost.
Asset Studio standalone creation is the narrow timed-confirmation exception: it
moves to a dedicated review page, shows the exact proposal and approved maximum,
offers **Approve this**, and visibly counts down 10 seconds before confirming if
the creator does not revise. The countdown begins only after the proposal is
ready, is canceled by revision or a failed manual attempt, and shares the same
one-use server gate as manual approval. Request Changes and production review
gates still require deliberate confirmation and never inherit this timer.
After confirmation, the resulting creator-direct run remains project-scoped but
uses a one-step **Image asset**, **Video asset**, or **Audio asset** activity
surface. It must not infer Brief, Script, Storyboard, or final-render stages from
the full video pipeline, and a terminal parent run must never keep a stale tool
spinner active.
If a summary surface cannot resolve a stable graph identity, Request Changes is
disabled there and directs the creator to open a specific object. A checkpoint
label must never be converted into a broader project target for convenience.

**What it never shows.** Raw editable fields that write the object directly — no
"edit beat text" textarea that saves a beat, no prompt field that re-runs a
single asset in isolation, no property form that mutates content without going
through the agent's plan/propose/recompute loop.

**Conversation, not one-shot.** The modal is a place to *direct*, so it supports
back-and-forth ("no, keep the framing, just the color") rather than forcing the
user to nail the perfect instruction in one box. It is the harness chat (NORTH
STAR §0) focused on one object.

## 4. What this looks like per object

| User clicks… | They see (observe) | "Request Changes" changes… |
|---|---|---|
| **Project** | overview: status, runs, latest output, the story at a glance | anything project-wide ("make the whole thing more upbeat," "rename the hero everywhere") |
| **Storyboard / story** | the beats/scenes in order, with state per beat | structure ("add a beat after the reveal," "reorder," "tighten the arc") |
| **Scene / beat** | the beat's intent, its keyframe, its clip, its provenance | that beat ("reshoot this darker," "change what happens here") |
| **Asset (image/clip/audio)** | the asset full-size + its pool alternatives + lineage | that asset ("brighter," "different angle," "swap the jacket") |
| **Timeline item** | the item in context of the cut | timing/selection/transition intent ("hold this longer," "use the other take") |
| **Export / output** | the finished video | a new pass ("make a 9:16 version," "punchier ending") |

In every row, the left column is **read-only** and the right column is **one
modal**. No row has a third "edit it directly" column.

## 5. The carve-outs (allowed direct interactions)

A short, explicit allowlist of direct interactions that are **not** content
mutations and therefore don't go through the agent. Anything not on this list is
"Request Changes."

- **Selection among existing pooled assets** — pointing a slot at an
  already-generated asset ("I like image 10, use it here"). This re-points an
  **active selection**, it does not author content (NORTH_STAR §5). It's
  reversible and recorded; the agent still reconciles any downstream effect. This
  is the closest thing to a direct edit we allow, and it's deliberately
  *choosing*, never *creating*.
- **Approvals / gates** — approve or cancel at a review checkpoint. A content
  revision opens Request Changes and uses the durable proposal lifecycle; it
  never rewinds the gate or a generation stage (NORTH_STAR Principle 2/5).
- **Playback & view controls** — play/pause/scrub, zoom, full-screen, switch
  aspect preview, expand provenance. Pure view state.
- **Navigation & organization metadata** — open/close panels, project
  **name/title**, tags, archive/delete a project. Naming a container is not
  authoring its content. (Borderline cases lean toward "Request Changes.")

If you find yourself wanting to add a control that *creates or alters generated
content* and it isn't on this list, the answer is the Request Changes modal — or a
documented amendment to this list, not a quiet new form field.

## 6. Anti-patterns (what this reframes)

Several existing components and scopes predate this model and surface up-front,
direct-edit fields. They are **not the target state** and should be reconciled to
this doc as they're touched:

- **Dense form panels** — `BriefPanel`, `AssetGenerationPanel`, `CharacterPanel`,
  the story-context fields, and the "advanced options" forms in
  [`scopes/studio-dashboard-redesign.md`](scopes/studio-dashboard-redesign.md).
  Hiding these inputs behind an inspector or a wizard step is an improvement, but
  the end state is **not "collapsed forms"** — it's "no direct-edit forms."
  Configuration the agent needs becomes either an **initial prompt/brief to the
  agent** or a **Request Changes** instruction, not a field the user saves against an
  asset.
- **Per-asset prompt boxes that re-run one asset in isolation** — these must
  route through the agent so blast radius is computed, not fire a lone
  regeneration.
- **Timeline patch-style editing** — direct segment edits are the forward-only
  model (NORTH_STAR §3). Cut changes are intents to the agent.

The redesign scopes ([`scopes/studio-dashboard-redesign.md`](scopes/studio-dashboard-redesign.md),
[`scopes/dashboard-ui.md`](scopes/dashboard-ui.md)) already lean observe-first —
dashboard-ui's "the dashboard reads and navigates" non-goal is exactly right;
this doc extends that stance from the cross-project dashboard down into **every**
object detail and editor surface, and replaces "inspector full of inputs" with
"inspector that shows state + a Request Changes button."

## 7. Implications for builders

- Default any new object surface to **read-only + a "Request Changes" entry point.**
  Adding an input box is the exception that needs justification against §5.
- The Request Changes modal is a **reusable, object-scoped component**, not a
  per-screen reimplementation. It takes `{ objectId, objectKind, context }` and
  owns the prompt → propose → confirm → recompute loop.
- "Propose before expensive redo" (NORTH_STAR Principle 5) is **part of the
  modal's contract**, not an afterthought: show the plan and blast radius before
  the user commits.
- Front-end server state still lives in **TanStack Query** (see CLAUDE.md): the
  observe surfaces are queries; the Request Changes submit is a mutation that
  invalidates the affected query keys when the agent's recompute lands.

## 8. Open decisions

- **Modal vs. side panel vs. docked chat** for "Request Changes." A modal is the
  baseline framing here; a persistent docked agent chat that *focuses* on the
  selected object is an acceptable equivalent so long as the scoping/propose/
  confirm contract holds.
- **Naming as content** — is a project/scene title a §5 carve-out (organization
  metadata) or an agent-mediated change once it appears *in* the video (a title
  card)? Leaning: editing the label is direct; changing what renders on screen is
  Request Changes.
- **Selection vs. ask** boundary for pool picking when a manual selection would
  itself desync dependents — when does a "choose image 10" flip warrant an agent
  reconciliation pass vs. a silent re-point?
- **Bulk asks** — "Request Changes" scoped to a multi-select (several beats at once)
  vs. always single-object.

## 9. Related reading

- [NORTH_STAR.md](NORTH_STAR.md) — the generation model; **Principle 10** is the
  parent of this doc.
- [`scopes/dashboard-ui.md`](scopes/dashboard-ui.md) — cross-project dashboard
  shell (observe surfaces).
- [`scopes/studio-dashboard-redesign.md`](scopes/studio-dashboard-redesign.md) —
  Studio home + editor cleanup (forms to reconcile per §6).
- [`scopes/north-star-inspection-feedback.md`](scopes/north-star-inspection-feedback.md),
  [`scopes/ooda-feedback-loop.md`](scopes/ooda-feedback-loop.md) — inspection +
  approval loops the observe/approve primitives build on.
