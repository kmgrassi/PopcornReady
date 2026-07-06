# Landing Upload → Dashboard Handoff, First-Frame Posters, Add-More

## Objective

Three product decisions (2026-07-06) that change what happens **after** a
landing-page upload:

1. **Navigate to the project dashboard when the upload lands** — a new
   (guest) user who uploads a video should end up looking at *their project*,
   not at a status line on the marketing page.
2. **Every uploaded video gets its first frame saved as an image**, and the
   project view uses it as the project's poster image — so the dashboard card
   is never a gray placeholder for a project that contains real footage.
3. **The project view has an explicit "upload more" button** — add another
   video or a set of images to the same project.

## What this amends (read alongside)

- [mobile-landing-upload.md](mobile-landing-upload.md) — its user flow steps
  4–6 (stay on landing → brief → create → run-progress) are **superseded for
  the post-upload portion**: the brief/create step moves to the project
  surface. The no-auto-run decision is untouched — navigation is not a run.
- [media-gallery-intent-actions.md](media-gallery-intent-actions.md) — the
  dashboard destination **is** that scope's media gallery + intent bar. This
  scope raises its priority: the gallery is now the landing spot for every
  upload-first user, and its "+ Add" tile is decision 3. The intent bar
  (free-text + preset dropdown + Create) is where the brief/create step now
  lives.
- The account-or-skip modal (landing-guest flow) currently fires at Create on
  the landing page; with create moving to the project surface, the modal
  moves with it (same component, same trigger: run creation).

## Current state (verified)

- **Today the landing page keeps you there after upload** — status text flips
  to "Uploaded clips are ready. Add a brief, then create the run"; navigation
  only happens at Create (`navigate(runProgressPath(...))`,
  `apps/web/src/routes/HomePage.tsx`). The "nothing happened" feel after an
  upload is real user feedback from first testing.
- **The upload manager state is local to `HomePage`** — navigating away
  mid-upload would today abandon in-flight XHRs. This constrains *when* we
  can navigate (see decision below).
- **Project posters are a selection slot.** `PUT /projects/:projectId/poster`
  (`setProjectPoster`) points the project-scoped `poster` selection at an
  image asset; dashboard grids render it. AI poster generation
  (`startPosterGenerationInBackground`) fires for prompt-created projects
  with briefs — an upload-first draft project has no brief, so its poster
  slot is empty today.
- **First-frame extraction machinery exists** (`extractVideoSnapshots`,
  ffmpeg) and the gallery scope's PR 2 already plans ingest thumbnails —
  decision 2 upgrades part of that work from "rendition sidecar" to "real
  image asset."

## Design decisions

- **Navigate when the upload batch settles, v1.** Because upload state lives
  in the landing page component, v1 navigates when **all files in the picked
  batch reach a terminal state** (`ready` or `failed`) and **at least one is
  ready** — then `navigate` to the draft project's dashboard view. An
  all-failed batch stays on the landing page with retry affordances. A
  follow-up PR lifts the upload manager into an app-level provider so
  navigation can happen **immediately on pick** with uploads continuing in
  the background (the better end state; not required for v1).
- **First frame = a real image asset, not just a thumbnail rendition.** At
  ingest, every uploaded video gets frame-0 (rotation-aware) extracted and
  registered as an **image asset** with provenance `relation: "input",
  role: "first_frame_of"` back to the video asset (reusing the
  `source_footage`/upload image shape — no new asset kind). Being a real
  asset means it's in the pool: usable as the project poster, visible in the
  gallery, and legally referenceable later (keyframe conditioning, anchors)
  with lineage intact. The gallery-scope thumbnail rendition work remains for
  *display* sizes; the first-frame asset is the canonical still.
- **Poster fill rule: first ready video's first frame fills an empty poster
  slot.** On ingest completion, if the project's `poster` selection is empty,
  point it at the new first-frame asset (first video to finish wins; later
  videos don't displace it). A non-empty slot is never auto-overwritten —
  existing AI poster generation and explicit user/agent choices keep working
  through the same selection mechanism, and the selection model makes any
  later swap cheap and reversible.
- **"Upload more" is the gallery's "+ Add" tile** — one implementation, both
  entry points: the project dashboard button and the gallery tile invoke the
  same picker/upload manager targeting the existing `projectId`, with the
  assets query invalidated on completion. Newly added videos get first-frame
  assets too (decision 2 applies at ingest, not just landing uploads).

## PR plan

### PR 1 — Post-upload navigation to the project dashboard

**Scope:** landing upload flow navigates to the draft project's dashboard
view when the batch settles (≥1 ready); the brief/create UI on the landing
page is retired for the upload path (prompt-only path unchanged); the
account-or-skip modal moves to run creation on the project surface. Failed
items surface on the project view (they're project assets with `failed`
status) rather than being lost in the transition.

**Tests:** unit — navigation trigger (all-terminal + ≥1 ready; all-failed
stays put); e2e (mobile Playwright project): pick fixture files on landing →
land on project view with tiles visible → no run exists yet (no-auto-run
regression guard).

**Done when:** a first-time guest who uploads a clip ends up on their
project's dashboard with the clip visible, and nothing has generated.

### PR 2 — First-frame image assets at ingest (all uploaded videos)

**Scope:** ingest pipeline extracts frame 0 (rotation-aware) from every
uploaded video → registers an image asset with `first_frame_of` provenance;
degrade cleanly without ffmpeg (asset still `ready`, no frame). Applies to
every upload path (landing, gallery add-more, share target).

**Tests:** unit — provenance edge shape; integration (ffmpeg, skipped when
absent): fixture MP4 + portrait video produce correctly-oriented frames;
video with no video stream (audio-only `.mp4`) produces no frame and no
failure.

**Done when:** every fixture video registered through any path has a linked
first-frame image asset in the pool.

### PR 3 — Poster fill from first frame

**Scope:** on first-frame asset creation, fill the project's empty `poster`
selection (first-to-finish wins; never overwrite non-empty); dashboard
grid/card already renders the poster slot, so no UI change beyond the data.

**Tests:** unit — fill rule (empty→set; non-empty→untouched; concurrent
finishers → exactly one set, CAS via selection `seq`); integration — upload
two videos into a fresh project, poster = first finisher's frame; a project
with an AI poster keeps it.

**Done when:** an upload-first project shows real footage on its dashboard
card within seconds of the first video finishing.

### PR 4 — "Upload more" on the project view

**Scope:** the add-more button on the project dashboard (and the gallery's
"+ Add" tile when the gallery ships — same component) → picker → upload
manager targeting the current project → assets query invalidation; respects
the same caps/validation as the landing path.

**Tests:** unit — targets existing project (never creates a new draft);
e2e: add a second video from the project view, tile appears, first-frame
asset created, poster unchanged.

**Done when:** a user can grow a project's media from the project page, and
every addition behaves identically to landing uploads.

### PR 5 (follow-up) — Background uploads across navigation

**Scope:** lift the upload manager into an app-level provider (context) so
the landing flow can navigate to the project view **immediately on pick**,
with per-file progress continuing on the project surface; landing and
project views render the same upload queue.

**Tests:** unit — manager survives route change (state machine unmounted
from neither); e2e: pick on landing → immediately on project view →
progress completes there.

**Done when:** the user sees their project the moment they pick files, and
uploads finish around them.

## Out of scope

- The gallery/intent-bar implementation itself
  ([media-gallery-intent-actions.md](media-gallery-intent-actions.md)).
- Poster regeneration/choice UI (existing poster machinery; Request Changes
  flow).
- Using first-frame assets as generation conditioning (they're in the pool;
  the agent scopes own when to use them).

## Open questions

- Multi-video batch: poster = first *finisher* (fast, simple) or first
  *picked* (matches user's mental order — the ①②③ selection-order principle)?
  Default in this scope: first finisher for v1 simplicity; revisit if users
  notice.
- Should PR 1 wait for PR 5 (navigate-immediately) instead of shipping
  batch-settled navigation first? Default: ship v1 now — the "nothing
  happened" problem is live today.
