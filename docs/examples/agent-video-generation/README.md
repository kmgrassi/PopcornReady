# Agent Video Generation API — Examples

Worked examples for the `/api/v1` agent surface described in
[../../scopes/agent-video-generation-api.md](../../scopes/agent-video-generation-api.md).

> **Status: incremental agent API.** Project, asset, generated-asset, revision,
> export, and artifact endpoints exist today. Export jobs still emit a
> `pending_render` artifact rather than a finished MP4. Composition,
> timeline-generation, and audio-alignment endpoints remain future PR work, so
> the prompt-only and hybrid flows below are still partially aspirational.

## Local mode

Hosted, API-key auth is PR1 and not implemented. For now every request must run
in local mode, which resolves to a deterministic development workspace:

```bash
AUTH_MODE=local npm run dev
```

Without `AUTH_MODE=local`, every `/api/v1` request returns a typed
`auth_not_configured` (HTTP 501) error.

## Implemented endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/v1/projects` | Create an agent-addressable project. |
| `GET` | `/api/v1/projects/:projectId` | Read project state. |
| `PUT` | `/api/v1/projects/:projectId/brief` | Upsert the project brief. |
| `POST` | `/api/v1/projects/:projectId/brief-versions` | Create a versioned brief snapshot. |
| `POST` | `/api/v1/projects/:projectId/assets` | Register source media. |
| `GET` | `/api/v1/projects/:projectId/assets` | List normal project assets, including generated ones. |
| `POST` | `/api/v1/projects/:projectId/generated-assets` | Generate an image, video, or audio asset. |
| `GET` | `/api/v1/projects/:projectId/generated-assets/:jobId` | Poll an asset-generation job. |
| `POST` | `/api/v1/projects/:projectId/timelines/:timelineId/revisions` | Wired to the editorial agent. Creates a sibling cut. |
| `GET` | `/api/v1/projects/:projectId/timelines/:timelineId/revisions/:jobId` | Poll a revision job. |
| `POST` | `/api/v1/projects/:projectId/timelines/:timelineId/exports` | Skeleton. Validates + plans duration, emits a `pending_render` artifact. |
| `GET` | `/api/v1/projects/:projectId/exports/:jobId` | Poll an export job. |
| `GET` | `/api/v1/projects/:projectId/artifacts/:artifactId` | Read an artifact record. |

Jobs use the scope doc's envelope shape:

```json
{ "job": { "id": "job_…", "type": "revision", "status": "succeeded", "projectId": "proj_…", "createdAt": "…", "updatedAt": "…" } }
```

Errors use the stable error envelope:

```json
{ "error": { "code": "audio_timeline_mismatch", "message": "…", "requestId": "req_…", "details": {} } }
```

See [revision.http](./revision.http), [export.http](./export.http), and
[provider-generation.http](./provider-generation.http) for request/response
examples.

## Generated asset smoke calls

[provider-generation.http](./provider-generation.http) exercises the agent
generated-assets endpoint and the older mounted beat media endpoints that route
into the same provider pipeline.
It includes examples for:

- Mock image, video, and narration asset generation.
- xAI Grok Imagine image generation.
- xAI Grok Imagine video generation.
- Kling video generation.
- Seedance 2.0 video generation through fal.ai.

## Target agent flows

These are the three PR6 acceptance flows. Today only the revise → export tail
runs; the asset/composition/generation steps depend on PR1–PR5.

1. **Asset-driven** — register source media → generate timeline → revise →
   export. _(generate timeline needs PR4; export render needs PR5.)_
2. **Prompt-only** — brief → composition plans generated assets → generate
   timeline → export. _(generated assets are available; needs PR3/PR4/PR5.)_
3. **Hybrid** — provide some assets, generate the rest → timeline → export.
   _(project/assets/generated assets are available; needs PR3–PR5.)_

## Running the smoke harness

The smoke harness in
[`src/lib/agent-api/__tests__/agent-smoke.test.ts`](../../../src/lib/agent-api/__tests__/agent-smoke.test.ts)
covers the job lifecycle, idempotency, the revision worker, and the export
duration policy. The three full prompt→MP4 flows are declared with `test.todo`
until PR1–PR5 land.

```bash
npm test
```
