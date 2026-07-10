<p align="left">
  <a href="https://popcornready.ai">
    <img src="./public/brand/popcorn-ready-logo.svg" alt="Popcorn Ready logo" width="140" />
  </a>
</p>

**Popcorn Ready** is an AI-native video editor that turns clips and your brief into an editable timeline quickly.

- **Upload media and descriptions**
- **Generate a rough cut automatically**
- **Request AI changes**
- **Preview in-browser and export MP4**

🌐 **Website:** https://popcornready.ai

## What it is

Popcorn Ready is a content production workflow:

```
goal + clips
   |
   ↓
planEdit()      goal → beats              (Claude, structured JSON)
   ↓
selectClips()   beats + clips → timeline  (Claude, structured JSON)
   ↓
critique()      timeline → scores                       (Claude)
   ↓
Remotion        timeline → <Player> preview + MP4 export
```

1. Upload your video and image assets with short descriptions.
2. Give the app a creative goal, target length, and style.
3. Generate a first-pass timeline and a critic response.
4. Request object-scoped changes through the agent.
5. Preview in Remotion and export to MP4.

The editor never directly manipulates raw footage. It plans a structured
timeline model (`packages/shared/src/types.ts`) and then renders it
deterministically.

- Changes flow through graph-linked actions and selected assets.
- Asset metadata and generated media are organized per project store.
- Rendering is reproducible across preview and export.

## Architecture & direction

The codebase is a **pnpm + Turbo monorepo** (the original Next.js monolith in
`src/` is being removed). See
[`docs/repository-structure.md`](docs/repository-structure.md) for the full
directory map. The split:

- **Frontend** — Vite + React Router v7 (data mode) SPA → Netlify, with
  **TanStack Query** for server-state caching, mutations, polling, and
  invalidation.
- **Backend** — Express API → Railway (logic, the generation/job stack, Supabase).
- **Data/auth** — Supabase (Postgres + Storage + Auth); app identity is
  `public.users.id`, mapped from `auth.uid()` only inside RLS.

New DB/Storage/auth work targets the split, not the monolith. The full plan,
rationale, and PR breakdown live in
[`docs/scopes/supabase-cutover-prs.md`](docs/scopes/supabase-cutover-prs.md); see
also the agent guide [`CLAUDE.md`](CLAUDE.md) and the identity model in
[`docs/supabase-identity-and-rls.md`](docs/supabase-identity-and-rls.md).

### Front-end state direction

Use **TanStack Query** for front-end state that is owned by the API or Supabase:
workspace summaries, projects, assets, outputs, generation runs, draft records,
signed media URLs, mutations, polling, retries, and cache invalidation. The
`QueryClientProvider` is installed at the Vite app root in
`apps/web/src/main.tsx`, and the shared client lives at
`apps/web/src/lib/queryClient.ts`.

Keep local React state for ephemeral UI state: form inputs before persistence,
open/closed panels, selected tabs, inline editor drafts, focused controls, and
temporary review notes. Do not introduce Redux, Zustand, or another global
client store for API data. When migrating existing screens, prefer small
route-by-route changes: wrap existing functions from `apps/web/src/lib/*` in
`useQuery` / `useMutation`, replace manual loading/error state, and invalidate
or update the relevant query keys after mutations.

## Features

- **Structured pipeline**
  - `planEdit`, `selectClips`, `critique`, and `revise` run through stable JSON
    contracts.
- **AI review loop**
  - Timeline suggestions are scored and patched before final playback.
- **Interactive revision**
  - Ask for changes in plain language and apply targeted patch updates.
- **Generative fallback assets**
  - Missing visuals can be auto-generated from provider integrations.
- **Export-ready output**
  - In-browser preview and MP4 export are part of the same timeline pipeline.

## Who it is for

- Marketers and creators iterating quickly on short-form campaigns.
- Product teams creating consistent brand motion content.
- Creators wanting a fast first draft before manual finishing.

## Typical flow

1. Upload media assets.
2. Add short descriptions for each asset.
3. Use **Generate missing asset** for any gaps.
4. Set length/aspect/style, then click **Generate rough cut**.
5. Inspect the plan, timeline, and critic scores.
6. Revise with commands like:
   - make it punchier
   - shorten to 15s
   - add captions
   - use less talking head
7. Export MP4.

## Setup

```bash
pnpm install
cp .env.local.example .env.local   # add provider keys (Supabase, ANTHROPIC_API_KEY, …)
pnpm db:local:start                 # starts the local Supabase stack
pnpm dev:local-db                   # runs both apps against local Supabase/Postgres
# or individually:
pnpm dev:api                        # Express API → http://localhost:4000
pnpm dev:web                        # Vite SPA    → http://localhost:3000
```

Open the web app at http://localhost:3000 (it calls the API on :4000).

`pnpm dev:local-db` is the recommended local command. It injects the running
local Supabase URL and keys for both the API store and browser auth; `pnpm dev`
is for environments that already provide equivalent Supabase settings.

**Env loading:** the `.env*` files live at the **repo root** and load
automatically — the API reads `.env.local` (authoritative, your local secrets),
then `.env.<NODE_ENV>`, then `.env`, **regardless of which start script you
use** (`pnpm dev`, `pnpm dev:api`, or `pnpm --filter @popcorn/api start`).
Production injects env vars directly (Railway service variables), so no `.env`
files are needed there.

### Local Supabase/Postgres for tests

The default `DB_BACKEND=local` in `.env.local.example` is the file-backed JSON
store under `.local/`. To test against a true local database, use the Supabase
CLI stack:

```bash
pnpm db:local:start
pnpm db:local:reset
pnpm dev:local-db
pnpm test:e2e:local-db
```

The local dev and test commands read the local Supabase URL and keys from
`supabase status`, set `DB_BACKEND=supabase`, and point both API and Vite auth
env at the local Supabase API URL from `supabase status`. The local-db E2E
command also uses `AUTH_MODE=supabase` and creates a real local user, so the
login, JWT verification, domain-user mapping, and RLS path match production.
See [`supabase/README.md`](supabase/README.md) for the hosted-vs-local migration
commands.

The home page (`/`) is the public landing page and current creation entry point.
It lets a visitor describe a video, choose a target length, and either create an
account or continue as a guest. The quick-start flow creates a project/run and
lands on `/projects/:projectId/runs/:runId`.

Generation uses the configured provider stack. Gemini Veo, OpenAI Sora, NVIDIA
Cosmos, Ideogram, ElevenLabs, and image providers are enabled only when their keys are set;
otherwise generation should fail with a clear configuration error. Existing work
is reviewed from the dashboard, Library collections, project detail,
storyboard, watch, and run-progress routes. The older `/studio` wizard route is
not currently mounted in the Vite app.

Typical current flow:

1. Start from `/` with a prompt and length.
2. Create an account or continue as a guest.
3. Watch the run progress page for stage/status updates and review gates.
4. Review generated work from `/dashboard`, `/library/*`, project detail, or
   storyboard/watch routes.
5. Use asset/project visibility, storyboard editing, and run review actions from
   their current surfaces.

## Scope / limitations

- Clip understanding is description-based — no FFmpeg proxies, Whisper
  transcription, vision tagging, or embeddings yet. Those are the "real
  analysis" extension from the architecture doc.
- Local development can use either the JSON file store (`DB_BACKEND=local`) or a
  true local Supabase/Postgres database (`DB_BACKEND=supabase` with
  `pnpm db:local:start`).
- Some rich creation/editor surfaces are still being migrated from the retired
  Studio wizard into the split app.
- Generated audio is saved as an asset but is not yet mixed into exported
  timelines. Audio clips are excluded from visual clip selection prompts.
- Provider-backed generation/export requires the relevant provider keys.

## Productionization docs

- [`docs/productionization-scope.md`](docs/productionization-scope.md)
- [`docs/railway-deployment.md`](docs/railway-deployment.md)
- [`docs/streaming-generation-plan.md`](docs/streaming-generation-plan.md)

Railway configuration is in `railway.toml`; healthcheck is `/api/v1/health`.

## Deploy to Railway

Railway deployment notes live in
[`docs/railway-deployment.md`](docs/railway-deployment.md). The repo includes a
`railway.toml` that uses Railpack, builds with
`pnpm --filter @popcorn/api... build`, starts the service with
`pnpm --filter @popcorn/api start`, and healthchecks `/api/v1/health`.

Set the provider keys from `.env.local.example` as Railway service variables.
For a hosted demo, be aware that the current MVP stores project state and media
on the local filesystem; see the Railway deployment doc for the persistence
limitations and production storage recommendations.

## NVIDIA Cosmos Video Generation

Popcorn Ready includes an NVIDIA API Catalog provider for Cosmos3 Nano video
generation. It is wired into the existing generative provider layer as
`nvidia_api_catalog` and can be used anywhere the app accepts a video provider.

Configuration:

```bash
NVIDIA_API_KEY=...
NVIDIA_VIDEO_GENERATION_BASE_URL=https://ai.api.nvidia.com/v1/genai
NVIDIA_VIDEO_GENERATION_MODEL=nvidia/cosmos3-nano
```

Manual local smoke:

```bash
pnpm dev:api
NVIDIA_API_KEY=... pnpm video:smoke
```

The smoke uses the existing v1 generated-assets adapter:
`POST /api/v1/projects/:projectId/generated-assets`, then polls the returned job,
reads the persisted local asset, and writes it to
`artifacts/video-generation/cosmos3-nano-smoke.mp4`. Override the prompt, project,
and output path with `VIDEO_GENERATION_SMOKE_PROMPT`,
`VIDEO_GENERATION_SMOKE_PROJECT_ID`, and `VIDEO_GENERATION_SMOKE_OUTPUT`.

## Project layout

See [`docs/repository-structure.md`](docs/repository-structure.md) for the
current monorepo map. Active app code lives in `apps/web`, `apps/api`, and
`packages/*`; the legacy `src/` tree is being retired.
