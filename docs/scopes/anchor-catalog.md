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
- **Search:** index a **catalog-owned projection** of each entry's curated,
  public fields (title/summary/tags + a flattened `snapshot.searchText`) — NOT
  the source asset's embedding. An anchor may be published from a *private*
  project, so riding the asset-embeddings public-discovery path would either
  miss it (visibility join excludes private sources) or leak private source
  metadata. Full-text GIN at launch; an optional catalog-snapshot embedding can
  reuse the embeddings *infrastructure* later (see §5).
- **Publish materializes public bytes:** publishing copies the source bytes into
  the existing **public bucket** (`assets-public`) under a neutral
  `catalog/{entryId}/…` namespace via the storage layer's `copyObject`. Delivery
  is decoupled from the publisher's project visibility — they never have to make
  their project public. This grounds out former open question #1 (see §1, §3, §4).

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
  `keyframe`, `poster`, `brief`, `plan`, and `story_blueprint` in the P0 embed
  set**. We reuse this *infrastructure* (embedding pipeline, vector column,
  query helper) for an optional catalog-snapshot embedding later — but **not**
  its public-discovery query path, which joins on asset/project effective-public
  visibility. Catalog entries can be published from private projects, so search
  runs over the catalog's own public projection instead (§5).
- **Bookmarks already exist.** `saved_assets` (user_id, source_asset_id) with
  RLS that only allows bookmarking effectively-public assets. A catalog "save
  for later" can reuse this pattern (see §10).
- **Managed storage with a two-bucket public/private model already exists** and
  gives the catalog its copy primitives almost for free
  (`apps/api/src/lib/storage/`, local + S3 backends):
  - **Two buckets** `assets-public` / `assets-private`, selected by visibility
    (`config.ts` `resolveBucket`). `effectiveAssetVisibility()`
    (`visibility-move.ts`) makes an object publicly deliverable **only when both
    the asset and its owning project are public** — this is exactly why "just
    flip the source asset public" is insufficient (it would force the
    publisher's whole project public), and why publish copies bytes into a
    neutral namespace instead.
  - **`ObjectStore.copyObject`** (`object-store.ts`) does cross-bucket,
    cross-visibility **server-side** S3 copies (no download/re-upload). This is
    the single primitive behind both publish (source → public catalog namespace)
    and use (public catalog object → consumer's project key).
  - **`resolveAssetUrl`** (`asset-urls.ts`) serves a public-bucket object via a
    stable unsigned CDN URL and private objects via presigned URLs, with the
    leak-prevention fixes already landed. A catalog object in `assets-public`
    gets a stable public URL automatically.
  - **`writeAssetObject` / `assetStorageKey`** (`asset-write.ts`) place project
    bytes at `{workspaceId}/{projectId}/{assetId}/{filename}`. Use clones write
    here under the consumer's namespace.

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

  -- Source LINEAGE in the publisher's own project (provenance only — delivery
  -- does NOT depend on the source's or source project's visibility; see below).
  -- ALL nullable with ON DELETE SET NULL: the entry owns its own public bytes
  -- and snapshot, so it must SURVIVE deletion of the source asset/blueprint/
  -- project/workspace — those links simply go null (lineage tombstone). The
  -- publisher must be able to delete their source without nuking the public
  -- anchor. Presence-by-kind is enforced at publish time in the API, not by a
  -- permanent NOT NULL (which on-delete-set-null would violate).
  source_workspace_id        uuid references public.workspaces(id)        on delete set null,
  source_project_id          uuid references public.projects(id)          on delete set null,
  source_asset_id            uuid references public.assets(id)            on delete set null,  -- character/image
  source_story_blueprint_id  uuid references public.story_blueprints(id)  on delete set null,  -- story

  -- Curated, world-readable presentation (no project internals leak).
  title               text not null,
  summary             text,
  tags                text[] not null default '{}',

  -- The entry's OWN public catalog object (a copy of the source bytes placed in
  -- the public bucket under catalog/{id}/...). The entry owns these bytes
  -- directly so delivery is decoupled from any project asset/visibility. Null
  -- for a story entry rendered as a text card (an optional cover image may set
  -- them later). Resolved via the same resolveAssetUrl public path.
  preview_storage_key     text,
  preview_storage_bucket  text,   -- = the configured public bucket
  preview_content_type    text,

  -- Immutable presentation snapshot taken at publish time, so the catalog card
  -- is stable even if the publisher later edits/deletes the source.
  snapshot            jsonb not null default '{}'::jsonb,

  -- Lightweight popularity counter, incremented inline on /use. No separate
  -- per-use table at launch (provenance lives on the cloned asset's `source`).
  use_count           integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Enforce the RIGHT source column per kind (mutual exclusivity), but allow
  -- BOTH to be null so on-delete-set-null can tombstone lineage without
  -- violating the constraint. Presence at publish time is enforced in the API.
  constraint catalog_entry_source_by_kind check (
    (kind in ('character','image') and source_story_blueprint_id is null)
    or (kind = 'story' and source_asset_id is null)
  )
);

create index catalog_entries_published_feed_idx
  on public.catalog_entries (created_at desc)
  where status = 'published';
create index catalog_entries_kind_idx on public.catalog_entries (kind)
  where status = 'published';
create index catalog_entries_publisher_idx on public.catalog_entries (publisher_user_id);

-- Search projection over the catalog's OWN curated, public fields (see §5 for
-- why we cannot ride the source asset's embedding). Full-text at launch:
create index catalog_entries_search_idx on public.catalog_entries
  using gin (to_tsvector('english',
    coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' ||
    array_to_string(tags, ' ') || ' ' ||
    coalesce(snapshot ->> 'searchText', '')))
  where status = 'published';
```

`snapshot` is the only JSONB and holds a **typed, versioned presentation copy**
(logline, act/scene titles, character names/descriptions, dimensions, plus a
flattened `searchText` for indexing) — audit data, not product structure the UI
edits. The editable truth stays in the relational source rows. Because the
entry's bytes and snapshot are an immutable copy taken at publish time, the
entry stays **stable and searchable even if the source asset/blueprint/project
is later edited or deleted** (lineage links just go null).

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

**Delivery: a neutral public catalog object (decided).** The catalog does not
depend on the publisher's project being public. The storage layer's
`effectiveAssetVisibility()` only treats an object as publicly deliverable when
*both* the asset and its project are public, so making just the source asset
public would not serve it — and forcing the whole project public is exactly what
we want to avoid. Instead, **publish copies the source bytes into the public
bucket (`assets-public`) under a project-independent `catalog/{entryId}/…`
key** via `ObjectStore.copyObject`, and stores that key/bucket on the entry
(`preview_storage_*`). The entry owns its public bytes; `resolveAssetUrl` serves
them as a stable unsigned CDN URL. `source_asset_id` is kept only as lineage.
See §4 for the copy flow.

## 4. Copy-into-project & publish semantics

### Publishing (any user)

`POST /catalog/entries` with `{ kind, sourceAssetId | sourceStoryBlueprintId,
title, summary, tags }`:

1. Verify the caller owns the source (user-scoped read).
2. Build the typed `snapshot` from the relational source.
3. **Materialize the public catalog object.** For character/image, server-side
   copy the source bytes into the public bucket under `catalog/{entryId}/…` via
   `ObjectStore.copyObject` (`sourceVisibility` = the source's current effective
   visibility, `destinationVisibility = 'public'`). Record
   `preview_storage_key` / `preview_storage_bucket` / `preview_content_type` on
   the entry. This is a bucket-to-bucket copy — no download/re-upload — and
   decouples catalog delivery from the publisher's project visibility. Story
   entries skip this at launch (text card) unless a cover image is provided.
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
   server-side copy the entry's public catalog object
   (`preview_storage_key` in `assets-public`) into the consumer's
   `{targetWorkspace}/{targetProject}/{newAssetId}/…` key via
   `ObjectStore.copyObject` (`destinationVisibility` = the target project's
   effective default), and persist `storage_key`/`storage_bucket` on the new
   asset; stamp `source = { via: 'catalog', catalogEntryId, sourceAssetId }`.
   Return the new asset. (Bucket-to-bucket copy; the bytes never round-trip
   through the API.)
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
| `GET /catalog/search?q=&kind=` | public | Search published anchors over the catalog's own projection (`catalog_entries_search_idx`); never joins the source asset's embedding/visibility |
| `GET /catalog/entries/:id` | public | Entry detail (snapshot + resolved preview URL) |
| `POST /catalog/entries` | user | Publish from an owned source asset/blueprint (goes live immediately) |
| `PATCH /catalog/entries/:id` | publisher | Edit own entry metadata |
| `POST /catalog/entries/:id/use` | user | **Copy-into-project** (the core action) |
| `DELETE /catalog/entries/:id` | publisher | Archive own entry |
| `GET /catalog/mine` | user | Publisher's own entries (all statuses) |

Store functions land in `apps/api/src/lib/api/v1/` (e.g. a new `catalog.ts` +
store helpers), following the `assets.ts` route → `lib/api/v1` handler → `store`
flow. Preview URLs resolved via `resolveAssetUrl` so private/public delivery and
leak-prevention are inherited for free.

**Search runs over the catalog's own public projection, not the source asset.**
A `catalog_entries` row carries only curated, publish-time-copied fields
(title/summary/tags + `snapshot`) and its own public bytes; the source asset may
live in a private project. So `/catalog/search` queries
`catalog_entries_search_idx` (full-text over those fields) filtered to
`status = 'published'`. It must **not** route through the asset-embeddings
public-discovery query, which enforces source asset/project effective-public
visibility — doing so would drop private-source anchors or risk surfacing
private source metadata. If we later want semantic search, embed the curated
`snapshot.searchText` into a catalog-owned vector column using the embeddings
*pipeline*, and query that column directly (no asset/project join).

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
   `catalog_entry_status` with launch states only), feed/kind/publisher indexes
   + the `catalog_entries_search_idx` full-text projection, nullable
   `on delete set null` source lineage FKs + the relaxed kind check, RLS
   (public-read-published, owner-all-statuses). Additive migration with a unique
   timestamp (verify against remote history per the
   migration-version-collisions convention). Pure DB; no app wiring yet.
2. **PR2 — publish + read API.** `catalog.ts` router (GET feed/detail/search,
   POST publish → live immediately, PATCH, DELETE/archive, GET mine) + store +
   schemas + preview materialization into the public catalog namespace +
   `snapshot.searchText` build. `/catalog/search` queries the catalog's own
   full-text projection (not the asset-embeddings discovery path). Tests via
   `node:test`.
3. **PR3 — copy-into-project.** `POST /catalog/entries/:id/use` for all three
   kinds (asset byte-copy; blueprint deep-clone), provenance stamping, inline
   `use_count`. Tests cover immutability/provenance.
4. **PR4 — browse + use UI.** `/anchors` feed + `/anchors/:id` detail + "Use in
   a project" with project picker; `catalog` query module; infinite feed.
5. **PR5 — publish UI.** "Publish as anchor" dialog on asset/blueprint views +
   `/anchors/mine`.
6. **PR6 — semantic search (optional).** Add a catalog-owned vector column,
   embed `snapshot.searchText` via the asset-embeddings *pipeline*, and rank
   `/catalog/search` by it (querying the catalog column directly — no
   asset/project join). Full-text from PR2 is the baseline; this is a ranking
   upgrade, plus search UI polish on `/anchors`.

Deferred (separate future scope, not numbered here): approval/moderation queue
and takedown (§6).

## 10. Resolved decisions & open questions

**Resolved — publish visibility model.** Copy source bytes into a neutral public
catalog namespace (the existing `assets-public` bucket under `catalog/{entryId}/…`),
not by making the source asset/project public. The two-bucket storage layer +
`ObjectStore.copyObject` already provide the mechanism; the entry owns its public
bytes via `preview_storage_*` (§1, §3, §4). Publisher keeps their project private.

Still open:

1. **Story clone depth:** does a story anchor carry its character *images* (the
   `anchor` assets the blueprint references), or only the textual blueprint? If
   images, "use story" fans out into multiple byte-copies. Recommend
   text-blueprint-only at launch, with referenced character anchors offered as
   separate one-click adds.
2. **Cleanup on archive:** when a publisher archives an entry, do we delete its
   `catalog/{entryId}/…` public object (already-made clones are unaffected — they
   live under consumer keys), or leave it for audit? Leaning delete on archive
   via `ObjectStore.deleteObject` + a CloudFront invalidation (the
   `invalidatePublicObject` path already exists in `visibility-move.ts`).
3. **Bookmarks:** point `saved_assets` at catalog entries, or add a parallel
   `saved_catalog_entries`? Leaning a new table to avoid overloading the
   asset-bookmark semantics. (Post-launch.)
</content>
