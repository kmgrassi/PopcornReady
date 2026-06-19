# Dashboard / Landing Montage Alignment Scope

## Objective

Use the new landing-page dream-montage preview as the product model for the
authenticated creation flow. The landing page now explains Popcorn Ready as a
staged agent run:

1. The user writes one brief.
2. The agent writes a plan as the first major artifact.
3. The user can stop or continue.
4. The agent generates storyboard/keyframe artifacts.
5. The next step advances toward timeline assembly and review.

The dashboard and `/studio` flow already contain many of the real pieces:
drafts, a brief step, footage selection, planning decisions, run creation,
progress polling, review gates, generated assets, timeline review, and export.
The gap is presentation and continuity. The logged-in flow should feel like the
same product the landing page just promised: a staged reveal of agent work, with
clear human control points and visible intermediate artifacts, not a generic
wizard followed by a separate progress page.

This scope documents where the two surfaces differ and how to move the
dashboard creation flow toward the landing montage without faking capabilities
or adding a second generation model.

## Product Direction From Review

The product should have **one creation interface** that can start from scratch,
resume an in-flight run, edit an existing video, or enter at any appropriate
stage based on the user's inputs. The current distinction between `/studio`,
`/projects/:projectId/runs/:runId`, and review/export routes is mostly an
implementation and deep-linking concern from building quickly; it should not read
as separate product functions.

Users should be able to:

- start from a prompt, uploaded footage, or existing generated assets;
- enter the flow at the most appropriate stage for those inputs;
- stop, start, revise, or continue from any stage;
- see the same core interface whether they are creating a new video or editing an
  existing one.

The landing-page behavior is the target interaction model: stage boundaries
should expose a `Stop here` control, but the default path remains autonomous. If
the user does nothing, the run should automatically continue after a short delay
around five seconds. Nothing should require explicit approval by default, except
longer videos: for videos over 30 seconds, stop after the plan and require user
approval before any image or video assets are generated.

## Source Surfaces

| Surface | Path | Current role |
| --- | --- | --- |
| Landing montage | `apps/web/src/components/AgentRunPreview.tsx` | Decorative but product-accurate explanation of brief -> plan -> continue -> keyframes -> next step. |
| Landing route | `apps/web/src/routes/HomePage.tsx` | Public promise: one idea becomes a production workflow. |
| Studio shell | `apps/web/src/components/studio/StudioShell.tsx` | Draft start screen, setup flow, generating checklist, review/export handoff. |
| Studio flow state | `apps/web/src/components/studio/useStudioFlow.ts` | Owns `initial -> generating -> review`, run creation, polling, gates, revision request. |
| Planning workspace | `apps/web/src/components/studio/PlanningWorkspace.tsx` | Real planning preview and editable planning decisions before generation. |
| Run progress | `apps/web/src/components/progress/ProgressView.tsx` | Real run detail page, review gate controls, generated assets, stage rail. |
| Progress rail | `apps/web/src/components/progress/StageRail.tsx` | Maps engine stages into a user-visible pipeline. |

## What The Landing Montage Gets Right

- **One user action starts the story.** The montage begins with a single brief
  and a clear `Generate` handoff.
- **The plan is its own act.** Planning is not a small checklist item; it is the
  first visible output the agent produces.
- **The agent is the active worker.** The handoff line explicitly says the agent
  is running autonomously and the user can step in.
- **Human control points are legible.** `Stop here`, the clapperboard
  `CUT -> 3 -> 2 -> 1 -> ACTION`, and the stop button make continuation feel
  intentional instead of hidden.
- **Generated visuals are grouped as a storyboard.** The keyframes appear as a
  coherent board, not unrelated asset cards.
- **The flow is staged, not cluttered.** Plan gets focus first; production
  artifacts appear only after the plan recedes to a recap.
- **The next stage is teased.** After keyframes, the UI says the timeline is next
  without pretending it already exists.

## Where The Real Dashboard Flow Already Aligns

- `StudioEmptyState` keeps the first screen simple with one primary creation
  action.
- `BriefStep` and `SourceFootageStep` keep setup progressive instead of exposing
  every advanced option at once.
- `PlanningWorkspace` already generates planning decisions before starting the
  expensive run.
- `createAndStartRun` in `useStudioFlow` enters the v1 run model rather than the
  legacy one-shot route.
- `StatusChecklist` in the generating state gives a calm summary of active work.
- `ProgressView` supports approve/reject/cancel for review gates.
- `ProgressView` can show generated stage items and preserves generated assets
  as first-class outputs.
- The final review/export path already separates review from rendering.

## Key Differences

| Landing montage model | Current dashboard behavior | Product effect |
| --- | --- | --- |
| Plan is the first big artifact. | `PlanningWorkspace` is a pre-generation decision grid, then run progress collapses planning into checklist text. | The user may not perceive that the agent created a concrete plan worth approving. |
| Continue is a visible moment. | `Start generating`, gate approval, and progress navigation are ordinary buttons in separate surfaces. | The user does not get the same sense of staged agency and control. |
| Stop points are attached to active stages. | Cancel/reject controls exist, but mostly live in progress panels and gate cards. | Intervention feels like error handling, not a normal creative workflow. |
| Storyboard/keyframes are a board. | Stage items render as generic cards by kind; storyboard and asset generation are split across stage vocabulary. | Generated visuals feel like system artifacts instead of the emerging movie. |
| The run has two acts: Plan, then Produce. | `/studio` setup, `/projects/:id/runs/:runId`, and `/studio?step=review` feel like separate screens. | The mental model is fragmented across route transitions. |
| The plan recedes to a recap during production. | The active brief/planning context is not persistently summarized in the progress page. | Users lose the thread of what the agent is making and why. |
| The next step is named before it starts. | Stage rail has detailed stage labels, but the main content does not always preview what comes next. | The run can feel opaque between visible artifacts. |
| Landing copy says "step in at any step." | Real gates are optional and stage-specific; ungated stages mostly allow cancel only. | The promise is directionally true but stronger than the default UI affordances. |
| Creation and editing should share one interface. | Starting, run progress, and review/editing currently appear as different route states. | Users may learn separate workflows for what should be one directable agent workspace. |

## Target Experience

The authenticated creation flow should adopt the landing montage's staged
language and hierarchy while staying wired to the real v1 run model:

1. **Brief** - user describes the goal, optionally adds footage.
2. **Plan** - the agent produces a readable plan card with hook, beats, format,
   visual direction, and any missing inputs.
3. **Continue / revise** - user can accept the plan, edit the brief, edit
   footage, request plan changes, or let the countdown continue automatically
   after roughly five seconds.
4. **Produce** - the agent generates storyboard/keyframes, media assets, audio,
   timeline, quality review, and export according to the run's actual stages.
5. **Review** - user reviews the cut, gives feedback, requests targeted
   revisions, then exports.

The same flow should support editing and continuation. A project with existing
images should be able to enter at storyboard/keyframe selection; a project with a
finished storyboard should be able to enter at shots/timeline; a completed video
should re-enter at review/revision without making the user restart from a blank
brief.

This does not require copying `AgentRunPreview` into the app. The landing
component is product theatre. The dashboard should reuse its information
architecture: focused act transitions, clear agent/human roles, stop/continue
controls, and storyboard-first visual grouping.

## Proposed UI Changes

### 1. Rename The Setup Milestones Around The Montage Acts

Current setup stepper only renders `Brief` and `Your Footage`, while planning is
shown as the same route state after those steps. That makes planning feel like a
configuration screen.

Target:

- Show setup as `Brief -> Footage -> Plan` before generation starts.
- Treat `Plan` as the first agent output, not a hidden continuation of setup.
- Keep `Review` and `Export` out of the setup stepper until a run exists.
- Use landing-consistent labels in user-visible copy:
  - `Brief`
  - `Plan`
  - `Produce`
  - `Review`
  - `Export`

Implementation seam:

- `apps/web/src/components/studio/studioSteps.ts`
- `apps/web/src/components/studio/StudioStepper.tsx`
- `apps/web/src/components/studio/PlanningWorkspace.tsx`

### 2. Turn PlanningWorkspace Into The Real "Act One"

`PlanningWorkspace` currently shows three editable cards: story direction,
opening hook, and poster/visual. Keep those capabilities, but reframe the screen
as the agent's plan output.

Target:

- Header: "Plan ready" or "Agent is writing the plan".
- Primary plan card with:
  - brief recap
  - opening hook
  - 3-5 beat outline when available
  - format/platform/length metadata
  - visual direction
  - missing inputs or caveats
- Secondary editable controls stay available, but should not compete with the
  plan summary.
- Footer actions become:
  - primary: `Continue to production`
  - secondary: `Revise plan` or `Edit brief`
  - secondary: `Edit footage`

Data gap:

- The planning preview currently exposes format, hook, poster direction, status,
  and missing inputs. It does not yet expose the landing montage's beat list as a
  first-class structured output. Add a typed beat-outline field to the planning
  preview response before making the dashboard depend on beat rendering.

### 3. Add A Real Continue Moment Between Plan And Produce

The landing montage's clapperboard works because it turns continuation into a
decision. The app should not add theatrical animation if it slows real work, but
it should make the transition explicit.

Target:

- Replace generic `Start generating` copy on the plan screen with
  `Continue to production`.
- Show `Stop here` at the stage boundary.
- If the user does nothing, auto-continue after about five seconds.
- For videos over 30 seconds, do not auto-continue past planning. Hard stop for
  approval before generating real image or video assets.
- On click, show a compact handoff state:
  - `Agent running autonomously`
  - current plan recap
  - stop/cancel affordance
  - next stage label
- After `createAndStartRun` returns `projectId` and `runId`, route to the real
  progress URL as today.

Implementation seam:

- `PlanningWorkspace` submit state.
- `StudioShell` `onGenerationStarted` route handoff.
- `useStudioFlow.startGeneration`.

### 4. Make Run Progress Read As "Act Two: Produce"

`ProgressView` is functionally rich but system-oriented: run IDs, current stage,
stage rail, generated assets. It should keep diagnostics available while making
the main story match the landing montage.

Target:

- Main heading uses the project/brief context when available, not only
  "Video generation run".
- Add a compact plan recap at the top of progress:
  - goal
  - approved hook/beat count
  - target length/aspect/platform
- Rename the primary progress section to `Producing your video`.
- Surface "Stop here" / "Cancel generation" as a normal active-run control,
  visually attached to the active stage.
- Show "Next step: X" based on the next queued stage in the stage rail.
- Keep run ID/copy/debug details, but move them below or into a diagnostics row.

Implementation seam:

- `apps/web/src/components/progress/ProgressView.tsx`
- `apps/web/src/components/progress/StageRail.tsx`
- `apps/web/src/components/progress/ProgressView.module.css`

### 5. Group Keyframes And Storyboard Outputs As A Board

The landing montage's keyframes are persuasive because they read as the emerging
movie. The current generated item grid treats outputs uniformly, which is useful
but not cinematic.

Decision: move toward **StoryboardBoard as the primary user interaction model**
for visual generation stages. This is a UI positioning and workflow change first;
it does not need to wait on a database redesign.

Target:

- Detect storyboard/keyframe stage items and render them in a `StoryboardBoard`
  before generic assets.
- Use a stable 2 / 2 / 1 board for five-frame storyboards and responsive grid
  variants for other counts.
- Keep item status, judgment, and retry metadata accessible inside each tile.
- Generic `StageItemCard` remains the fallback for audio, captions, timeline,
  export, and unknown assets.

Data gap:

- `GenerationStageItem.kind` only says `image`, `video`, `audio`, `caption`,
  `timeline`, or `export`. To reliably group storyboard/keyframes, the API
  should expose either a stage type, role, or artifact purpose on each item
  (`storyboard_frame`, `keyframe`, `shot`, etc.). This is not required for the
  first UI pass if the parent stage provides enough context, but do not infer
  this from labels long-term.

Implementation seam:

- New `apps/web/src/components/progress/StoryboardBoard.tsx`
- New co-located `StoryboardBoard.module.css`
- `ProgressView` grouping before rendering `StageItemCard`
- Optional shared CSS pattern adapted from `AgentRunPreview.module.css`, using
  scoped modules and existing tokens.

### Storyboard / Keyframe / Shot UI Model

The UI should present visual generation as one board with progressive detail,
not three unrelated asset lists. The user-facing hierarchy:

1. **Storyboard** - the story structure. A storyboard card represents a scene or
   beat: what happens, why it exists, rough timing, and status. This is the layer
   users should scan to understand the video.
2. **Keyframe** - the representative still for that beat. This is the visual
   anchor users approve, revise, or regenerate before motion is expensive.
3. **Shot** - the generated moving clip for that keyframe/beat. This appears
   after production and can be previewed, swapped, or regenerated.

In the first UI pass, render these as a single `StoryboardBoard`:

- each tile is a beat/scene slot;
- the tile's main media shows the best available visual: shot thumbnail/video if
  present, otherwise keyframe, otherwise storyboard placeholder;
- the tile footer shows the beat label, short intent, status, and active action;
- tile actions are stage-aware: `Stop here`, `Revise beat`, `Regenerate frame`,
  `Regenerate shot`, `Use this`, `Compare`;
- a compact detail drawer opens from a tile for prompt, provenance, alternatives,
  review notes, and diagnostics.

This lets the UI grow with the data model: initially a tile may be backed only by
stage context and generated items; later it can bind to relational storyboard
rows, keyframe assets, shot assets, selections, and actions without changing the
surface users learned.

The board should be **AI-mediated**, not a manual form editor. The current
storyboard editor exposes scene/beat fields directly and saves the user's typed
changes as structured data. That is useful scaffolding, but it is not the target
interaction. The target interaction is: the user selects a board/tile/beat/scene
and tells the AI what to change; the request includes the selected ids and the
surrounding board context, and the AI decides whether to update the beat text,
regenerate a storyboard panel, regenerate the keyframe, regenerate the shot,
adjust the timeline, or propose a broader change.

Timeline-level revision can stay as the backend operation. The important product
requirement is that a timeline-level request carries enough board/tile targeting
context for the AI to apply the change at the right level. For example:

```text
target: { storyboardId, sceneId, beatId, panelId?, keyframeAssetId?, clipAssetId? }
message: "Make this tile feel more like a tense night discovery."
```

The agent can then map the human request to the right tool calls while the user
continues interacting with the storyboard board.

### 6. Make Studio, Progress, And Editing One Interface

The real flow currently transitions:

- `/studio?draft=...` setup
- `/projects/:projectId/runs/:runId?studioDraft=...` progress
- `/studio?draft=...&step=review` review

This is technically sound for resumability and deep links, but it is not a
product distinction. The user experience should feel like one directable agent
workspace, regardless of whether the underlying route is a draft, run, review, or
project-edit URL.

Target:

- Preserve the same page title/project name across all three states.
- Keep the plan recap visible from plan through progress through review.
- Make "Back to studio" context-specific:
  - during setup: `Back to draft`
  - during progress: `Edit setup` only when safe, otherwise `View draft`
  - after success: automatic return to review can stay, but make the transition
    feel expected with matching headings.
- Ensure drafts that have an active run resume directly into the stage they last
  reached, with visible status.
- Support "enter at stage" behavior from available inputs:
  - prompt-only starts at brief/plan;
  - uploaded footage can start at source selection or plan with footage attached;
  - an existing storyboard can start at shots/timeline;
  - a completed video can start at review/revision/export.

## API / Data Requirements

This scope should avoid new legacy surfaces and stay aligned with the immutable
asset graph direction. Any new fields should be typed and versioned.

Recommended additions, in priority order:

- Planning preview includes structured beats:
  - `beats: Array<{ id: string; label: string; text: string; role?: "hook" | "beat" | "payoff" }>`
- Project/run detail exposes approved planning summary:
  - goal, hook, beat count/list, format/platform/length, visual direction.
- Stage items expose artifact role/purpose:
  - `purpose: "storyboard_frame" | "keyframe" | "shot" | "audio" | "timeline" | "export" | ...`
- Stage items link to stable graph ids as the asset graph lands:
  - `assetId`, `selectionId`, `actionId`, and dependency ids where available.
- Run detail exposes the next queued stage or enough ordered stage data to derive
  it without duplicating status logic.

The first StoryboardBoard UI pass can be driven by existing run/stage context if
that is enough to group frames cleanly. Do not block the UX direction on a
database migration. When the data model is updated, avoid untyped JSONB for
storyboard, scene, beat, or panel structure. If the UI renders the plan or
storyboard as first-class product structure, model it as typed response fields
now and relational graph-backed rows when persisted.

## Non-Goals

- No new generation engine.
- No return to `/api/oneshot` for authenticated creation.
- No fake interactive landing animation inside the dashboard.
- No manual timeline editor or drag-to-trim surface.
- No broad dashboard shell rewrite beyond the creation-flow surfaces named here.
- No uploaded-image intake flow in this pass. Future scope: when users bring
  images, the AI should ask what the images are and what role each should play
  before deciding the right entry stage.
- No additions to `globals.css` or legacy global route styles. New visual work
  uses co-located CSS Modules and existing tokens.

## Suggested PR Sequence

| PR | Scope | Why |
| --- | --- | --- |
| 1 | **Planning language and stepper alignment.** Rename planning actions around `Plan` and `Continue to production`; add `Plan` to setup stepper. | Small copy/IA change that makes the real flow match the landing model. |
| 2 | **Plan summary card.** Rework `PlanningWorkspace` so the agent-created plan is the dominant artifact; keep existing editable decision controls secondary. | Gives users a real "Act One" before expensive generation. |
| 3 | **Planning preview beats contract.** Add typed beat outline to the planning preview API/client and render it in the plan card. | Replaces landing hardcoded beats with real planning data. |
| 4 | **Progress header and plan recap.** Update `ProgressView` to read as `Produce`, show plan/project context, and move debug run details lower. | Keeps continuity after the route transition. |
| 5 | **Storyboard board.** Add a scoped `StoryboardBoard` for storyboard/keyframe items and fall back to `StageItemCard` for everything else. Use existing stage context first; typed purpose metadata can follow. | Makes generated visuals feel like the movie, not a generic asset list. |
| 6 | **AI-mediated board edits.** Add board/tile-level feedback affordances that pass selected storyboard/scene/beat/panel/asset ids into the existing AI revision path or a new board revision endpoint. | Keeps the user on the storyboard surface while letting the AI decide whether to update text, panel, keyframe, shot, or timeline. |
| 7 | **Stop/continue affordances.** Attach cancel/reject/approve controls to active stages with landing-consistent `Stop here` / `Continue` language. Auto-continue after roughly five seconds by default; hard stop after planning only for videos over 30 seconds before image/video assets are generated. | Makes human intervention a first-class workflow while preserving autonomous default runs. |
| 8 | **Unified workspace continuity.** Make setup, progress, review, and edit states read as one directable agent interface even if routes remain deep-linkable. | Avoids teaching separate workflows for create vs edit vs resume. |
| 9 | **Artifact purpose metadata.** Add typed purpose/role fields to stage items so the board is data-driven instead of label-driven. | Makes UI grouping robust and asset-graph-ready, but is not a blocker for the first board pass. |
| 10 | **Review continuity polish.** Carry plan recap and stage history into the review/export handoff; make successful progress-to-review transition feel intentional. | Completes the end-to-end story. |

Each PR should be independently reviewable and avoid touching broad aggregation
files unless the surrounding route registration requires it.

## Open Decisions

- Should storyboard frames, keyframes, and generated shots be distinct labels in
  the UI, or should the first pass collapse them into one `Frames` board until
  users need more specificity?
- Should the landing `AgentRunPreview` share a presentational `StoryboardBoard`
  with progress once the real board exists, or remain intentionally separate as
  marketing theatre?

## Definition Of Done

- A user who starts from the landing page and enters `/studio` sees the same
  conceptual flow: brief -> plan -> continue -> produce -> review/export.
- The plan is visible as a concrete agent artifact before media generation.
- The progress page carries forward the approved plan context.
- Storyboard/keyframe outputs are grouped as an emerging video, not only generic
  asset cards.
- Stop, continue, approve, reject, and cancel affordances use consistent language
  and are visible at the stage where they matter; default autonomous stages
  continue after a short delay when the user does not stop them. Videos over 30
  seconds hard-stop after planning and require approval before image or video
  asset generation.
- Creating from scratch, resuming a run, editing an existing video, and entering
  with user-provided assets all use the same underlying directable workspace
  model.
- All implementation uses the v1 run model, TanStack Query hooks, typed API
  contracts, co-located CSS Modules, and existing design tokens.
