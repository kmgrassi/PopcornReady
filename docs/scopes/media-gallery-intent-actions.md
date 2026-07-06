# Media Gallery & Intent Actions — From Uploaded Assets to an Agent Run

## Objective

Define the surface **between "files are uploaded" and "the agent is
running."** After intake ([mobile-landing-upload.md](mobile-landing-upload.md))
a user has `ready` assets in a project; this scope owns what happens next:

1. a **project media gallery** where the user sees their uploaded videos and
   images, adds more, and **selects** a subset;
2. **intent actions** over the selection — a button like **"Make a montage
   from these"** — that compose a brief and hand the selected assets to the
   agent with one explicit create action;
3. the definition of **what the agent does from that handoff** (and what it is
   allowed to do automatically before it).

The UI leads; the agent takes over only at the button.

## Position in the flow / relationship to other scopes

```
mobile-landing-upload      THIS SCOPE                     agent-side scopes
(front door: bytes in) →  gallery → select → intent  →   uploaded-footage-agent-editing
                           button ("Make a montage")      (analysis, plan, edit)
                                                          audio-post-voiceover-sync
                                                          (narration, mix)
```

- **Interaction-model fit** ([ui-interaction-model.md](../ui-interaction-model.md)):
  the observe-first / "Request Changes"-only rule governs surfaces over
  *generated creative state*. This scope is **intake** — top-of-funnel intent
  capture, the same category as the landing prompt box — and asset
  **selection**, which is NORTH_STAR Principle 10's explicit carve-out
  ("selection, not creation"). Direct controls (checkboxes, an action button)
  are appropriate here; nothing on this surface edits generated content.
- **No auto-run** (decided 2026-07-06, mobile-landing-upload): nothing on this
  surface starts generation implicitly. The intent button + prefilled brief +
  explicit create **is** the run trigger.
- **Design brief** (`apps/web/PRODUCT.md`): the intent CTA is the single
  popcorn-yellow CTA on this screen.

## Current state (verified)

- **There is no project media gallery.** `apps/web/src/routes/UploadsPage.tsx`
  is an **in-memory viewer** — local `useState` of files picked this session,
  lost on refresh, not backed by `GET /projects/:projectId/assets` (which
  exists). Nothing lists a project's uploaded assets with status.
- **No server-side thumbnails.** Assets have no `thumbnailUrl`;
  [ui-video-upload.md](ui-video-upload.md) requires thumbnail generation and a
  phone gallery is unusable without it (a grid of filenames is not a gallery).
- **The run entrypoint exists and takes guests.**
  `POST /projects/:projectId/generation-entrypoints/uploaded-footage`
  (`apps/api/src/routes/v1/orchestrator-runs.ts:533`) already handles
  idempotency, gates, budget, and an **anonymous run quota** — the guest path
  composes. Verify (and extend if needed) that the body carries an **explicit
  selected-asset list**; selection scoping must not be inferred from "all
  project assets."
- **Free local analysis primitives exist or are scoped:** ffmpeg frame
  extraction (`extractVideoSnapshots`), duration probing, scene-change
  detection (scoped in the ideas catalog), transcription foundation (merged,
  PR #673).

## What the agent does — and when it's allowed to spend

Two phases, split by cost, consistent with the no-auto-run economics:

**Phase A — on upload, automatic, free/local only.** As part of ingest
processing (no model calls, no generation):

- metadata probe (duration, dimensions, fps, codec, audio presence) — exists;
- **thumbnail/poster frame** per asset (ffmpeg still for video, resize for
  images) — new, PR 2;
- optionally scene-change timestamps (free ffmpeg pixel math) stored as asset
  metadata for later sampling.

This is what makes the gallery informative before a cent is spent.

**Phase B — on intent (the button), the run starts and paid work begins.**
The run's first stage is **asset understanding over the selected assets
only** (cost scales with the selection, not the project): sampled-frame
vision summaries, transcription where speech matters (the merged transcript
foundation), producing the knowledge records of
[uploaded-footage-agent-editing.md](uploaded-footage-agent-editing.md). Then
the standard flow: plan beats against the brief → coverage critique (warn if
the selection can't cover the request) → assembly (trims, ordering, captions,
audio strategy) → gates → export. For the montage intent specifically, v1 is
soundtrack + trailer-style cut via existing tools; **beat-synced cuts** (beat
grid) are the follow-on in the ideas catalog (#3), not this scope.

No model-based analysis runs before intent. (Open question below: pre-intent
analysis as an *explicit* user action for signed-in users.)

## UI specification

One screen (route: project-scoped, e.g. `/projects/:projectId/media`), mobile
first, replacing today's in-memory `UploadsPage`:

**Gallery grid.** Thumbnail tiles for every project `upload` asset: status
badge (`processing | ready | failed` — failed shows retry/remove), duration
chip on videos, tap-and-hold or detail affordance opens the existing
`MediaViewer` for full preview. A persistent **"+ Add"** tile opens the same
picker/upload manager as the landing flow (uploads land in this project).

**Selection — ordered (decided 2026-07-06).** Tap toggles selection, and
**the order of selection is the order of the cut**: tiles show a numbered
badge (①②③…) instead of a plain check, and the agent assembles the timeline
in exactly that sequence. Deselecting renumbers the remainder; re-tapping
re-appends at the end (v1 reordering = deselect/reselect; drag-to-reorder is
a later nicety). A header shows the count ("4 selected") with
select-all (numbered in grid order) / clear. Selection is **ephemeral local
React state** (per repo conventions — it is unsaved UI state, not server
state; server data comes via TanStack Query on the assets list).

The division of authority: **the user owns the sequence; the agent owns
everything inside it** — which seconds of each clip to use, trims,
transitions, pacing, and audio. The agent never reorders the selected assets;
if the brief text contradicts the tapped order ("put the sunset last"), the
coverage critique should flag it at the gate rather than silently
reshuffling.

**Intent bar.** When ≥1 asset is selected, a sticky bottom bar (thumb reach on
mobile) presents **one free-text input + one preset dropdown + one Create
button** (decided 2026-07-06; replaces an earlier chip-row design):

- **The text input is primary and always present** — "What should we make
  with these?" It accepts anything; it is the same intent channel as the
  landing prompt box, so the UI never implies the agent can only do a fixed
  menu of things.
- **The preset dropdown is the discovery mechanism** — a select ("Choose an
  idea…") listing what the system does well:
  - `Make a montage` — "Cut these into a montage with a fitting soundtrack."
  - `Make a trailer` — "Cut a dramatic 30-second trailer from these clips."
  - `Narrate these` — "Add warm narration grounded in what happens, keep the
    best original audio." (voiceover-sync stack)
  - (list grows from the ideas catalog as capabilities ship)

  Picking a preset **prefills the text input with its editable template** —
  preset and free text are one input with scaffolding, not two modes. The
  user can pick "Make a montage" then append "…set at sunset, end on the
  dog." Editing the text after picking simply keeps the edited text; the
  dropdown is a writer, not a state the payload depends on.
- **Create** is the single popcorn-yellow CTA on the screen and the explicit
  run trigger (no auto-run), calling the uploaded-footage entrypoint with the
  brief text + selected asset ids → existing run-progress page. Disabled
  until the text input is non-empty and the selection satisfies the
  preset-independent minimums (≥1 ready asset).

Preset constraints (`minSelection`, `mediaKinds`) surface as inline hints
rather than disabled menu items where possible ("Narration needs at least one
video — add one or pick a different idea"), since a dropdown hides its
options' disabled states until opened.

**After the run.** The gallery persists — assets are reusable. The watch page
links back ("make another from your clips"), landing on the gallery with
selection cleared.

**Intent templates are code, not DB, in v1** — a typed list
(`{ id, label, briefTemplate, minSelection?, mediaKinds? }`) in `apps/web`;
e.g. `Narrate these` requires ≥1 video, `Make a montage` wants ≥2 items.
Promote to data later if operators need to edit them.

## Data model & API

Small surface — this scope is mostly UI + one contract clarification:

- **Selection → run contract (matches the existing API — two calls, no
  endpoint changes).** The uploaded-footage entrypoint
  (`apps/api/src/routes/v1/orchestrator-runs.ts:533`) **requires**
  `briefVersionId` and a non-empty `assetIds` array; it does not accept a raw
  brief string. So Create is a two-step mutation:
  1. `POST /projects/:projectId/brief-versions` with the intent text →
     `briefVersion.id` (this endpoint already exists for existing projects —
     the gallery's draft project was created at upload time);
  2. `POST /projects/:projectId/generation-entrypoints/uploaded-footage` with
     `{ briefVersionId, assetIds }`, where `assetIds` is the **ordered**
     selection (the existing field is an array and parsing preserves order —
     reuse it; do not introduce a parallel `selectedAssetIds` field).

  Semantics: the selected set **is** the source pool for the run (selected
  assets are `must_use`-flavored, unselected project assets are ignored for
  sourcing; the agent may still *generate* gap-fill if the brief allows), and
  **`assetIds` order is timeline order** — the agent sequences the cut in
  exactly this order and only decides trims/transitions/pacing within it
  (run-side enforcement is PR 4). The run's brief/plan assets record the
  selected ids in their `inputs` with their `position`, so both membership
  *and* order are provenance ("this montage was made from these 6 clips, in
  this sequence") straight from the graph — `inputs` entries already carry an
  ordered `position` field, so this costs nothing new.
- **Thumbnails.** `thumbnailUrl` on the asset response, backed by a derived
  storage object written at ingest (sidecar under the asset's storage prefix;
  no new asset kind — it's a rendition, not creative content the agent
  targets).
- **No new tables.** Selection is ephemeral; intent templates are code;
  knowledge records belong to the uploaded-footage scope.

## PR plan

### PR 1 — Project media gallery (read + add)

**Scope:** the gallery route backed by `GET /projects/:projectId/assets` via
TanStack Query (stable query keys by project; poll while any asset is
`processing`); tiles with status/duration; `MediaViewer` detail; "+ Add" tile
reusing the upload manager (mobile-landing-upload PR 2) with invalidation of
the assets query on completion. Retires the in-memory `UploadsPage` listing
in favor of this project-scoped surface.

**Tests:** query wiring + state rendering units (mock API: processing/ready/
failed mixes); failed-tile retry/remove; preview verification at mobile
viewport (grid, add-more, viewer open).

**Done when:** refreshing the page shows the same assets (server-backed, not
in-memory), with statuses live-updating while uploads process.

### PR 2 — Ingest thumbnails/poster frames

**Scope:** ffmpeg poster-frame for videos + resized rendition for images at
ingest (degrade cleanly without ffmpeg per repo convention: fall back to no
thumbnail, never fail the asset); `thumbnailUrl` on asset responses; backfill
job for existing assets optional.

**Tests:** unit — rendition path derivation and response shape; integration
(ffmpeg, skipped when absent) — fixture MP4/portrait video/HEIC-ish image
produce renditions with correct orientation; asset registration still
succeeds when rendition fails.

**Done when:** the PR 1 gallery shows real frames for the fixture set instead
of placeholder tiles.

### PR 3 — Selection + intent bar + create

**Scope:** selection state (local reducer; select/clear/select-all,
count), sticky intent bar (free-text input + preset dropdown + Create, per
the UI spec), preset list with per-preset constraints (`minSelection`,
`mediaKinds`) surfaced as inline hints, dropdown-prefills-input behavior,
Create as the two-call sequence from the run contract (brief-versions POST →
entrypoint with `{ briefVersionId, assetIds }`) → run-progress redirect. No
entrypoint signature changes; add API-side validation that `assetIds` are
`ready`, project-owned, and of allowed media kinds if not already enforced.

**Tests:** unit — selection reducer **including ordering** (tap order
preserved; deselect renumbers; re-tap appends at end; select-all numbers in
grid order); preset-prefill behavior (picking a
preset writes the template; subsequent edits win; re-picking overwrites);
constraint hints (narration with images only; montage needs ≥2); Create
gating (empty text disables); create-sequence composition (brief text →
brief-versions POST; its returned id + ordered `assetIds` → entrypoint; the
text derives from the text box, never from dropdown state; a failed
brief-versions call surfaces an error and never fires the entrypoint). API
unit — entrypoint rejects foreign/not-ready ids with typed errors. Preview e2e at
mobile viewport: select 3 tiles → pick preset → edit brief text → Create →
run-progress.

**Done when:** "Make a montage from these" goes from three taps to a running
agent, and nothing runs without the explicit Create.

### PR 4 — Agent honors the selection

**Scope:** run-side scoping — the orchestrator's source-asset resolution for
uploaded-footage runs consumes the entrypoint's ordered `assetIds` (not "all project
uploads") **and preserves its order as timeline order** (the agent decides
trims/transitions/pacing within the sequence, never the sequence itself; a
brief that contradicts the tapped order is flagged by the coverage critique,
not silently resolved); the understanding stage (sampled-frame vision;
transcription when the intent implies speech) runs **only over selected
assets**; coverage critique reports against the selection ("2 clips can't
fill a 60-second montage — shorten, add clips, or allow generated fill?")
through the existing gate mechanism.

**Tests:** tool tests (`test:tools`) — fixture project with 6 uploads, 3
selected in a deliberate non-grid order: plan/assembly reference only the 3
**and the timeline plays them in the selected order**; selection ids +
positions recorded in the run's brief/plan asset `inputs` (provenance).
Unit — scoping filter; order preservation through assembly; coverage-critique
output shape.

**Done when:** an unselected asset never appears in the cut, the cut plays in
the tapped order, and the montage's provenance names exactly the selected
clips in sequence.

## Out of scope

- Beat-synced cutting (beat grid) — ideas catalog #3, next montage upgrade.
- Per-asset user context fields / knowledge editing UI —
  [uploaded-footage-agent-editing.md](uploaded-footage-agent-editing.md).
- Editing generated results (observe-first + Request Changes owns that).
- Workspace-level media library shared across projects (pool stays
  project-scoped per NORTH_STAR §8 resolution).

## Open questions

- **Pre-intent analysis as an explicit action?** "Analyze my clips" for
  signed-in users (paid vision pass making gallery tiles smarter before any
  intent). Default: not in v1; free signals only until the button.
- **Selection persistence:** survive a refresh (e.g. sessionStorage) or
  acceptable to lose? Default: lose it — reselecting is cheap on a gallery.
- ~~Intent chip set / default-highlighted chip?~~ **Decided 2026-07-06:**
  free-text input (primary, always present) + preset dropdown that prefills
  it; Create is the screen's single yellow CTA. Remaining sub-question:
  initial preset list order and the dropdown's placeholder copy.
- **Preset ordering:** montage first (strongest multi-select aha)?
- **Audio uploads in the gallery:** voice memos (ideas #6) would extend
  `mediaKinds` — defer until the audio-first path is scoped.
