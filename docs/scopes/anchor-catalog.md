# Anchor Catalog — shared starting points for projects (scope + PR breakdown)

**Status: planned · June 18, 2026**

## What this document is

A scope for **Anchors**: reusable, shareable creative starting points — a
**character**, a **story overview**, or a **reference image** — that any user
can publish and that everyone can pull into their own project as a base.

This is deliberately a **power-user / tucked-away surface**, not part of the
main "create a video end-to-end" flow. It lives in its own area of the
dashboard, is reachable from quiet entry points, and never injects itself into
the primary Create wizard. Think "a shelf of starting blocks power users curate
and reach for," not "step 0 of every video."

This doc covers the data model, the copy-into-project semantics, the API, the
dashboard UI, and a PR sequence. It is grounded against the repo as of
June 18, 2026.

## Decisions locked (from product)

- **Deliverable:** scope first; implementation follows once aligned.
- **Who can publish:** any user can publish their own assets/blueprints. At
  launch there is **no approval step** — publishing makes the entry public
  immediately. An approval/moderation gate is **deferred** (see §6).
- **How an anchor is used:** **copy-into-project**. Using an anchor *clones* it
  into the caller's project as new asset-graph nodes with provenance back to the
  catalog source. **No cross-project live references** — that would violate the
  intra-project edge invariant and asset immutability (see §3).
- **Search:** ride the **asset embeddings** index, not a bespoke catalog index
  (see §1, §5). Anchors and story blueprints are already in the embeddings P0
  set, so catalog search is a query against work already underway.

## North Star alignment

The asset graph is the provenance spine
([NORTH_STAR.md](../NORTH_STAR.md),
[north-star-provenance-graph.md](./north-star-provenance-graph.md)). Anchors do
**not** bypass it:

- An anchor's payload is always backed by real asset-graph nodes (an `anchor`
  image asset, or a `story_blueprint` + its `story_blueprint_*` rows).
- "Using" an anchor produces **new immutable asset rows in the target project**,
  exactly as if the agent had generated them, with a `source` provenance stamp
  pointing at the catalog entry. Downstream generation, staleness, and selection
  behave normally from there.
- The catalog is a thin **publication + discovery + clone** layer on top. It is
  not a new generation pipeline and must not be wired into the main Create flow
  as a mandatory stage. Per [CLAUDE.md](../../CLAUDE.md), stable user-facing
  objects get **relational tables** (we add `catalog_entries`), and JSONB is
  reserved for typed snapshots/audit only.

## 1. Current state — what we build on (verified against the repo)

Already shipped or in flight; the catalog reuses these rather than reinventing
them:

- **Asset kinds we need already exist.** `graph_asset_kind` includes `anchor`
  (reference image with identity invariants — characters/images fold here),
  plus `brief`/`plan`/`story_blueprint`
  (`supabase/migrations/20260610120000_asset_graph_model.sql`,
  `20260616120000_story_blueprint_asset_kind.sql`).
- **Story overview is already a first-class relational model.**
  `story_blueprints` + `story_blueprint_characters` + `story_blueprint_acts` +
  `story_blueprint_scenes` (`20260616121000_story_blueprints.sql`). A story
  anchor *is* a published blueprint. Characters inside a blueprint give us a
  natural source for character anchors.
- **Public visibility + discovery exist.** `assets.visibility` /
  `projects.visibility`, `asset_is_effectively_public()` /
  `project_is_public()` (scoped to `workspace.purpose = 'user'`,
  `20260615130000_production_test_sandboxes.sql`), the `/discover/*` routes
  (`apps/api/src/routes/v1/discover.ts`), and the `assets_public_feed_idx`
  index (`20260610120000_asset_graph_model.sql`).
- **Embeddings search is being built now.** `docs/scopes/asset-embeddings.md`
  adds a vector search projection beside the asset graph, with **`anchor`,
  `keyframe`, `poster`, `brief`, `plan`, and `story_blueprint` explicitly in the
  P0 embed set** — exactly the kinds the catalog surfaces. Catalog search should
  query that index (filtered to published entries) rather than standing up its
  own full-text index. The existing `search_public_assets()` GIN path is the
  interim fallback until embeddings land.
- **Bookmarks already exist.** `saved_assets` (user_id, source_asset_id) with
  RLS that only allows bookmarking effectively-public assets. A catalog "save
  for later" can reuse this pattern (see §10).
- **Managed storage + leak-safe URL resolution exist.**
  `apps/api/src/lib/storage/asset-urls.ts` (`resolveAssetUrl`, presigned private
  URLs, stable public CDN URLs) and `asset-write.ts`
  (`{workspaceId}/{projectId}/{assetId}/{filename}` key format). Copy-into-
  project reuses the write path so clones live under the consumer's namespace.

What does **not** exist yet (this scope):

- Any notion of a *curated catalog* distinct from "a user made their own asset
  public." `/discover` surfaces public assets/projects raw; there is no
  publishable, titled catalog unit, no character/story/image framing, and no
  clone-into-project operation.

## 2. Concept & terminology

An **Anchor** is a published, reusable starting point. Three kinds at launch:

| Anchor kind | User sees | Backed by | Copy produces |
|-------------|-----------|-----------|---------------|
| **Character** | A named character with a reference image + description | one `anchor` image asset; optional linked `story_blueprint_characters` description | a new `anchor` asset in the target project (bytes copied) |
| **Story** | A story overview: logline, acts, scenes, cast | a `story_blueprint` (+ acts/scenes/characters) and its `brief`/`plan` data assets | a new `story_blueprint` (+ children) in the target project, set as `current_story_blueprint_id` |
| **Image** | A single reference image (style frame, setting, prop) | one `anchor` (or image) asset | a new `anchor` asset in the target project (bytes copied) |

Product-facing name: **Anchors** (the user's word — "something to anchor on").
Data layer name: **catalog** (`catalog_entries`). Keep these distinct so the DB
term doesn't leak into UI copy.

## 3. Data model

One new relational table (per the asset-graph migration rule: stable user-facing
objects are relational; JSONB only for typed snapshots/audit).

### `catalog_entries` — the publishable unit

```sql
create type public.catalog_entry_kind   as enum ('character', 'story', 'image');
-- Launch states only. Approval states (e.g. 'pending_review', 'rejected') are
-- intentionally NOT added yet — see §6. Adding an enum value later is additive.
create type public.catalog_entry_status as enum ('draft', 'published', 'archived');

create table public.catalog_entries (
  id                  uuid primary key default gen_random_uuid(),
  schema_version      text not null default 'catalogEntry.v1',
  kind                public.catalog_entry_kind   not null,
  status              public.catalog_entry_status not null default 'published',

  -- Publisher identity (domain id, never auth.uid()).
  publisher_user_id   uuid not null references public.users(id) on delete cascade,

  -- Source lineage in the publisher's own project. The catalog points AT the
  -- asset graph; it does not own bytes. Exactly one of source_asset_id /
  -- source_story_blueprint_id is set, by kind.
  source_workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  source_project_id          uuid not null references public.projects(id)   on delete cascade,
  source_asset_id            uuid references public.assets(id),            -- character/image
  source_story_blueprint_id  uuid references public.story_blueprints(id),  -- story

  -- Curated, world-readable presentation (no project internals leak).
  title               text not null,
  summary             text,
  tags                text[] not null default '{}',
  preview_asset_id    uuid references public.assets(id),  -- thumbnail (effectively-public)

  -- Immutable presentation snapshot taken at publish time, so the catalog card
  -- is stable even if the publisher later edits/deletes the source.
  snapshot            jsonb not null default '{}'::jsonb,

  -- Lightweight popularity counter, incremented inline on /use. No separate
  -- per-use table at launch (provenance lives on the cloned asset's `source`).
  use_count           integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint catalog_entry_source_by_kind check (
    (kind in ('character','image') and source_asset_id is not null
       and source_story_blueprint_id is null)
    or (kind = 'story' and source_story_blueprint_id is not null
       and source_asset_id is null)
  )
);

create index catalog_entries_published_feed_idx
  on public.catalog_entries (created_at desc)
  where status = 'published';
create index catalog_entries_kind_idx on public.catalog_entries (kind)
  where status = 'published';
create index catalog_entries_publisher_idx on public.catalog_entries (publisher_user_id);
```

`snapshot` is the only JSONB and holds a **typed, versioned presentation copy**
(logline, act/scene titles, character names/descriptions, dimensions) — audit
data, not product structure the UI edits. The editable truth stays in the
relational source rows.

No full-text/GIN index on `catalog_entries`: search rides the asset embeddings
index (§1, §5), so the catalog only needs the feed/kind indexes above.

### Provenance of clones

There is **no `catalog_uses` table**. The clone records provenance inline on the
new asset:

```
assets.source = { "via": "catalog", "catalogEntryId": "…", "sourceAssetId": "…" }
```

(allowed JSONB: audit snapshot). Lineage is discoverable from the single asset
row. `catalog_entries.use_count` is a denormalized popularity counter,
incremented inline on `/use`. If per-use analytics are needed later, a
`catalog_uses` table can be added then — it is not required for launch.

### RLS

Follow the identity rules in
[supabase-identity-and-rls.md](../supabase-identity-and-rls.md) —
`public.current_app_user_id()`, never `auth.uid()`.

`catalog_entries`:
- **Public read** (`anon`, `authenticated`): `status = 'published'` only.
- **Owner read/write**: `publisher_user_id = current_app_user_id()` for all
  statuses (so the publisher can see their own drafts/archived). Owner may
  insert/update/delete their own rows; the API validates source ownership and
  builds the snapshot.
- A publish insert must reference a source the caller owns: enforce in the API
  layer (the user-scoped client can read its own source; the publish handler
  verifies ownership before writing the entry).

**Effective-public requirement for delivery.** A character/image entry can only
render a preview if its `preview_asset_id` / `source_asset_id` is
**effectively public** (`asset_is_effectively_public`). Publishing therefore
either (a) requires the source asset already public, or (b) flips the source
asset (and its owning project, or a dedicated published copy) to public as part
of publish. Recommended: **publish copies the source bytes into a managed,
publicly-readable catalog namespace** so the publisher is not forced to make
their whole project public. See §4.

## 4. Copy-into-project & publish semantics

### Publishing (any user)

`POST /catalog/entries` with `{ kind, sourceAssetId | sourceStoryBlueprintId,
title, summary, tags }`:

1. Verify the caller owns the source (user-scoped read).
2. Build the typed `snapshot` from the relational source.
3. **Materialize a deliverable preview.** For character/image: copy the source
   image bytes into a managed, public catalog storage namespace (reuse
   `asset-write.ts`; a `catalog/{entryId}/…` key in the public bucket) and set
   `preview_asset_id`. This decouples catalog delivery from the publisher's
   project visibility (they don't have to make their project public).
4. Insert `catalog_entries` with `status = 'published'` — the entry is public
   immediately (no approval step at launch; see §6). A `draft` status exists for
   "save metadata without publishing yet," but the default publish action goes
   straight to `published`.

### Using (copy-into-project)

`POST /catalog/entries/:id/use` with `{ targetProjectId }` (or
`{ createProject: { name } }`):

1. Load the published entry (public read).
2. Verify caller owns `targetProjectId`.
3. **Character/image:** create a new `anchor` asset in the target project;
   copy bytes from the catalog namespace into
   `{targetWorkspace}/{targetProject}/{newAssetId}/…` via `asset-write.ts`;
   stamp `source = { via: 'catalog', catalogEntryId, sourceAssetId }`. Return
   the new asset.
4. **Story:** clone the `story_blueprint` + its `acts`/`scenes`/`characters`
   into the target project (new rows, new ids, status `draft`), create the
   backing `brief`/`plan`/`story_blueprint` data assets, set the project's
   `current_story_blueprint_id`. Stamp provenance on the new blueprint.
5. Increment `catalog_entries.use_count` (inline; no separate use row).
6. The new nodes are ordinary asset-graph members — generation/staleness/
   selection proceed from there unchanged.

All clones are **new immutable rows**; nothing is shared or mutated across
projects, so the intra-project edge FK and `assets_guard_immutable` invariants
hold.

## 5. API surface

New protected router `apps/api/src/routes/v1/catalog.ts`, mounted in
`protected-routes.ts`. Public browse can live on the existing `discover`/public
router so unauthenticated users can window-shop, with `/use` and publish staying
protected.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /catalog/entries?kind=&limit=&cursor=` | public | Browse published anchors (paginated feed) |
| `GET /catalog/search?q=&kind=` | public | Search published anchors (rides the asset embeddings index; GIN fallback until it lands) |
| `GET /catalog/entries/:id` | public | Entry detail (snapshot + resolved preview URL) |
| `POST /catalog/entries` | user | Publish from an owned source asset/blueprint (goes live immediately) |
| `PATCH /catalog/entries/:id` | publisher | Edit own entry metadata |
| `POST /catalog/entries/:id/use` | user | **Copy-into-project** (the core action) |
| `DELETE /catalog/entries/:id` | publisher | Archive own entry |
| `GET /catalog/mine` | user | Publisher's own entries (all statuses) |

Store functions land in `apps/api/src/lib/api/v1/` (e.g. a new `catalog.ts` +
store helpers), following the `assets.ts` route → `lib/api/v1` handler → `store`
flow. Preview URLs resolved via `resolveAssetUrl` so private/public delivery and
leak-prevention are inherited for free. Search delegates to the embeddings query
helper from the asset-embeddings work, scoped to `status = 'published'`.

Schemas: add parsers (`parsePublishCatalogEntry`, `parseUseCatalogEntry`, …) in
`apps/api/src/lib/api/v1/schemas.ts` alongside the existing asset parsers.

## 6. Deferred: approval & moderation

**Not in launch scope.** Publishing goes straight to `published`; there is no
review queue, reviewer, or rejection state. This keeps the first cut simple and
matches the product decision ("if someone makes it public, it's public").

When we build it later, the design stays additive:

- Add `pending_review` / `rejected` values to `catalog_entry_status` (additive
  enum change) and reviewer columns (`reviewed_by_user_id`, `reviewed_at`,
  `review_notes`) to `catalog_entries`.
- Gate publish behind `pending_review` and add an admin review queue
  (`/admin/catalog`) reusing the existing `AdminRoute` (`hasAdminClaim`,
  `app_metadata` roles) + server-side `requireEvalAdmin` pattern
  (`apps/api/src/routes/v1/eval.ts`). Moderation stays on the trusted
  `getServiceSupabase()` path — no broad client-side admin RLS.
- **Takedown** is the one moderation-adjacent capability we may want sooner:
  an admin moving `published → archived`. Archiving does **not** retroactively
  delete clones already copied into users' projects (they are independent
  immutable assets) — note this in any future admin UI.

## 7. Dashboard UI (apps/web)

Placement reflects "obfuscated power-user area, separate from main Create":

- **New top-level route group** `/anchors` registered in `App.tsx` under
  `<AuthenticatedAppLayout>` (same block as `/library`, `/studio`). Not added to
  `PRIMARY_NAV` (`AppLayout.tsx`). Reachable from quiet entry points:
  - a Settings secondary "quiet link" (`SettingsPage.tsx` `QUIET_LINKS`),
  - optionally a Library sub-tab (`LibraryPage.tsx` `LIBRARY_TABS`),
  - the command palette.
- **Routes:**
  - `/anchors` — browse/search feed, filter by kind (Character / Story / Image).
  - `/anchors/:id` — detail: preview, snapshot (logline/acts/cast or image), and
    the primary **"Use in a project"** action (project picker or create-new).
  - `/anchors/mine` — the publisher's own entries (published/draft/archived).
- **Publish entry points (contextual, not in the wizard):** a quiet "Publish as
  anchor" action on an existing asset/blueprint detail view (e.g. an `anchor`
  asset card, a story blueprint view), opening a small publish dialog (title,
  summary, tags). This keeps publishing power-user-discoverable without touching
  the Create flow.

**TanStack Query** (per CLAUDE.md): add a `catalog` client module under
`apps/web/src/lib/` exposing typed functions on `v1Api` (e.g.
`v1Api.listCatalogEntries`, `useCatalogEntries`, `useUseCatalogEntryMutation`),
with query keys near the module (`catalog`, `["catalog", "entry", id]`,
`["catalog", "mine"]`). `useInfiniteQuery` for the feed (mirror
`useDashboardRunsQuery`). On a successful `use` mutation, invalidate the target
project's asset/manifest queries and navigate into that project.

Components live under `apps/web/src/routes/anchors/` +
`apps/web/src/components/anchors/` (cohesive feature files, no new aggregator
`index.ts` per the conventions).

## 8. Non-goals (launch)

- Not wired into the main Create wizard as a step. No "pick an anchor first."
- **No approval/moderation flow** (deferred — §6). Publishing is immediate.
- No paid/premium anchors, ratings, or comments. (`use_count` is the only
  signal; ordering can use it later.)
- No live/shared references — copy-into-project only.
- No cross-workspace team sharing beyond the global published catalog.
- No bulk/CSV import or admin authoring tool (any-user publish covers seeding).

## 9. PR breakdown

Each PR is an open PR (no drafts, per CLAUDE.md), independently reviewable.

1. **PR1 — schema.** `catalog_entries`, enums (`catalog_entry_kind`,
   `catalog_entry_status` with launch states only), indexes, RLS
   (public-read-published, owner-all-statuses). Additive migration with a unique
   timestamp (verify against remote history per the
   migration-version-collisions convention). Pure DB; no app wiring yet.
2. **PR2 — publish + read API.** `catalog.ts` router (GET feed/detail, POST
   publish → live immediately, PATCH, DELETE/archive, GET mine) + store +
   schemas + preview materialization into the public catalog namespace. Tests
   via `node:test`.
3. **PR3 — copy-into-project.** `POST /catalog/entries/:id/use` for all three
   kinds (asset byte-copy; blueprint deep-clone), provenance stamping, inline
   `use_count`. Tests cover immutability/provenance.
4. **PR4 — browse + use UI.** `/anchors` feed + `/anchors/:id` detail + "Use in
   a project" with project picker; `catalog` query module; infinite feed.
5. **PR5 — publish UI.** "Publish as anchor" dialog on asset/blueprint views +
   `/anchors/mine`.
6. **PR6 — search.** Wire `GET /catalog/search` to the asset embeddings index
   once that work lands (GIN fallback before then), plus search UI on `/anchors`.

Deferred (separate future scope, not numbered here): approval/moderation queue
and takedown (§6).

## 10. Open questions

1. **Publish visibility model:** copy source bytes into a dedicated public
   catalog namespace (recommended — publisher keeps their project private) vs.
   require the source asset to be made effectively public. The former is more
   bytes but cleaner UX; confirm before PR2.
2. **Story clone depth:** does a story anchor carry its character *images* (the
   `anchor` assets the blueprint references), or only the textual blueprint? If
   images, "use story" fans out into multiple byte-copies. Recommend
   text-blueprint-only at launch, with referenced character anchors offered as
   separate one-click adds.
3. **Bookmarks:** point `saved_assets` at catalog entries, or add a parallel
   `saved_catalog_entries`? Leaning a new table to avoid overloading the
   asset-bookmark semantics. (Post-launch.)
</content>
