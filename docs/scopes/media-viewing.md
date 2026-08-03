# Media viewing — scope & PR plan

<!-- agent-summary: Ready media is projected through one bucket-aware API URL resolver. -->
<!-- agent-summary: Private signed URLs carry their real nullable expiresAt value through list and focused responses. -->
<!-- agent-summary: Project Gallery and Library share one auth, workspace, and asset-scoped TanStack media query. -->
<!-- agent-summary: Selected media refreshes five minutes before expiry; tiles refresh only after a load error. -->
<!-- agent-summary: Each failed image or video URL gets one focused refresh and cannot create a retry loop. -->
<!-- agent-summary: Fresh media URLs persist for the browser tab so route changes and reloads reuse the exact URL. -->
<!-- agent-summary: Signed-credential JSON is private and no-store; immutable byte caching belongs on the object. -->

## Goal

Make every piece of media in a project **actually viewable**: watch the
generated movie, play an uploaded clip, see an uploaded image or a generated
keyframe, listen to a narration track — through **one generic delivery +
viewer layer**, not per-surface one-offs. "Watch the movie" is then a thin
specialization: the movie is just the `render` asset the `cut` selection
points at, viewed in the same player as any other clip.

Companion scopes:

- `docs/scopes/watch-the-movie.md` (PR #292 branch) owns **producing** the
  movie (composite + render assets, ffmpeg export executor) and the watch
  page's product shape. This doc owns the layer underneath it: bytes in the
  right storage, URLs in API responses, and the viewer component. W3/W4 of
  that scope should land **on top of** M2/M4 here.
- `docs/scopes/poster-generation.md` — `posterUrl` (shipped in PR #292) is the
  prototype of the projection pattern this doc generalizes.

## Implementation update (2026-08-02)

The project media gallery and owned Library now consume the same TanStack Query
entry: `asset-media/{authScope}/{workspaceId}/{assetId}`. The authenticated
identity in the key prevents cross-account reuse; the workspace dimension keeps
identical-looking asset identifiers isolated across tenancy boundaries. Fresh
entries are mirrored into `sessionStorage`, scoped by the same tuple, so a route
change or same-tab reload can reuse the exact signed URL and therefore the
browser's byte cache. Sign-out clears session state, and visibility mutations
evict persisted media before invalidating the query.

Creator-direct status uses that same focused query for ready recovered outputs.
The status projection carries the asset's explicit nullable `expiresAt`, and
its JSON is always `Cache-Control: private, no-store`. A terminal run does not
need to keep polling merely to renew media: the asset query refreshes five
minutes before expiry and retries once when the rendered image, video, or audio
URL fails to load.

`expiresAt` is nullable. Stable public, local, and remote URLs return `null`;
private S3 URLs preserve their actual one-hour expiry, using the earlier expiry
when the main media and thumbnail differ. Selected/open media schedules a
focused refresh five minutes before that boundary. Grid tiles do not schedule
per-card refresh timers; they refresh only if their image/video load fails.
Each failed URL can trigger exactly one authenticated
`GET /api/v1/assets/:assetId/media` retry. If the newly signed URL also fails,
the component falls back truthfully instead of looping.

The focused endpoint verifies managed bytes with `HeadObject`. A confirmed
`NoSuchKey`/404 produces null media; authorization, configuration, and network
errors remain errors. List endpoints intentionally do not perform per-row HEAD
requests. Project and workspace asset-list JSON uses
`Cache-Control: private, no-store`, because caching a list's embedded signed
credentials would extend stale URL failures.

The remaining sections preserve the original implementation plan for context;
where they describe pre-S3/Supabase-only behavior, the implementation update
above and `public-private-asset-storage.md` are authoritative.

## Historical findings that motivated the implementation

1. **Asset bytes never reach Supabase Storage.** The only callers of
   `uploadAssetObject()` / `useSupabaseStorage()`
   (`apps/api/src/lib/supabase/storage.ts`) are the eval store. The v1 upload
   paths (`apps/api/src/lib/api/v1/assets.ts`, `local_path` and
   `multipart_upload` branches) write bytes to **local disk** under
   `.local/media/...` and store `storage_key` as a disk-relative path
   (`media/uploads/...`). Generated media likewise never lands in the bucket.
   Under the Supabase backend the `assets` bucket is empty — verified live:
   `storage.objects` had zero rows until PR #292's test poster.
2. **No API response carries a usable media URL.** `mapAsset()` exposes raw
   `storageKey`/`remoteUrl`; `WorkspaceAssetSummary` has neither a URL nor a
   thumbnail. The web `AssetPreview` (`DashboardCollectionsPage.tsx`) renders
   `asset.thumbnailUrl ?? asset.url` — fields the API never populates. The
   Assets tab is a grid of gray boxes by construction. The one exception is
   `posterUrl`, added in PR #292, which signs on projection.
3. **No viewer.** No lightbox, no player page; the only `<video>` element is
   the inline one in the Outputs card, fed by the legacy
   `.local/agent-jobs.json` artifact store (see watch-the-movie.md, gap 2).

## Target model

- **Bytes live in the private `assets` bucket** when `DB_BACKEND=supabase`:
  uploads at `uploads/{ws}/{project}/{key}{ext}` (`uploadObjectPath()`),
  generated media at `generated/{ws}/{project}/{filename}`
  (`generatedObjectPath()`). `storage_key` **is the bucket object path** — no
  `media/` disk prefix, no translation layer.
- **Delivery is a projection, never stored state.** A single store helper
  resolves any ready media asset row to short-lived signed URLs
  (`{ url, thumbnailUrl? }`), exactly like `posterUrlFor()` does for posters:
  `storage_key` → `createSignedAssetUrl()`, else `remote_url`, else null.
  Supabase signed URLs honor range requests, so `<video>` seeking works.
- **One viewer component** handles the three media kinds (image lightbox,
  video player, audio player) and is mounted from every surface: Assets tab,
  Uploads, storyboard panels, Outputs, and the watch page.
- **Visibility-agnostic:** the bucket is private and every read is a signed
  URL minted by the server for an authorized caller, so public/private asset
  `visibility` needs no separate delivery path.

## What already exists (reuse — do NOT reinvent)

- **Storage helpers** — `apps/api/src/lib/supabase/storage.ts`:
  `uploadAssetObject()`, `createSignedAssetUrl()`, `uploadObjectPath()`,
  `generatedObjectPath()`, `guessContentType()`, `downloadAssetObjectToTemp()`.
  Built, tested by the eval store, unused by the asset paths.
- **The projection pattern** — `projectPosterAsset()` + `posterUrlFor()` in
  `apps/api/src/lib/api/v1/store.ts` (PR #292): selection → asset row →
  signed URL, with a try/catch fallback for unsigned/stale keys.
- **Response shapes that already have the fields** —
  `packages/shared/src/v1/dashboard.ts` (`url?`, `thumbnailUrl?` on dashboard
  asset/output items) and the web `AssetPreview` / `OutputsPage` markup in
  `apps/web/src/routes/DashboardCollectionsPage.tsx` that renders them. The
  contract was designed for this; only the server side is missing.
- **List queries to extend** — `listWorkspaceAssets()` and
  `listWorkspaceOutputs()` in `store.ts`; storyboard panel reads in
  `apps/api/src/lib/api/v1/storyboard.ts`.

## What must be built

1. **Storage cutover for asset bytes (the prerequisite for everything).**
   Route the `local_path` / `multipart_upload` branches and the generated-media
   write path through `uploadAssetObject()` when `DB_BACKEND=supabase`,
   persisting the bucket object path as `storage_key` (+`storage_bucket`).
   Local-disk mode stays for the legacy monolith only. Existing rows with
   `media/...` disk keys reference bytes that exist only on the dev machine —
   they stay unviewable; no backfill (clean-break rule), the UI placeholder
   covers them.
2. **Generic media-URL projection.** `mediaUrlsForAsset(row)` in `store.ts`
   (generalizing `posterUrlFor`), wired into `listWorkspaceAssets`,
   storyboard panel responses, and `listWorkspaceOutputs`. Images use the
   asset itself as `thumbnailUrl`; videos get `thumbnailUrl` only when a
   linked image exists (poster / first-frame keyframe via graph edges) —
   server-side frame extraction is explicitly out of scope.
3. **URL refresh endpoint.** `GET /api/v1/assets/:assetId/media` → fresh
   `{ url, thumbnailUrl, expiresAt }` for the authorized caller. Lists embed
   short-TTL URLs (~1h); the viewer refetches on expiry/error instead of the
   list re-signing everything.
4. **`MediaViewer` component (web).** One overlay/lightbox:
   `<img>` for images, `<video controls poster>` for video, `<audio controls>`
   for audio; filename/kind/duration metadata; keyboard dismiss/navigation.
   Mounted from the Assets grid, Uploads page, storyboard panels, and Outputs.
5. **Watch page rides on this layer.** watch-the-movie W3/W4 reduce to: a
   projection that resolves `cut` → active render via the same
   `mediaUrlsForAsset`, and a route that opens `MediaViewer` full-page with
   `posterUrl` as the poster frame.

## PRs

### PR M1 — asset bytes to Supabase Storage

- **Files:** `apps/api/src/lib/api/v1/assets.ts`,
  `apps/api/src/lib/api/v1/generated-assets.ts`,
  `apps/api/src/lib/supabase/storage.ts` (if a small put-helper is missing),
  tests.
- **Work:** upload + generated paths write to the bucket under
  `DB_BACKEND=supabase`; `storage_key` = bucket object path; content type via
  `guessContentType()`.
- **Done when:** a multipart upload and a generated image both appear in
  `storage.objects` and their rows' `storage_key` signs successfully via
  `createSignedAssetUrl()`.

### PR M2 — media-URL projection in list responses *(after M1)*

- **Files:** `apps/api/src/lib/api/v1/store.ts`,
  `apps/api/src/lib/api/v1/storyboard.ts`, `packages/shared/src/v1/*`.
- **Work:** `mediaUrlsForAsset()`; populate `url`/`thumbnailUrl` on workspace
  assets, storyboard panels, and outputs responses.
- **Done when:** the Assets tab shows real thumbnails for a freshly uploaded
  image and a generated keyframe with zero web changes (the markup already
  consumes these fields).

### PR M3 — asset media refresh endpoint *(after M1, parallel with M2)*

- **Files:** `apps/api/src/routes/v1/assets.ts`, `store.ts`, api-client.
- **Work:** authorized per-asset signed-URL fetch with `expiresAt`.
- **Done when:** an expired list URL can be recovered by the client without
  reloading the list.

### PR M4 — MediaViewer + surface integrations *(after M2/M3)*

- **Files:** `apps/web/src/components/media/MediaViewer.tsx` (new),
  `DashboardCollectionsPage.tsx`, `UploadsPage.tsx`, storyboard components.
- **Work:** the viewer overlay; click-to-view from every asset surface;
  refresh-on-expiry via M3.
- **Done when:** an uploaded clip plays, an uploaded image opens full-size,
  and a narration track plays — all from the Assets tab, all in one component.

### PR M5 — watch page on the shared layer *(after M4; coordinates with watch-the-movie W3/W4)*

- **Work:** `/projects/:projectId/watch` resolves the `cut` slot's active
  render through `mediaUrlsForAsset` and opens the full-page viewer with the
  project poster as the poster frame; poster cards link here when a render
  exists.
- **Done when:** a project with a render plays end-to-end from a poster click;
  a project without one still lands on the storyboard.

## Dependency graph

```
M1 (bytes → bucket) ──→ M2 (projection) ──→ M4 (viewer) ──→ M5 (watch page)
        └─────────────→ M3 (refresh) ───────┘
M5 also depends on watch-the-movie W1/W2 (something must produce renders).
```

## Risks / decisions

- **Signed-URL lifetime:** lists carry ~1h URLs; long viewing sessions
  recover via M3 rather than long-lived URLs everywhere. Revisit TTLs when
  CDN delivery lands (the harper-medical S3+CloudFront layer is the known
  upgrade path).
- **Per-row signing cost:** `createSignedUrl` is one storage call per asset
  per list render. Supabase supports `createSignedUrls` (batch) — use it in
  M2 for lists from the start.
- **Video thumbnails:** no server-side frame extraction in this scope; videos
  without a linked image render a kind-badge placeholder. Acceptable, visible,
  honest.
- **Legacy `media/...` rows:** intentionally not backfilled; they're dev-only
  artifacts of the pre-cutover paths. If real user data ever needs rescue, it
  is a one-off operational script, not product code.
