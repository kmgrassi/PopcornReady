# Mobile Landing-Page Video Upload — Scope & PR Plan

## Objective

Let a person on a **phone browser** land on the public landing page, tap
"upload a clip," pick or shoot a video, and end up watching an agent run on
their footage — no account required up front. This is the entry gesture for
the mobile "aha" wedge
([mobile-aha-features.md](mobile-aha-features.md), ideas #1/#2/#10): the
phone's camera roll is the user's asset library, and upload is the front door.

## User flow

1. Open the landing page on a phone (mobile Safari / Chrome).
2. Tap **"Make a movie from your clips"** in the hero → native picker opens
   (camera roll or record now).
3. Pick 1–N clips → per-file progress bars while they upload.
4. Choose account or skip (guest) — same funnel as the landing prompt box.
5. Type a one-line brief ("make a beach-day montage") and explicitly tap
   create — **nothing runs automatically on upload** (decided; see Design
   decisions).
6. Land on the existing run-progress page; the uploaded-footage generation
   entrypoint takes it from there.

## Current state (verified facts that drive the plan)

- **Bytes travel as base64 JSON today.** The only browser upload path is
  `source.type: "multipart_upload"` — the file is base64-encoded client-side
  (`apps/web/src/lib/startRun.ts`) and decoded in the Express handler
  (`apps/api/src/lib/api/v1/assets.ts:463-506`). Fine for a few small desktop
  files; unusable for phone video (a 60s clip is 50–150 MB → ~200 MB string in
  a mobile tab, no progress events, no retry, Express body-size limits).
  [ui-video-upload.md](ui-video-upload.md) already calls for signed-URL
  direct-to-storage in production; mobile makes it a prerequisite.
- **Selection + metadata helpers exist** (`apps/web/src/lib/upload.ts`:
  `FOOTAGE_ACCEPT`, `readSelectedFootage`, client-side duration probe) — reuse
  as-is; they are transport-agnostic.
- **The generation entrypoint exists.** `POST
  /api/v1/projects/:id/generation-entrypoints/uploaded-footage` and
  `startUploadedFootageGenerationRun` (`apps/web/src/lib/startRun.ts`) are
  live; the landing flow only has to deliver asset ids to them.
- **Guest identity is already scoped — do not re-scope it here.**
  [landing-guest-generation-prs.md](landing-guest-generation-prs.md) PRs 1–2
  establish anonymous Supabase sessions (an anon session is a normal
  authenticated session; `handle_new_user` already creates the `public.users`
  row; signup later auto-claims in place). This scope **depends on** those PRs
  and adds nothing to auth.
- **There is no upload affordance on the landing page.** The hero
  (`apps/web/src/routes/HomePage.tsx`) has no prompt box or picker; the
  guest-generation scope rebuilds the prompt path, this scope adds the
  footage path beside it.

## Design decisions

- **Direct-to-storage via signed upload URLs.** The client asks the API for a
  signed Supabase Storage upload URL, PUTs the file straight to storage (XHR,
  so we get real progress events), then registers the asset by storage path.
  The API never proxies video bytes. Base64 `multipart_upload` stays for small
  files/local dev; it is not extended.
- **Server-side probing stays authoritative.** Registration validates the
  object exists, probes duration/dimensions/codec server-side
  (ui-video-upload rule: clients never submit authoritative duration), and
  rejects unreadable media with typed errors.
- **Upload before auth choice, not after.** Start uploading immediately on
  pick (upload time dominates on mobile uplinks) under the anonymous session;
  the account-or-skip choice happens while bytes move. Guest → signup
  auto-claim makes this safe.
- **Sequential-ish concurrency.** Mobile uplinks choke on parallel large
  PUTs; upload 2 at a time, queue the rest (states per ui-video-upload:
  `queued | uploading | processing | ready | failed`).
- **Resumable (TUS) is a later enhancement.** V1 = single signed PUT +
  retry-from-zero per file; acceptable for clips ≤ ~2 min. Do not build TUS
  plumbing until size limits are raised.
- **No auto-run — upload never starts generation by itself (decided
  2026-07-06).** Uploading only produces `ready` assets; a run starts only
  when the user provides a brief and explicitly taps create. Uploading bytes
  is free for us; generation costs money and should never fire on
  misunderstood intent. This also keeps the landing flow consistent with the
  guest prompt path (intent first, run second) and with autonomous-by-default
  applying to the *run*, not to run *creation*.

## PR plan

### PR 1 — Signed-URL direct-to-storage upload (API)

**Scope:** `POST /api/v1/projects/:projectId/assets/upload-url` → `{ path,
signedUrl, expiresAt }` (Supabase Storage `createSignedUploadUrl`, path scoped
to the project's prefix); new register-asset source `{ type:
"storage_upload", path }` that verifies the object exists (and size within
policy), probes media server-side, and creates the asset exactly like the
existing modes. Typed failures: `object_not_found`, `object_too_large`,
`media_unreadable`.

**Isolated testing:**
- Unit: path scoping (a signed path can never escape the project prefix);
  register-time validation matrix (missing object, oversize, non-media bytes).
- Integration (local Supabase stack): request URL → PUT fixture MP4 with plain
  `fetch` → register → asset row has probed duration/dimensions. Curl-able
  end-to-end without any web code.
- Extend the existing storage smoke script for the signed-URL round trip.

**Done when:** a fixture video reaches storage and registers as a `ready`
asset without its bytes ever passing through Express.

### PR 2 — Web upload client (transport + state machine)

**Scope:** an upload manager in `apps/web/src/lib/` that takes
`SelectedFootage[]` and drives: get signed URL → XHR PUT (progress events) →
register → poll `processing → ready`. Per-file state
(`queued | uploading | processing | ready | failed`), cancel, retry,
2-at-a-time concurrency. Server state via TanStack Query mutations/queries per
repo convention; `startRun.ts` switches to this path when files exceed a small
threshold (base64 remains for tiny files/local dev).

**Isolated testing:**
- Unit (`node:test` in the web package pattern, cf. `draftStore.test.ts`):
  the state machine with a mocked transport — orderings, mid-flight cancel,
  retry-after-fail, one failure never blocking the queue (ui-video-upload
  acceptance).
- Manual/preview: existing SourceFootageStep adopts the manager; verify
  per-file progress in the dev preview.

**Done when:** the studio Source Footage step uploads a 100 MB file with live
progress, cancel, and retry — no base64.

### PR 3 — Landing hero upload entry (mobile-first UI)

**Scope:** the landing hero gains an "upload your clips" affordance next to
the guest prompt box: `<input type="file" accept="video/*,image/*" multiple
capture>` (native picker; `capture` offers record-now on phones), preflight
checks (type/size caps, max clip count/duration), per-file progress list,
then the account-or-skip choice (reusing the guest-generation components), a
one-line brief input, and an explicit create action calling
`startUploadedFootageGenerationRun` → run-progress page (no auto-run — see
Design decisions). Anonymous session is
created on first upload so bytes move during the auth choice. Mobile-first
layout per `apps/web/PRODUCT.md` (single popcorn-yellow CTA; this joins the
hero rather than adding a second screen).

**Depends on:** PR 1–2 here; landing-guest-generation PRs 1–2 (anon session).

**Isolated testing:**
- Unit: preflight validation (reject oversize/wrong-type before any network);
  draft wiring from selected files → entrypoint payload.
- Preview verification at mobile viewport (375×812): picker opens, progress
  renders, failed file shows retry and doesn't block others, happy path lands
  on run progress.

**Done when:** on a phone-sized viewport, a guest can go from landing page →
pick clips → watch the run, with no desktop detour.

### PR 4 — Mobile media hardening

**Scope:** accept what phones actually produce — `.mov`/HEVC (iOS default),
HEIC stills, portrait rotation metadata — validating server-side during PR 1's
probe (transcode-on-ingest decision documented here if a provider can't take
HEVC); explicit size/duration caps with friendly typed errors surfaced in the
PR 3 UI; interruption behavior (tab backgrounded mid-upload → resume or clean
retry, `visibilitychange` handling); upload analytics events so funnel
drop-off is measurable.

**Isolated testing:**
- Unit: validation matrix over a fixture set (`.mov` HEVC, HEIC, portrait
  MP4, corrupt file) — accepted/rejected/needs-transcode as decided.
- Integration: probe correctness on the fixture set (rotation-aware
  dimensions).
- Manual device pass: iPhone Safari + Android Chrome checklist (pick from
  camera roll, record now, background mid-upload, airplane-mode retry).

**Done when:** a video shot on a current iPhone uploads, registers with
correct orientation/duration, and failures are explained in the UI rather
than silent.

### PR 5 (optional follow-on) — PWA share-target entry

**Scope:** idea #10 from the catalog — web app manifest + share-target
handler so "Share → Popcorn Ready" appears in the phone share sheet and lands
files directly in PR 3's upload flow. Requires the PWA install prompt path
and a service worker to receive the POST; scope it in detail when PRs 1–4 are
proven.

### PR 6 — Guest retention: banner + purge job

**Scope:** the 30-day guest retention policy (see Open questions — decided).
Two halves: (a) the guest-session banner ("saved for 30 days — create a free
account to keep it forever") on landing/run/watch surfaces while the session
is anonymous; (b) a service-role purge RPC scoped to anonymous-owned projects
with `last_activity < now() - 30 days`, removing storage prefixes + rows
(sanctioned bypass of `assets_guard_delete`, mirroring the admin-delete
pattern), driven by a daily scheduled job from the API, emitting
purged-project/reclaimed-bytes metrics.

**Isolated testing:**
- Unit: eligibility query — anonymous-owned + inactive matches; claimed
  (upgraded) accounts and recently active guests never match; activity-reset
  events cover visit/run/edit.
- Integration (local Supabase): seed an anon project past TTL + one claimed +
  one fresh; run the job; assert exactly the expired anon project's rows and
  storage objects are gone.
- Unit (web): banner renders only for anonymous sessions and disappears after
  upgrade.

**Done when:** an expired guest project disappears from storage and DB via the
scheduled job, a claimed project with identical age survives, and guests see
the retention banner until they sign up.

## Out of scope

- Auth/anonymous-session work (owned by
  [landing-guest-generation-prs.md](landing-guest-generation-prs.md)).
- Resumable/TUS uploads and multi-hundred-MB files (revisit with size caps).
- The asset-intake/knowledge pass and what the agent does with the footage
  ([uploaded-footage-agent-editing.md](uploaded-footage-agent-editing.md)).
- Native apps / app-store presence.

## Open questions

- Initial caps: max clips per guest session, max clip duration/size? (Guest
  abuse surface — suggest 10 clips / 2 min / 200 MB each to start, tightened
  by analytics.)
- ~~Guest-asset retention?~~ **Decided 2026-07-06.** Uploads live server-side
  under the anonymous identity (deliberately **not** browser cache — mobile
  browsers evict large IndexedDB/Cache entries unpredictably, and pre-auth
  upload means bytes move while the user decides). Retention policy:
  - **One rule: anonymous-owned projects purge 30 days after last activity**
    (any visit/run/edit resets the clock). No tiering in v1.
  - **The TTL is the signup nudge, not a silent policy.** Anonymous users
    can't be emailed, so the only warning surface is in-product: guest
    sessions show a persistent banner — "Your project is saved for 30 days —
    create a free account to keep it forever." Retention comms and conversion
    incentive are the same UI element.
  - **Purge needs a sanctioned path.** `assets_guard_delete` forbids asset
    deletion — that principle protects creative work in living projects, not
    orphaned guest data. Add a service-role purge RPC scoped strictly to
    anonymous-owned projects past the TTL (mirroring the admin-delete
    pattern), removing storage prefixes + rows, with a reclaimed-bytes
    metric. Runs as a daily scheduled job from the API.
  - **Claimed work is exempt by construction** — signup upgrades the anon
    identity in place, so the project stops being anonymous-owned and the TTL
    no longer matches it.
  - Privacy note: guest uploads are strangers' personal footage; bounded
    retention is the defensible default independent of storage cost.
- HEVC handling: transcode on ingest (ffmpeg, predictable but adds a job) vs
  probe-and-pass-through until a downstream consumer complains? Decide in
  PR 4 with provider input-format data.
- ~~Should the landing upload auto-start a default run?~~ **Decided
  2026-07-06: no.** Upload never triggers generation; the user always supplies
  a brief and explicitly starts the run (see Design decisions).
