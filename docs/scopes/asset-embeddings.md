# Asset Embeddings Scope

> **Goal:** Add embeddings to the asset graph deliberately: embed the asset
> representations people and agents actually search for, at lifecycle points
> where the searchable meaning is stable, without embedding every internal row or
> every intermediate provider payload.

## Status

- **Status:** Planning document. No implementation in this PR.
- **This scope owns:** what gets embedded, when embeddings are created/refreshed,
  and the data model shape for asset-search embeddings.
- **This scope does not own yet:** provider choice, vector dimensions, rollout
  tuning, ranking weights, or UI copy.

## Current State

The asset graph already has the core metadata an embedding pipeline should
consume:

- `assets` has `workspace_id`, `project_id`, `kind`, `media`, `role`, `status`,
  `content`, `description`, `context`, `semantic_analysis`, provenance inputs,
  visibility, storage fields, and timestamps.
- Current public asset search is full-text search over `description`, selected
  `context` fields, transcript text, and `semantic_analysis`.
- Storyboards, scenes, beats, panels, selections, actions, and edges are
  relational product/provenance structure. They may provide text for embedding,
  but they are not all independently reusable assets.

That means embeddings should sit beside the asset graph as a search projection,
not replace the asset graph or turn relational product structure into JSONB.

## Principles

1. **Embed stable meaning, not raw churn.** Provider responses, partial job state,
   queued assets, and low-level action metadata can change or be noisy. Wait until
   the thing is ready enough that search results would be useful.
2. **Embed what can be reused.** The first pass should target project assets that
   users or agents can select, remix, inspect, or reuse.
3. **Use typed source text.** Build embedding text from known fields per asset
   kind. Avoid dumping arbitrary JSON into the embedding input.
4. **Keep embeddings rebuildable.** Store the source fingerprint/model/dimensions
   so changing source text rules or models can enqueue deterministic backfills.
5. **Respect visibility at query time.** Embeddings can exist for private assets,
   but search must still enforce workspace/project/asset visibility and RLS
   boundaries.
6. **Do not make embeddings a provenance source.** The asset graph remains the
   source of truth. Embeddings are derived indexes.

## What Gets Embedded

### P0: Embed

These are high-signal and directly useful for search or agent retrieval:

- **Uploaded source media**: `kind = source_footage`, media `image`/`video`/`audio`.
  Embed user context, agent analysis, transcript/clip understanding, and a short
  media description. This lets users find their own footage and lets agents pick
  useful references.
- **Generated reusable images**: `kind = anchor`, `keyframe`, or `poster`, media
  `image`. Embed the prompt intent, visual description, subject/character/scene
  context, and semantic analysis. These are likely to be reused as anchors,
  posters, references, or visual direction.
- **Generated clips**: `kind = clip`, media `video`. Embed beat intent, visual
  summary, transcript/narration if present, selected upstream anchor/keyframe
  context, and semantic analysis.
- **Generated audio**: `kind = audio_track`, media `audio`. Embed narration text,
  style/voice/music intent, transcript, and relevant beat/scene context.
- **Textual planning assets that are active or user-facing**: `brief`, `plan`,
  `story_blueprint`, and `narration_script` data assets. Embed them as project
  memory/search context, but rank them separately from media assets because they
  are not media the user can drag into a composition.

### P1: Maybe Embed

These should wait until the first pass proves useful:

- **Storyboard scene/beat rows.** The actual storyboard text lives in
  `storyboard_scenes` and `storyboard_beats`, not the `storyboards` header row.
  They are excellent retrieval chunks for "find the shot where..." queries, but
  they are relational storyboard rows rather than standalone assets. If embedded,
  model them as scoped chunks linked to their storyboard/scene/beat and any
  related `beat_asset_id` or selected panel image.
- **Prompt assets for storyboard panels.** Useful only if users search by prompt
  language or if the agent needs prompt reuse. Otherwise the selected image panel
  and beat text are better targets.
- **Composite/render assets.** Embed only if users need to search completed
  exports by content. These may be large aggregates where a project-level summary
  embedding is more useful than per-render duplication.

### Do Not Embed Initially

- `actions`, `asset_edges`, and `selections`. They are provenance/control-plane
  rows, not search targets.
- Pending/failed assets, unless the product explicitly needs "find failed
  attempts" debugging search.
- Raw provider responses, full params blobs, storage URLs, filenames alone, cost
  metadata, or audit snapshots.
- Every historical version by default. For mutable-head workflows, embed the
  active/current asset first; add history search later if there is a real user
  need.

## When Embeddings Are Created

### On Asset Ready

Create an embedding job when an asset transitions to `status = ready` and has
searchable source text.

Examples:

- Uploaded media analysis completes and writes `semantic_analysis` or context.
- Generated image/video/audio finishes and the asset row has prompt/context.
- A data asset such as brief/plan/story blueprint/narration script is selected
  as current.

If an asset is ready but analysis is still pending, defer embedding until the
analysis lands, or create a minimal embedding and enqueue a refresh after
analysis.

### On Meaningful Metadata Change

Refresh the embedding when fields that feed the embedding text change:

- `description`
- `context`
- `semantic_analysis`
- data-asset `content`
- role/depicts-like fields if they become first-class columns
- transcript/narration fields used in embedding text

Do not refresh for URL changes, bucket moves, visibility toggles, timestamps, job
metadata, or selection changes unless the selected/current state is explicitly
part of the embedding text.

### On Selection Changes

Selection changes should usually affect ranking/filtering, not the vector itself.
For example, a poster becoming the current poster does not change what the image
depicts. Store selection state in relational filters or ranking features instead
of re-embedding the same pixels/text.

The exception is active data assets where the "current brief" or "current plan"
is what we want to retrieve as project memory. In that case, selection can enqueue
embedding for the newly active data asset if it does not already have one.

### Backfills

Backfills should be explicit jobs:

- create embeddings for existing eligible assets;
- rebuild when the embedding model changes;
- rebuild when source text extraction rules change;
- retry failed embedding jobs without blocking asset generation.

## Data Model Sketch

Use a separate table so embeddings remain a rebuildable projection:

```sql
create table public.asset_embeddings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  chunk_key text not null,
  chunk_kind text not null,
  embedding_model text not null,
  embedding_dimensions integer not null,
  source_hash text not null,
  source_text text not null,
  embedding vector, -- exact dimensions chosen in implementation PR
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, chunk_key, embedding_model)
);
```

Notes:

- `chunk_key` should be stable, e.g. `asset.summary`, `asset.transcript`,
  `plan.scene.3`, or `storyboard.beat.<beat_id>`.
- `chunk_kind` lets ranking distinguish media descriptions, transcript chunks,
  planning chunks, and storyboard chunks.
- `source_text` is stored intentionally for debugging/rebuild transparency. If it
  becomes too large or privacy-sensitive, store a preview plus source hash.
- If Supabase/production does not yet have pgvector enabled, the first migration
  should add the extension and choose indexing separately from this planning PR.

If we embed non-asset storyboard rows later, use a sibling table or generalize
the owner columns:

```sql
owner_type text not null, -- asset | storyboard_scene | storyboard_beat
owner_id uuid not null
```

For the first implementation, prefer asset-only ownership to keep the blast
radius small.

## Source Text Rules

Build one or more chunks per asset from typed fields:

- **Brief**: goal, audience, platform, tone, constraints, aspect ratio, duration.
- **Plan/story blueprint**: story direction, scene summaries, beat intents,
  visual descriptions, intended narration.
- **Narration script/audio**: narration text, voice/style, timing, related scene
  or beat labels.
- **Uploaded media**: user description, transcript, clip-understanding summary,
  detected subjects/actions/settings, agent context.
- **Generated image/poster/keyframe/anchor**: prompt intent, visual description,
  subject/character/scene context, negative constraints when meaningful, selected
  upstream brief/plan snippets if compact.
- **Generated video clip**: beat intent, visual summary, narration/transcript,
  upstream keyframe/anchor descriptions, scene context.

Do not embed raw JSON wholesale. The source builder should produce concise,
labeled text so nearest-neighbor matches are based on product meaning rather than
schema noise.

## Query Shape

The first query path should support:

- workspace/project-scoped search for the user's own assets;
- public discovery search for effectively public assets;
- optional filters for media type, graph kind, role, project, and active/current
  state;
- hybrid ranking: vector similarity plus existing full-text match, recency,
  selected/current state, and asset readiness.

Security requirements:

- Query joins must still enforce workspace membership for private assets.
- Public discovery must require both asset and project effective public
  visibility.
- Service-role jobs may write embeddings, but user-facing reads cannot bypass the
  same visibility rules used for assets.

## Proposed PR Breakdown

1. **PR 1: Schema and typed source builders.**
   Add pgvector/`asset_embeddings`, source-hash helpers, and pure functions that
   convert eligible asset rows into embedding source chunks. No provider calls.

2. **PR 2: Embedding worker and enqueue points.**
   Enqueue on asset-ready and meaningful metadata changes. Add retryable jobs and
   model/dimension configuration.

3. **PR 3: Search API.**
   Add workspace/project asset semantic search with visibility-safe joins and
   hybrid full-text/vector ranking.

4. **PR 4: Public discovery and agent retrieval.**
   Use embeddings in public discovery and expose a constrained retrieval helper
   for generation/orchestrator tools.

5. **PR 5: Storyboard/search chunks, if needed.**
   Add storyboard scene/beat retrieval chunks only after asset-level search
   proves the gap.

## Open Questions

- Which embedding model and dimensions should we standardize on for production?
- Do we store full `source_text` or only a debug preview plus hash?
- Should historical asset versions be searchable by default, or only active
  selections/current heads?
- Should public discovery rank reusable media above planning/data assets even
  when semantic similarity is lower?
- Do we need per-chunk deletion retention for privacy/export requests, or is
  cascade from `assets` sufficient for the first pass?
