# Anchor Catalog — Production Seed Set & E2E Verification Checklist

**Status: in progress · June 18, 2026**

> **Current step: PROMPT REVIEW (no generation, no publishing yet).** Image
> generation is expensive, so this round only produces the **generation prompts**
> (see "Generation prompts" below) for review. Once approved, we generate the
> images, then publish to prod **under the owner's own account** (token grabbed
> from the logged-in browser session at execution time). Scope for the first run:
> **images + characters**; stories are a later batch.

## Purpose

Two goals in one effort:

1. **Prove the catalog works end-to-end in production** — publish → embed-at-publish
   → semantic search ranks it → copy-into-project clones it. Browse/search are
   already confirmed (HTTP 200, empty); this exercises the *data* paths.
2. **Pre-populate the catalog with a curated set of real example anchors** so new
   users land on a stocked catalog instead of an empty shelf.

This doc is the runbook + checklist. It is executed against **production**
(`https://popcornready-production.up.railway.app`, Supabase ref
`mllkugitfwasiwgbortk`). Everything published here is **public, durable data**,
so entries are created under a dedicated examples account and each is tracked
below for keep-or-remove decisions.

## What the catalog can hold (and how hard each is to seed)

The catalog supports three anchor kinds. Difficulty differs by what the *source*
requires (`apps/api/src/lib/api/v1/catalog.ts` `assetSnapshot`/`storySnapshot`):

| Kind | Source required | How to create the source | Effort |
|------|-----------------|--------------------------|--------|
| **image** | any `media=image` asset with stored bytes | **Upload** via `POST /projects/:id/assets` (multipart_upload) | Easy |
| **character** | a graph **`anchor`** image asset (`asset.kind = 'anchor'`) | **Generate** via the anchor/keyframe pipeline (uploads register as `source_footage`/`image`, not `anchor`) | Medium |
| **story** | a **`story_blueprint`** (+ acts/scenes/characters) | Created only by the **planning agent** — no direct create endpoint | Harder |

> **Note on "example videos":** the catalog itself does not hold videos — its
> anchors are character/story/image. Rendered example *videos* are a separate
> concept (example projects + their renders). Tracked as an open decision below.

## Prerequisites (auth + tooling)

Production uses `AUTH_MODE=supabase`, so every write needs a **Supabase access
token (JWT)** for the publishing account (`apps/api/src/middleware/auth.ts`).
Two ways to get one — pick one (open decision below):

- **A. You provide a token.** Log into the prod web app as the examples account,
  copy the Supabase `access_token` (DevTools → the supabase session), hand it to
  me. Simple, but tokens expire (~1h) so we re-grab if a run runs long.
- **B. Mint via service role.** With the prod `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  + anon key, a small script `admin.auth.admin.createUser` (once) then
  `signInWithPassword` to get a token on demand. Best for repeatable runs.

**Publisher identity (decided):** publish under the **owner's own account** (not
a separate examples account). At execution we grab the Supabase `access_token`
from the logged-in `popcornready.ai` browser session (fallback: owner pastes it
if the browser store can't be read cleanly). Tokens expire (~1h), so we grab it
right before the publish run. The workspace already exists; we create one project
to host source assets (`POST /api/v1/projects`). Source assets/projects can stay
**private** — publish copies bytes into the public catalog namespace, so the
publisher's project visibility is irrelevant.

## Proposed seed set

Adjust freely — this is a starting slate chosen to span genres and be broadly
reusable. (`★` = needs generation; not a plain upload.)

### Image anchors (style / setting frames) — uploads
- [ ] **Neo-noir city at night** — rain-slicked neon streets. tags: `noir, city, night, cinematic`
- [ ] **Golden-hour meadow** — warm pastoral natural light. tags: `nature, golden-hour, warm`
- [ ] **Clean product studio** — seamless backdrop, soft light. tags: `product, studio, minimal, commercial`
- [ ] **Cozy reading nook** — warm lamplit interior. tags: `interior, cozy, warm`

### Character anchors ★ (reference image + description)
- [ ] **Detective Mara Vance** — weathered noir detective, trench coat. tags: `noir, detective`
- [ ] **Captain Aria Sol** — optimistic sci-fi explorer, sleek suit. tags: `sci-fi, hero, explorer`
- [ ] **Professor Elias Thorn** — eccentric steampunk inventor, goggles. tags: `steampunk, inventor`
- [ ] **Pip the Fox** — friendly animated fox, kids' style. tags: `animation, kids, animal`
      *(animal, not a minor — but if any character reads as a child, generate with
      Gemini per the minor-safety rule, not OpenAI image-edit.)*

### Story anchors (story blueprints)
- [ ] **The Last Lighthouse Keeper** — quiet 3-act drama; a keeper and a final storm. tags: `drama, short`
- [ ] **Heist at Helix Tower** — fast 3-act caper. tags: `action, heist`
- [ ] **A Letter to Tomorrow** — heartfelt; a child writes to their future self. tags: `heartfelt, family`

## Generation prompts (FOR REVIEW — nothing generated yet)

These are the image-generation prompts for the first run (images + characters).
Story anchors are text blueprints and need no image prompt. **Review/edit these
before we generate anything.** Provider notes follow the minor-safety rule:
photorealistic minors must use Gemini, not OpenAI image-edit (none here are
minors; `Pip` is an animal and uses Gemini for the soft animated style).

### Image anchors — style / setting frames (no people), 16:9

1. **Neo-noir city at night** · tags `noir, city, night, cinematic` · provider: OpenAI or Gemini
   > A rain-slicked downtown street at night, neo-noir style. Wet asphalt
   > reflecting saturated neon signage in magenta, cyan, and amber; steam rising
   > from a manhole; tall glass-and-steel towers fading into blue fog; one
   > flickering streetlight; cinematic anamorphic look, shallow depth of field,
   > high contrast, moody low-key lighting, subtle 35mm grain. No people, no text.

2. **Golden-hour meadow** · tags `nature, golden-hour, warm` · provider: OpenAI or Gemini
   > A wide pastoral meadow at golden hour: tall wild grasses and scattered
   > wildflowers swaying, warm low sun flaring through a lone oak on the right,
   > soft volumetric light and long shadows, distant rolling hills, gentle haze,
   > naturalistic color, cinematic wide establishing shot, shallow depth of
   > field. No people, no text.

3. **Clean product studio** · tags `product, studio, minimal, commercial` · provider: OpenAI or Gemini
   > A minimalist product-photography studio: seamless soft-grey cyclorama
   > backdrop, a subtle reflective tabletop in the foreground, a large softbox
   > key light from the left with gentle fill, clean even shadows, neutral color,
   > high-key commercial look, crisp and uncluttered — an empty stage ready for a
   > product. No product, no people, no text.

4. **Cozy reading nook** · tags `interior, cozy, warm` · provider: OpenAI or Gemini
   > A cozy reading-nook interior in warm evening light: a worn leather armchair
   > beside a tall bookshelf, a brass floor lamp casting a warm pool of light, a
   > small side table with a steaming mug, a soft knit throw, rain on the window
   > behind sheer curtains, intimate and inviting, cinematic interior, shallow
   > depth of field. No people, no text.

### Character anchors — identity reference images, 2:3 portrait

Each lists the **identity invariants** (the consistent traits to preserve across
future keyframes) and the **reference prompt**. Reference shots are full-body,
neutral pose, plain background for clean re-use.

5. **Detective Mara Vance** · tags `noir, detective` · provider: OpenAI or Gemini
   - *Identity:* woman, late 30s; shoulder-length dark hair; sharp, tired hazel
     eyes; faint scar over the left eyebrow; worn tan trench coat over a charcoal
     shirt and dark trousers.
   > Character reference, full-body, neutral standing pose, of a late-30s woman
   > noir detective: shoulder-length dark hair, sharp tired hazel eyes, a faint
   > scar over the left eyebrow, wearing a worn tan trench coat over a charcoal
   > shirt and dark trousers. Even soft studio lighting, plain light-grey
   > background, photorealistic, sharp focus, consistent identity reference.

6. **Captain Aria Sol** · tags `sci-fi, hero, explorer` · provider: OpenAI or Gemini
   - *Identity:* woman, early 30s; brown skin; close-cropped curly black hair;
     bright confident smile; sleek white-and-teal flight suit with subtle glowing
     teal accents and utility straps.
   > Character reference, full-body neutral pose, of an early-30s optimistic
   > sci-fi explorer: brown skin, close-cropped curly black hair, bright
   > confident smile, wearing a sleek white-and-teal flight suit with subtle
   > glowing teal accents and utility straps. Soft even studio lighting, plain
   > neutral background, photorealistic, sharp, consistent identity reference.

7. **Professor Elias Thorn** · tags `steampunk, inventor` · provider: OpenAI or Gemini
   - *Identity:* man, 60s; wild grey hair, bushy eyebrows; round brass goggles
     pushed up on forehead; layered tweed waistcoat with brass buttons and gears;
     leather tool apron; ink-stained fingers.
   > Character reference, full-body neutral pose, of an eccentric steampunk
   > inventor in his 60s: wild grey hair, bushy eyebrows, round brass goggles
   > pushed up on his forehead, a layered tweed waistcoat with brass buttons and
   > gears, a leather tool apron, ink-stained fingers. Warm even studio lighting,
   > plain neutral background, photorealistic with fine detail, consistent
   > identity reference.

8. **Pip the Fox** · tags `animation, kids, animal` · provider: **Gemini** (soft animated style)
   - *Identity:* small friendly red fox; big curious amber eyes; rounded soft
     features; oversized fluffy tail with a white tip; tiny blue explorer's
     satchel; modern 3D-animated film look.
   > Character reference, full-body neutral standing pose, of a friendly cartoon
   > red fox: big curious amber eyes, rounded soft features, an oversized fluffy
   > tail with a white tip, wearing a tiny blue explorer's satchel. Modern 3D
   > animated film style (soft subsurface fur, gentle rim light), plain neutral
   > background, appealing and kid-friendly, consistent character reference.

> After approval: generate these 8 images, register each as a source asset
> (characters need a graph `anchor` asset — confirm the anchor-generation path),
> then run Phases 2–5. Story prompts/blueprints come in the next batch.

## Execution checklist

### Phase 0 — Auth & host setup
- [ ] Obtain a prod JWT for the **owner's own account** — grab the Supabase
      `access_token` from the logged-in `popcornready.ai` browser session
      (fallback: owner pastes it). Re-grab if it expires (~1h).
- [ ] `GET /api/v1/me` → 200, note `workspaceId` (the owner's existing workspace).
- [ ] `POST /api/v1/projects` `{ "name": "Catalog Examples" }` → note `projectId`.

### Phase 1 — Create source assets
- [ ] **Images:** for each image anchor, `POST /api/v1/projects/:projectId/assets`
      with `source.type=multipart_upload` (base64 bytes), `kind=image`,
      `userContext.{description,tags}`. Record each `assetId`.
- [ ] **Characters ★:** produce a graph `anchor` image per character (generation
      path — TBD once we confirm the anchor-generation endpoint). Record `assetId`s.
- [ ] **Stories:** produce a `story_blueprint` per story (planning path — TBD).
      Record `storyBlueprintId`s.

### Phase 2 — Publish to catalog
- [ ] For each source, `POST /api/v1/catalog/entries`:
      ```json
      { "kind": "image|character|story",
        "sourceAssetId": "…",            // image/character
        "sourceStoryBlueprintId": "…",   // story
        "title": "…", "summary": "…", "tags": ["…"] }
      ```
      Record each returned `entry.id` in the table below.

### Phase 3 — Verify search & embedding
- [ ] `GET /api/v1/catalog/entries?limit=50` → all entries present, each with a
      resolved `previewUrl` (images/characters).
- [ ] **Embedding populated:** confirm semantic ranking works — query by *concept,
      not keyword*, e.g. `GET /api/v1/catalog/search?q=gritty%20rainy%20metropolis`
      should rank "Neo-noir city" highly even though those exact words aren't in
      its title/tags. (If results look purely lexical, the vector didn't populate —
      check `OPENAI_API_KEY` and the publish logs.)
- [ ] Kind filter: `GET /api/v1/catalog/search?q=…&kind=character` returns only characters.
- [ ] Lexical still works for unembedded/edge cases (blended ranking).

### Phase 4 — Verify copy-into-project
- [ ] Create a throwaway project; `POST /api/v1/catalog/entries/:id/use`
      `{ "targetProjectId": "…" }` for **one image and one character** (this
      round's kinds; story-`use` is verified in the story batch).
- [ ] Confirm a new asset is cloned into the target with
      `source.type = "catalog"` provenance, and `entry.use_count` incremented.

### Phase 5 — Keep vs clean up
- [ ] Decide per entry: **keep** (pre-populate) or **remove** (test-only).
- [ ] Remove test-only entries via `DELETE /api/v1/catalog/entries/:id` (archive)
      and delete the throwaway "use" project. Already-cloned assets are
      independent and unaffected.

## Entry tracking

| Anchor | Kind | source asset/blueprint id | catalog entry id | embed ok? | keep? |
|--------|------|---------------------------|------------------|-----------|-------|
| Neo-noir city at night | image | | | | |
| Golden-hour meadow | image | | | | |
| Clean product studio | image | | | | |
| Cozy reading nook | image | | | | |
| Detective Mara Vance | character | | | | |
| Captain Aria Sol | character | | | | |
| Professor Elias Thorn | character | | | | |
| Pip the Fox | character | | | | |
| The Last Lighthouse Keeper | story | | | | |
| Heist at Helix Tower | story | | | | |
| A Letter to Tomorrow | story | | | | |

## Verification = "working"

- Publish returns `201` with a populated `previewUrl` (image/character).
- `catalog_entries.search_embedding` / `search_model` / `search_dims` are set
  (publish embedded the curated text) — observable as concept-level search hits.
- Semantic query ranks the right entry above keyword-only competitors.
- `use` clones into a target project with `source.type=catalog` and bumps `use_count`.

## Decisions

Resolved (June 18):
- **Auth** — publish under the **owner's own account**, using the Supabase token
  from the logged-in `popcornready.ai` browser session (grabbed at execution).
- **Scope** — first run is **images + characters**; stories are a later batch.
- **This round is prompt-review only** — generate nothing until the prompts above
  are approved (image generation is expensive).
- **"Example videos"** — out of scope here; just the catalog anchors for now.

Still open:
1. **Approve / edit the 8 generation prompts** above (the gate for this round).
2. **Character source path** — characters need a graph `anchor` asset; confirm the
   anchor-generation endpoint (vs. needing a registration path) before Phase 1.
3. **Aspect ratios** — images 16:9, character refs 2:3; adjust if desired.

## Code references

- Publish: route `apps/api/src/routes/v1/catalog.ts:111`; impl
  `apps/api/src/lib/api/v1/catalog.ts` (`publishCatalogEntry`, `assetSnapshot`,
  `storySnapshot`, `materializePreview`); schema `schemas.ts` (`parsePublishCatalogEntry`).
- Upload source asset: route `apps/api/src/routes/v1/assets.ts:76`; impl
  `assets.ts` (`registerAsset`).
- Use: route `apps/api/src/routes/v1/catalog.ts:154` (`useCatalogEntry`).
- Auth: `apps/api/src/middleware/auth.ts`, `apps/api/src/lib/api/v1/auth.ts`.
- Search RPC + embedding: migration `supabase/migrations/20260618180000_catalog_search_embedding.sql`.
