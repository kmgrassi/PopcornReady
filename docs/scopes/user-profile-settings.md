# User Profile (in Settings)

> **Status:** Scope / PR plan. A user-facing profile surface — profile image
> (avatar), display name, and a short bio — living inside the existing
> `/settings` page. Last updated 2026-06-22.

## Goal

Give an authenticated user a place to **see and edit their own identity**:
avatar, display name, and a short bio. Today the only account surface is the
read-only "Account" panel on [`SettingsPage`](../../apps/web/src/routes/SettingsPage.tsx)
(email + auth mode + sign out). This scope turns that into an editable profile
section and surfaces the avatar in the dashboard chrome.

## Interaction-model note (read first)

Per [ui-interaction-model.md](../ui-interaction-model.md), every authenticated
surface is observe-first and content changes flow through the **"Request Changes"**
modal. **A profile does not.** Name/avatar/bio are **account & identity
metadata**, not generated content the provenance graph reasons about — they fall
squarely under the §5 carve-out ("navigation & organization metadata… naming a
container is not authoring its content"). So this surface uses **direct-edit form
fields** by design; it must not be routed through the agent, and it should be
called out as an intentional §5 case, not an anti-pattern (§6) regression. This
is the same class of direct interaction as project name/title and theme toggle.

## Decisions (locked)

- **Location:** Expand the existing `/settings` page — no new `/profile` route.
  A new editable "Profile" section replaces the current read-only Account panel.
- **Editable fields:** display name (`full_name`), avatar, and bio.
- **Avatar source:** **user upload to S3** (the app's image storage is
  S3-backed — see below), with display precedence **uploaded avatar →
  provider `avatar_url` → initials fallback**.
- **Out of scope:** editing email (lives in Supabase Auth, needs a
  re-verification flow — separate scope), tier/billing changes, first/last-name
  split, social links.

## What already exists (reuse, don't rebuild)

### Data — `public.users` is the home for this

`public.users` ([supabase/migrations/20260603000000_init_schema.sql](../../supabase/migrations/20260603000000_init_schema.sql))
already has: `id`, `auth_id`, `email`, `full_name`, `first_name`, `last_name`,
`avatar_url`, `metadata` (jsonb), `tier`, timestamps. RLS already restricts a
user to their **own** row (`users_select_own`, `users_update_own`). A profile is
a relational user-domain object — **not** an asset-graph entity (no
`assets`/`actions`/`selections` needed), consistent with the Asset-Graph
Migration Rule in [CLAUDE.md](../../CLAUDE.md).

Two columns are missing for this scope:
- `bio text` — short free-text about.
- `avatar_storage_key text` — object key for an uploaded avatar (distinct from
  `avatar_url`, which stays as the read-only provider value used as fallback).

### Storage — S3, already wired

Image storage is **S3-backed** via the `ObjectStore` interface in
[apps/api/src/lib/storage/object-store.ts](../../apps/api/src/lib/storage/object-store.ts):
`createObjectStore().putObject({ key, body, visibility, contentType })` writes to
the public or private bucket, and `objectUrl(key, "public")` returns the stable
public URL (`publicUrlBase/key`). Config + `local` dev backend live in
[config.ts](../../apps/api/src/lib/storage/config.ts). Avatars are **public**:
upload to the public bucket under a stable key
(`avatars/{userId}/{contentHash}.{ext}`), persist the key, and deliver via
`objectUrl(key, "public")`. No new storage infra.

**Do not route avatars through `resolveAssetUrl`.** That helper
([asset-urls.ts](../../apps/api/src/lib/storage/asset-urls.ts) L78–87) is shaped
for `assets`-table rows: it only emits a public URL when the record carries
**both** `storage_bucket` **and** `visibility: "public"`, otherwise it falls
through to private S3 presigning. An avatar persists only `avatar_storage_key` on
`public.users` (no bucket/visibility columns), so passing it to `resolveAssetUrl`
would resolve to a private presigned URL (or fail) instead of the stable public
one. Avatars are public-bucket objects on a non-asset table — build their URL
directly with the public `ObjectStore.objectUrl(key, "public")` path. (Flagged by
Codex review; see the Avatar delivery section below.)

### API + auth

- `GET /api/v1/me` ([apps/api/src/routes/v1/me.ts](../../apps/api/src/routes/v1/me.ts))
  returns `{ actor, workspaceId, authMode, isLocal }` — workspace context only,
  no profile fields today.
- Auth middleware resolves `public.users.id` from the bearer token and exposes a
  user-scoped, RLS-enforced Supabase client (`getRequestSupabase()`). No auth
  changes needed — a user reads/writes only their own row.
- Routes register in
  [protected-routes.ts](../../apps/api/src/routes/v1/protected-routes.ts).

### Frontend

- `useMeQuery(authScope)` + `MeResponse`
  ([queryClient.ts](../../apps/web/src/lib/queryClient.ts),
  [api-client.ts](../../apps/web/src/lib/api-client.ts)) — already consumed by
  `SettingsPage`.
- `SettingsPage` ([SettingsPage.tsx](../../apps/web/src/routes/SettingsPage.tsx))
  has the Account panel to replace.
- `AppLayout` ([AppLayout.tsx](../../apps/web/src/components/AppLayout.tsx))
  topbar account chip (email + log out) → add the avatar thumbnail.

## Proposed build (PR breakdown)

### PR 1 — Schema: profile columns

- Additive migration: `alter table public.users add column bio text`,
  `add column avatar_storage_key text`. (Additive only — never rewrite applied
  migrations; unique timestamp.)
- No RLS change (existing `users_update_own` already covers new columns).
- Confirm `full_name`/`bio`/`avatar_storage_key` are user-updatable under RLS.

### PR 2 — API: read + update profile

- `GET /api/v1/me/profile` → `{ id, email, fullName, bio, avatarUrl, tier }`
  where `avatarUrl` follows the display precedence below: if
  `avatar_storage_key` is set, resolve it with `objectUrl(key, "public")` (the
  stable public-bucket URL — **not** `resolveAssetUrl`); else the provider
  `avatar_url`; else `null` (initials computed client-side). Reads through
  `getRequestSupabase()` (own row only).
- `PATCH /api/v1/me/profile` → updates `full_name`, `bio`. Validates lengths
  (e.g. name ≤ 120, bio ≤ 280). Returns the updated projection.
- `POST /api/v1/me/avatar` (multipart) → validate image type/size (e.g. ≤ 5 MB,
  png/jpeg/webp), `putObject({ visibility: "public" })` to the public bucket at
  `avatars/{userId}/{hash}.{ext}`, persist `avatar_storage_key`, return the
  `objectUrl(key, "public")` URL. (Optional `DELETE /api/v1/me/avatar` to clear
  back to provider/initials.)
- Register all three in `protected-routes.ts`. Unit tests for validation +
  RLS-own-row behavior.

### PR 3 — Web: editable Profile section in Settings

- Add `getProfile`/`updateProfile`/`uploadAvatar` to `api-client.ts`; a
  `useProfileQuery` + `useUpdateProfileMutation`/`useUploadAvatarMutation` in
  `queryClient.ts` with a stable `profile` query key; invalidate on success.
- Replace the read-only Account panel in `SettingsPage` with a **Profile**
  section: avatar (upload/replace/remove + initials fallback), display-name
  input, bio textarea, Save (mutation) with inline validation + error/success
  state. Keep email + auth mode + sign out as read-only beneath it.
- Reuse local React state for the unsaved form fields (per CLAUDE.md: ephemeral
  UI state stays in component state; server state in TanStack Query).

### PR 4 — Web: avatar in dashboard chrome

- Render the avatar thumbnail (with initials fallback) in the `AppLayout` topbar
  account chip; keep it linking to `/settings`. Pull from the same `profile`
  query so it stays in sync after edits.

## Avatar display precedence (single source of truth)

1. `avatar_storage_key` present → public-bucket URL via
   `ObjectStore.objectUrl(key, "public")` (or the `local`-backend equivalent).
   **Not** `resolveAssetUrl` — see the Storage section for why.
2. else `avatar_url` (provider value from signup) if present.
3. else initials derived from `full_name`/`email` (client-side).

The API computes 1–2 server-side and returns a single `avatarUrl`; the client
applies 3. Both the Settings Profile section and the topbar chip consume that
same `avatarUrl`.

## Open questions

- **Avatar processing:** server-side resize/crop to a square thumbnail, or store
  as-uploaded and constrain via CSS for v1? (Lean: store as-uploaded for v1, add
  a resize step later if payloads get large.)
- **Initials vs. generated default:** plain initials chip is the v1 fallback; a
  generated/gradient default avatar is a later polish.
- **Name model:** this scope edits `full_name` only and leaves
  `first_name`/`last_name` untouched. If those need to stay derived, decide
  whether `full_name` edits backfill them (probably no for v1).

## Related reading

- [ui-interaction-model.md](../ui-interaction-model.md) — §5 carve-outs (why
  this is direct-edit).
- [public-private-asset-storage.md](public-private-asset-storage.md) — the S3
  storage layer reused for avatars.
- [supabase-identity-and-rls.md](../supabase-identity-and-rls.md) — `public.users`
  identity + RLS rules before touching the users table.
