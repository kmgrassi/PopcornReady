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
