# Story Spine Unification — Scope

Status: draft / scoping
Owner: TBD
Related: [docs/NORTH_STAR.md](../NORTH_STAR.md), [docs/ui-interaction-model.md](../ui-interaction-model.md)

## Goal

Collapse the three parallel scene/beat structures into **one FK-linked spine**
(`act → scene → beat → panel`) and delete the two confusing legacy edit models
(`EditPlan`, `EditGraph`). The narrative arc (acts/scenes) becomes the single
source of truth that flows structurally into the operational beats that all
generation hangs off, which is the prerequisite for arc-first generation and for
graph-precise edit propagation.

The "storyboard" and "storyboard scenes" **concepts survive for the UI** — they
become a *visual fidelity/view* of the unified spine (act-level mockups, beat-level
panels), not their own table family.

## Current state

Three independently-minted structures describe "the scenes/beats of a video":

1. `story_blueprint_acts` / `story_blueprint_scenes` — narrative, derived from the **brief**.
2. `EditPlan.scenes/beats` (the `plan` asset JSONB, produced by `plan_shots` via
   `planEdit`) — the shot plan, derived from the **brief**.
3. `storyboards` / `storyboard_scenes` / `storyboard_beats` / `storyboard_panels`
   — visual previz, derived from the **plan** (`storyboards.plan_asset_id`).

`storyboard_beats` is the operational backbone: `beatId` is the universal join key
(`beat_keyframe:${beatId}`, `beat_clip:${beatId}`, `TimelineSegment.beatId`,
selection slot roles), it carries the NORTH_STAR §5 mutable-head/snapshot contract
(`storyboard_beats_require_snapshot` trigger), and it is the central UI editing
surface. The blueprint's narrative richness (act `purpose`, character arcs,
antagonistic forces, premises) currently **dead-ends at `draft_script`** and never
reaches generation structurally.

Two legacy edit models, both confusing and both retirement targets:

- **`EditPlan`** — the shot-plan structure (scenes/beats). `planEdit`
  ([apps/api/src/lib/agent/index.ts](../../apps/api/src/lib/agent/index.ts)) is a
  *generator* (goal + optional feedback → full plan), **not** an edit/approval
  mechanism despite the name.
- **`EditGraph`** ([packages/shared/src/edit-graph.ts](../../packages/shared/src/edit-graph.ts))
  — the `Patch` / `revisionOperations` / `alternatives` model. This *was* the
  AI-suggests-edits-with-approval mechanism, but it lives only in the legacy v1
  store (`edit_graphs` table, `lib/v1/store.ts`) and the old `critique`/`revise`
  agent functions. It is **not** wired into the live orchestrator generation path
  (`assemble_timeline` / `critique_timeline` do not use it) and is the forward-only
  "edit the timeline with patches" model NORTH_STAR explicitly retires.

The live AI-edit-with-approval capability is **already** the orchestrator: "Ask the
AI" → `board-revisions`/`asset-revisions` endpoints record a `board_feedback` action
with a `proposal` → resume → agent re-runs the relevant tool scoped to the target →
new immutable asset + re-pointed `selection` → optional approval gate. Deleting
EditPlan/EditGraph does **not** remove any editing capability.

## Target data model — the unified spine

```
story_blueprints                  versioned narrative doc        ← brief asset
 ├─ story_blueprint_characters    name, role, description, arcs, forces, premises
 └─ story_blueprint_acts          title, purpose, summary, target_duration_sec
     │                            + mockup_asset_id   ← act-level high-level storyboard tile (UI)
     │                            + status
     └─ story_blueprint_scenes    title, summary, target_duration_sec, position(=scene_index)
         │                        + setting, mood, scene_asset_id, status   (absorbed from storyboard_scenes)
         └─ story_beats           intent, visual_description, dialogue_summary, narration,
             │                    duration_sec, beat_asset_id, status, beat_index
             │                    + shot_type, camera, framing   (absorbed from plan_shots output)
             │                    (reparented storyboard_beats: scene_id → story_blueprint_scenes)
             └─ story_panels      panel_index, image_asset_id, prompt_asset_id, is_selected, approved_at, status
                                  (reparented storyboard_panels: beat_id → story_beats)
```

Drop: `storyboards`, `storyboard_scenes`, the `plan` asset structure, `edit_graphs`.
Reparent + keep: `storyboard_beats` → `story_beats`, `storyboard_panels` → `story_panels`.

> Naming note: tables `story_beats`/`story_panels` are *renamed reparents* of
> `storyboard_beats`/`storyboard_panels`. We keep the `story_blueprint_*` names for
> acts/scenes/characters (see "Naming decision" below) rather than rename the whole
> family.

## Field migration map (do before dropping tables)

### `storyboards` → mostly dropped
| Column | Fate |
|---|---|
| `id`, `project_id`, timestamps | drop (container role replaced by `story_blueprints`) |
| `plan_asset_id` | drop — retired with EditPlan |
| `status` (`storyboard_status`) | move to a blueprint/act-level status, or derive from child panel statuses (see progress.ts) |
| `created_by_action_id` | preserve provenance on the blueprint/act if still needed; else drop |

### `storyboard_scenes` → folded into `story_blueprint_scenes`
Add these columns to `story_blueprint_scenes` and backfill:
| `storyboard_scenes` column | → `story_blueprint_scenes` |
|---|---|
| `scene_index` | maps to existing `position` |
| `title`, `summary` | already present (reconcile values) |
| `setting`, `mood` | **add columns** |
| `scene_asset_id` | **add column** (+ composite FK to assets) |
| `duration_sec` | maps to `target_duration_sec` |
| `status` (`storyboard_item_status`) | **add column** |

### `storyboard_beats` → `story_beats` (reparent, preserve ids)
- Change `scene_id` FK target: `storyboard_scenes` → `story_blueprint_scenes`.
- Keep every column **and** the `storyboard_beats_require_snapshot` trigger + `beat_asset_id` lineage.
- **Add** `shot_type`/`camera`/`framing` (or a `beat_shots` child) to absorb `plan_shots` output.
- **Preserve `id` values** — see below.

### `storyboard_panels` → `story_panels` (reparent, preserve ids)
- Change `beat_id` FK target to `story_beats`. Keep `is_selected` unique-per-beat index,
  `image_asset_id`/`prompt_asset_id` FKs, `approved_at`, `status`. Preserve `id`.

## The key migration risk — unlinked scene sets

`storyboard_scenes` and `story_blueprint_scenes` are generated **independently**
(storyboard from the plan, blueprint from the brief) and there is **no existing FK
or mapping between them**. The blueprint typically has ~3 canonical scenes; the
storyboard has N scenes mirroring the plan. To reparent `storyboard_beats` onto
blueprint scenes we must produce a `storyboard_scene → blueprint_scene` mapping that
**does not exist in current data**.

Options for the backfill (pick one — needs a decision):

- **A. Storyboard scenes win (recommended).** Treat the operational
  `storyboard_scenes` (the ones that actually own beats) as the surviving scenes.
  Backfill them into `story_blueprint_scenes`, assigning each to an act by
  best-effort (position-proportional across the blueprint's acts, or all under a
  single "imported" act when ambiguous). The blueprint's original canonical scenes
  merge or are superseded. Reparent beats via the map built during backfill.
- **B. Blueprint scenes win.** Keep the narrative scenes; re-run the storyboard
  stage for existing projects so beats are re-minted under blueprint scenes. Cleanest
  schema, but discards existing beat/panel rows (and their generated tiles) for old
  projects.
- **C. Cut line.** Given the "no legacy/compat" preference and that this is pre-heavy
  production, only guarantee forward correctness: new generation uses the unified
  spine; old projects are migrated best-effort (A) and flagged for re-generation when
  the mapping is ambiguous, rather than forcing a bad reconciliation.

**Decided: A + C** — promote storyboard scenes, best-effort act assignment. Volume
is low, so we do not engineer a perfect reconciliation: where the best-effort
backfill produces an ambiguous or wrong mapping, **regenerate the storyboard for
that project** rather than block the migration or hand-fix data.

## Beat/panel id preservation — load-bearing

`selections` slot rows (`beat_keyframe:${beatId}`, `beat_clip:${beatId}`), `actions`
lineage, and `TimelineSegment.beatId` all reference beat ids. The reparent migration
**must preserve `story_beats.id == storyboard_beats.id`** (and panels likewise) so
existing keyframes/clips/timeline stay attached. This is the single most important
invariant in the migration.

## Naming decision — reparent in place, do not rename the blueprint family

`story_blueprints` has many external FK dependents: `story_blueprint_characters`,
`_acts`, `_scenes`, `script_drafts` (composite FK), `catalog_entries.source_story_blueprint_id`,
`story_blueprint_elements`, `story_blueprint_character_arcs`,
`projects.current_story_blueprint_id`. Renaming the family to `story_*` would cascade
through all of them. **Recommendation: keep the `story_blueprint_*` table names**
(reparent in place; only `storyboard_beats/panels` get renamed to `story_beats/panels`)
to keep the FK blast radius small. Revisit a cosmetic rename later if desired.

## Code read-paths to repoint

API:
- [apps/api/src/lib/api/v1/storyboards.ts](../../apps/api/src/lib/api/v1/storyboards.ts) — REST surface (list/get/save scenes/beats/panels)
- [apps/api/src/lib/api/v1/storyboard.ts](../../apps/api/src/lib/api/v1/storyboard.ts), [store.ts](../../apps/api/src/lib/api/v1/store.ts) — store helpers (`getProjectStoryboard`, etc.)
- [apps/api/src/lib/orchestrator-tools/storyboard-job.ts](../../apps/api/src/lib/orchestrator-tools/storyboard-job.ts) — producer (`buildStoryboardForPlan`); flips input plan → blueprint, mints beats under scenes
- [apps/api/src/lib/orchestrator-tools/generate-keyframe.ts](../../apps/api/src/lib/orchestrator-tools/generate-keyframe.ts) (+ job) — consumer of selected panels
- `plan-shots.ts`, `plan-visual-anchors.ts`, `draft-script.ts`, `develop-story-blueprint.ts`, `assemble-timeline.ts`, `critique-timeline.ts` — per the tool re-pointing in the reorder

Web:
- `apps/web/src/lib/v1/storyboard/progress.ts`, `components/progress/ProgressView.tsx`,
  `components/progress/StoryboardBoard.tsx`, `components/storyboard/StoryboardEditor.tsx`
- `apps/web/src/lib/project-queries.ts`, `lib/api-client/v1-api.ts`, `lib/queryClient.ts` (query keys)

Also: `storyboard_search_chunks` (embeddings) likely references storyboard rows — confirm and repoint.

## EditPlan retirement

- Delete `EditPlan` type and `plan-shots`'s dependence on it as a *structure*; repurpose
  `plan_shots` to annotate `story_beats` with shot fields (or write a `beat_shots` child).
- Retire the `plan` asset kind as a scene/beat carrier. Audit every reader of
  `EditPlan.scenes[].beats[]` and repoint to `story_beats` (this is the larger code
  surface — `storyboard-job`, `generate-keyframe-job`, `generate-clip`,
  `generate-audio-job`, `plan-visual-anchors`, `critique-timeline` all import `EditPlan`).
- `planEdit` the LLM generator can stay as an implementation detail behind whatever
  mints beats, or be folded into the storyboard/blueprint generation.

## EditGraph retirement (separate, more careful)

- **Applied in PR 5:** deleted `packages/shared/src/edit-graph.ts` (`EditGraph`,
  `Patch`, `revisionOperations`, alternatives), removed the v1
  `getEditGraph`/`saveEditGraph` store surface, removed
  `compileTimelineViaEditGraph`, and retired old patch-emitting
  `critique`/`revise` behavior. The current migration chain had already dropped
  `public.edit_graphs` in `20260610120000_asset_graph_model.sql`.

## How AI edits work (for context — unchanged by this scope)

"Request Changes" on any object → `asset-revisions`/`board-revisions` records a
`board_feedback` action (`{ message, target }` + `proposal`) → run resumes → agent
re-runs the relevant tool scoped to the target → produces a **new** immutable asset,
re-points the `selection` (seq bump), supersedes the old action → downstream closure
recomputed over provenance → optional approval gate. Edits become *better* after
unification: they target real rows (`story_beats.id`, `story_acts.id`) instead of a
loose JSONB plan.

## Migration sequencing & safety

1. Additive schema migration: add columns to `story_blueprint_scenes`/`_acts`, create
   `story_beats`/`story_panels` (or rename-with-reparent), add RLS (owner +
   `project_is_public` read) mirroring the existing storyboard policies, carry over the
   snapshot trigger.
2. Backfill (Option A): map storyboard scenes → blueprint scenes, reparent beats/panels
   **preserving ids**, assign acts best-effort, flag ambiguous projects.
3. Repoint API + web read-paths; ship behind the same migration window.
4. Drop `storyboards`, `storyboard_scenes` (and `plan`/`edit_graphs` per their PRs).
5. Respect: no migration history rewrites (additive drop+create only), unique
   timestamps, verify via Management API after `db push` (migrations auto-apply via CI).

## Terminology — "Ask the AI" → "Request Changes"

The object-scoped edit entry point is renamed from "Ask the AI" / "Ask AI" to
**"Request Changes"**. Known surfaces:

- UI labels: `apps/web/src/routes/StoryboardPage.tsx:281` (`Ask AI`),
  `apps/web/src/routes/ProjectStepPage.tsx:276` (`Ask AI`),
  `apps/web/src/components/media/AssetEditModal.tsx:101` (`Ask the AI to edit`).
- Conceptual term in authoritative docs: `docs/ui-interaction-model.md`,
  `docs/NORTH_STAR.md` (Principle 10), `CLAUDE.md`, and scope docs
  (`dashboard-ui.md`, `dashboard-montage-alignment.md`, `studio-dashboard-redesign.md`,
  `user-profile-settings.md`).

**Decided: full conceptual rename** (UI labels + authoritative docs). Applied across
the UI strings, `NORTH_STAR.md`, `ui-interaction-model.md`, `CLAUDE.md`, and the scope
docs in this branch. "Request Changes" is now the canonical name of the interaction model.

## Open decisions

1. ~~Scene reconciliation strategy.~~ **Decided: A + C** (best-effort, regenerate on failure).
2. Shot fields on `story_beats` as columns vs a `beat_shots` child table.
3. ~~Act-level mockup asset: reuse `poster` role or add an `act_mockup` role.~~
   **Decided: dedicated `act_mockup` role** (poster stays the project thumbnail);
   generated via `POST …/storyboards/:storyboardId/acts/:actId/mockup`.
4. `storyboards.status` — derive from child statuses or keep an explicit head status.
5. ~~"Request Changes" rename scope.~~ **Decided: full conceptual rename, applied.**

## Suggested PR breakdown

1. **Schema + backfill**: additive spine columns, `story_beats`/`story_panels` reparent,
   RLS, backfill, preserving ids. (Does not drop old tables yet.)
2. **Repoint producers/consumers**: storyboard-job, generate-keyframe, plan-shots,
   plan-visual-anchors, draft-script + the web read-paths to the unified spine.
3. **Drop `storyboards`/`storyboard_scenes`** once no readers remain.
4. **Retire EditPlan**: remove the structure, repoint `EditPlan` readers to `story_beats`,
   retire the `plan` asset carrier.
5. **Retire EditGraph**: delete edit-graph.ts, `edit_graphs` table + v1 store surface,
   legacy patch agent functions. **Applied.**

### PR 3 readiness audit

PR 3 is a destructive schema cleanup and must not land before PRs 1 and 2 are
present in the target branch. On current `main` as of June 24, 2026, those
prerequisites are not yet present:

- No migration has created `story_beats` or `story_panels`.
- `story_blueprint_scenes` has not absorbed the storyboard scene fields needed
  for the surviving unified spine (`setting`, `mood`, `scene_asset_id`, `status`).
- Live API code still reads/writes `storyboards`, `storyboard_scenes`,
  `storyboard_beats`, and `storyboard_panels`.
- DB projections/RPCs still depend on the legacy tables:
  `project_manifest`, `storyboard_search_chunks`,
  `search_storyboard_chunks`, and `regenerate_asset_version`.
- Tool tests and smoke scripts still seed or assert against the legacy tables.

Before writing the PR 3 drop migration, run this audit from the repository root
and verify that only historical migrations and migration docs still mention the
retired containers:

```sh
rg -n "storyboards|storyboard_scenes" apps packages supabase \
  -g '!supabase/migrations/20260610130000_storyboard_relational_model.sql'
```

The PR 3 migration should then:

- replace any remaining DB functions/views that project storyboard container
  rows with projections from `story_blueprints` / `story_blueprint_scenes`;
- remove policies, triggers, indexes, and FKs owned by `storyboards` and
  `storyboard_scenes`;
- drop `storyboards` and `storyboard_scenes` without cascading into
  `story_beats` / `story_panels`;
- keep `storyboard_item_status` until the surviving beat/panel tables no longer
  depend on it, or rename it in a separate non-destructive migration.
