# Production fixture corpus

This directory lists production-style assets that Popcorn Ready should be able
to generate through the normal app flow. These fixtures are not an AI-quality
eval set and they are not a parallel data model. They are a broad smoke corpus:
movie posters, character anchors, product stills, short video clips, and audio
tracks that we want to create anyway as examples.

A harness should create real projects in a workspace whose `workspaces.purpose`
is `fixture` or `internal_test`, call the normal generation API for each asset
prompt, then assert against the existing production tables.

Use **one project per manifest asset**. Do not put the whole corpus under one
project: generated roles, selections, and retries can legitimately replace prior
outputs inside a project, which makes corpus assets overwrite each other. The
project name/slug should include the manifest asset `id`.

- `projects`
- `assets`
- `asset_edges`
- `selections`
- `actions`
- `orchestrator_runs`
- `jobs`
- `story_blueprints`, `story_scenes`, `story_beats`, `story_panels`
- `catalog_entries` when a fixture is promoted as a reusable example
- `judgments` when quality checks are attached

The manifest intentionally avoids judging whether the AI made the "right"
creative choices. Running it against real providers checks production mechanics:
API request handling, provider calls, job state, graph writes, storage, delivery
metadata, errors, and optional catalog publishing.

## Maintaining The Corpus

`manifest.json` is the source of truth for the assets we want to generate during
real provider-backed manual tests. Manual testers should update that manifest
instead of keeping separate prompt lists in notes, tickets, or ad hoc docs.

Before adding a new asset:

1. Search `manifest.json` for the intended subject, role, visual style, and
   output kind. Check both `id` and `prompt`; similar wording often means the
   asset already exists.
2. Prefer reusing an existing manifest asset when it covers the same test need,
   even if the title or prompt is not exact.
3. Add a new entry only when it exercises a meaningfully different product
   surface, provider path, media type, aspect ratio, role, or storage/delivery
   behavior.
4. Pick a stable kebab-case `id` that describes the asset, not the tester or
   date. Do not reuse ids.
5. Keep `role`, `kind`, `media`, and `aspectRatio` consistent with nearby
   entries so the harness can group and filter the corpus predictably.
6. Keep prompts production-style and reusable as examples; avoid temporary
   debugging language such as "test", "please generate", ticket numbers, or PR
   references inside the prompt.

When a manual pass discovers a useful generated asset that is not represented in
the corpus, add or adjust a manifest entry in the same PR as the manual-test doc
update. If the generated asset is only a one-off debugging artifact, do not add
it to the corpus.

## Harness Contract

For each asset:

1. Create or reuse a fixture workspace.
2. Create or reuse a dedicated real fixture project for that asset only.
3. Call the same API path the app uses to generate that asset kind/media.
4. Poll the job or orchestrator action until it reaches a terminal state.
5. Assert only mechanical facts: success status, asset row, requested
   kind/media/role, delivery metadata for media, and structured errors on
   failure.
6. Leave successful fixture assets around when they are useful examples; clean
   up only throwaway `internal_test` runs.
