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

**Selection.** Tap toggles selection (check overlay); a header shows the
count ("4 selected") with select-all/clear. Selection is **ephemeral local
React state** (per repo conventions — it is unsaved UI state, not server
state; server data comes via TanStack Query on the assets list).

**Intent bar.** When ≥1 asset is selected, a sticky bottom bar (thumb reach on
mobile) presents **intent chips** and the CTA:

- `Make a montage` — "Cut these into a montage with a fitting soundtrack."
- `Make a trailer` — "Cut a dramatic 30-second trailer from these clips."
- `Narrate these` — "Add warm narration grounded in what happens, keep the
  best original audio." (enabled by the voiceover-sync stack)
- `Something else…` — free-text brief.

Tapping a chip opens a **one-line brief field prefilled from the template**
(editable — "make it about Maya's first swim") above the single yellow
**Create** button. Create = the explicit run trigger (no auto-run), calling
the uploaded-footage entrypoint with the brief + selected asset ids →
existing run-progress page.

**After the run.** The gallery persists — assets are reusable. The watch page
links back ("make another from your clips"), landing on the gallery with
selection cleared.

**Intent templates are code, not DB, in v1** — a typed list
(`{ id, label, briefTemplate, minSelection?, mediaKinds? }`) in `apps/web`;
e.g. `Narrate these` requires ≥1 video, `Make a montage` wants ≥2 items.
Promote to data later if operators need to edit them.

## Data model & API

Small surface — this scope is mostly UI + one contract clarification:

- **Selection → run contract.** The entrypoint body carries
  `selectedAssetIds: string[]` (verify/extend the existing route). Semantics:
  the selected set **is** the source pool for the run — selected assets are
  `must_use`-flavored, unselected project assets are ignored for sourcing
  (the agent may still *generate* gap-fill if the brief allows). The run's
  brief/plan assets record the selected ids in their `inputs`, so provenance
  ("this montage was made from these 6 clips") falls out of the graph.
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
count), sticky intent bar, template list with per-template constraints
(`minSelection`, `mediaKinds`), prefilled editable brief, Create →
uploaded-footage entrypoint with `selectedAssetIds` → run-progress redirect.
Includes the entrypoint body verification/extension and its API-side
validation (ids must be `ready`, project-owned, media kinds allowed).

**Tests:** unit — selection reducer; template constraint gating (Narrate
disabled with images only; montage needs ≥2); payload composition (brief +
ids). API unit — entrypoint rejects foreign/not-ready ids with typed errors.
Preview e2e at mobile viewport: select 3 tiles → chip → edit brief → Create →
run-progress.

**Done when:** "Make a montage from these" goes from three taps to a running
agent, and nothing runs without the explicit Create.

### PR 4 — Agent honors the selection

**Scope:** run-side scoping — the orchestrator's source-asset resolution for
uploaded-footage runs consumes `selectedAssetIds` (not "all project
uploads"); the understanding stage (sampled-frame vision; transcription when
the intent implies speech) runs **only over selected assets**; coverage
critique reports against the selection ("2 clips can't fill a 60-second
montage — shorten, add clips, or allow generated fill?") through the existing
gate mechanism.

**Tests:** tool tests (`test:tools`) — fixture project with 6 uploads, 3
selected: plan/assembly reference only the 3; selection ids recorded in the
run's brief/plan asset `inputs` (provenance). Unit — scoping filter;
coverage-critique output shape.

**Done when:** an unselected asset never appears in the cut, and the
montage's provenance names exactly the selected clips.

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
- **Intent chip set:** start with montage/trailer/narrate/custom, or fewer?
  Which is the default-highlighted chip (PRODUCT.md wants one obvious next
  step)?
- **Audio uploads in the gallery:** voice memos (ideas #6) would extend
  `mediaKinds` — defer until the audio-first path is scoped.
