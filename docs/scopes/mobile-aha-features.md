# Mobile-Browser "Aha" Features — Idea Catalog

> **Status:** brainstorm / idea backlog, not a committed scope. Each idea is
> grounded in the existing asset graph + orchestrator tool registry; "new work"
> notes what's genuinely missing. Promote an idea by writing it its own scope
> doc (per-PR breakdown + tests), like
> [audio-post-voiceover-sync.md](audio-post-voiceover-sync.md).

## The framing

The best apps get the user to an "aha" moment as fast as possible. We have no
mobile app, but the mobile *browser* is enough — the phone is a camera and a
microphone that is already full of the user's footage.

The governing constraint is **aha economics: cost and latency**. Full video
generation is the slow, expensive stage; uploads, TTS/music audio,
transcription, storyboard sketches, and timeline assembly are cheap and fast.
So the highest-value mobile features lean on **the user's own media plus the
cheap stages**, and treat video generation as the *upsell*, not the entry
point.

## Idea catalog

Ordered roughly by aha-per-second. "Uses" = existing machinery; "New" = the
gap.

### 1. "Narrate this" — one clip in, movie out

Pick one clip from the camera roll; the agent transcribes it, writes narration
grounded in what actually happens, ducks the original audio, adds music. The
user's shaky birthday clip sounds like a documentary in ~60 seconds.

- **Uses:** the full [audio-post-voiceover-sync](audio-post-voiceover-sync.md)
  stack (transcribe → grounded script → TTS → fit → mix). Zero video
  generation.
- **New:** nothing beyond that scope — this is its distilled mobile UX.
- **Note:** strongest candidate for the mobile landing experience (see wedge,
  below).

### 2. "Trailer my weekend" — multi-clip auto-cut

Multi-select 3–10 clips; the agent finds the usable moments, cuts a 30-second
trailer, adds epic voiceover + music. Aha: "it found the good three seconds of
every clip."

- **Uses:** uploaded-footage editing flow (asset intake / usable moments),
  `assemble_timeline`, audio generation. No video generation.
- **New:** mobile multi-select upload UX; trailer-flavored plan template.

### 3. Beat-synced montage (soundtrack drives the cuts)

The upgrade of #2 and the emotional payoff of a montage: generate a soundtrack,
then land every cut on a beat/bar boundary — best moments on phrase
boundaries/drops, crossfades on mellow sections, hard cuts on the drop, music
ducking so a real laugh or wave crash pokes through.

- **Uses:** usable moments; `generate_audio` music mode + `soundtrack` role;
  `assemble_timeline` trims; transitions-as-assets
  ([transitions-as-assets.md](transitions-as-assets.md)) for per-boundary
  effects; `audio_mix` layers (voiceover scope PR 4) for the duck-throughs.
- **New:** a **beat grid** — beat/downbeat timestamps detected on the
  soundtrack (deterministic signal-level onset detection, no LLM; the music
  analog of the transcript: an analysis asset derived from an audio asset,
  `relation: "input", role: "analyzed_from"`, typed timing payload) — plus a
  beat-aligned cut planner (pure function, mirror of the voiceover scope's fit
  core: fit picture cuts to audio landmarks instead of speech to picture
  windows). The agent supplies taste (which moment gets the drop); the math
  supplies the grid — the North Star's deterministic-candidates /
  agent-decides split.
- **No video generation** — fast and cheap; likely the strongest aha on this
  list.

### 4. Photo → living scene

Take or pick one photo; it becomes the first frame of a single generated clip.
A still of grandma's garden starts moving.

- **Uses:** keyframe→clip pipeline with first-frame conditioning
  (`inputs.firstFrameAssetId`).
- **New:** a single-photo entry UX. Costs exactly **one** clip generation —
  bounded, predictable spend per aha.

### 5. Kid's drawing → animated short

Photograph a crayon drawing; it becomes a character anchor and a short
animated beat. Parents are the perfect aha audience; drawings sidestep the
photoreal-minor problem entirely (where real kids appear, the Gemini-only rule
already applies).

- **Uses:** anchor pipeline, storyboard, keyframe→clip.
- **New:** drawing-flavored anchor prompt treatment.

### 6. Voice memo → video

The inverse of #1: record a 30-second voice memo in the browser
(MediaRecorder works on mobile Safari/Chrome); it becomes the narration spine
and the agent plans shots to match it.

- **Uses:** transcript asset (voiceover scope PR 1) makes the memo addressable
  word-by-word; `plan_shots` + generation; fit tooling (PR 3) works in this
  direction too.
- **New:** in-browser audio recording UI; audio-first planning path.

### 7. "Say it like…" style switcher

After any result, one-tap re-voice: nature documentary, sports announcer, film
noir. Demonstrates **selective regeneration** — the product's thesis — as a
toy: only the audio changed, instantly.

- **Uses:** `regenerate_asset_version` on voiceover assets with a different
  voice/style; graph recomputes only affected segments.
- **New:** a curated voice/style preset list; one-tap UI on the watch page.

### 8. Instant storyboard from one sentence

Type "my dog's secret life as a spy," get sketch tiles in seconds. The
dopamine hit *before* asking for a full generation, and the natural upsell
("make this real?").

- **Uses:** `generate_storyboard` (beat_storyboard sketch tiles — the cheapest
  visual asset in the system).
- **New:** a stripped-down single-input mobile surface.

### 9. Selfie → "put me in a movie"

Selfie becomes a character anchor; the agent generates one 5-second genre shot
of the user. Huge shareability.

- **Uses:** character-anchor pipeline + one clip generation.
- **New:** tight consent framing; adults-only per the minor-safety constraint.

### 10. Share-sheet entry + watch-page loop

Not a generation feature — probably the highest-leverage approachability move:
a small PWA manifest with a **share target**, so "Share → Popcorn Ready"
appears in the phone's native share sheet from the camera roll. One gesture
from camera roll to agent. Every quick creation ends on the existing public
watch page with a share button, so each aha recruits the next user.

- **Uses:** existing upload path, public project/watch page,
  `publish_to_catalog`.
- **New:** PWA manifest + share-target handler; mobile-polished watch page.

### 11. One-tap occasion templates

"Birthday recap," "pet trailer," "vacation in 30s" cards that prefill the
entire brief so the user's only job is picking clips. Removes the
blank-textarea problem — the biggest approachability killer on a phone
keyboard.

- **Uses:** Templates/Launchpad surfaces already exist; briefs are structured.
- **New:** occasion-tuned brief presets; mobile card UI.

### 12. Occasion auto-recap from capture times

Clips uploaded together cluster by their capture timestamps ("these 14 clips
span Saturday 10am–4pm") and the agent proposes "make a day-recap?" — the
brief writes itself from metadata.

- **Uses:** asset registration already extracts media metadata; intake pass
  produces knowns/unknowns.
- **New:** EXIF/creation-time capture at upload; a clustering heuristic
  feeding the brief.

### 13. Caption karaoke

Word-timed captions burned over the user's clip, synced to the transcript —
the TikTok-native presentation of speech.

- **Uses:** transcript word timestamps (voiceover scope PR 1); segments
  already carry a `caption` field; renderer draws captions today.
- **New:** word-level caption timing in the renderer (today captions are
  per-segment).

### 14. Animated postcard

One photo + a voice memo → a short animated greeting with the user's own
voice, delivered as a shareable watch-page link. #4 + #6 combined into a
send-to-grandma moment.

- **Uses:** first-frame clip generation + upload-audio-as-narration + mix.
- **New:** nothing beyond #4/#6; it's a packaging of both.

## The wedge

**#1 + #10 together:** share a clip from the camera roll via the native share
sheet, get it back narrated and scored a minute later, with a link worth
texting. It uses the exact stack the voiceover scope ships, costs pennies per
aha, and nearly every other idea above is an upsell from that entry point
(#3 when they share several clips; #7 after their first result; #8/#4 when
they have no footage at hand).

## Related

- [audio-post-voiceover-sync.md](audio-post-voiceover-sync.md) — the enabling
  stack for #1, #3, #6, #7, #13, #14.
- [uploaded-footage-agent-editing.md](uploaded-footage-agent-editing.md) /
  [ui-video-upload.md](ui-video-upload.md) — ingestion + asset knowledge for
  #2, #3, #12.
- [transitions-as-assets.md](transitions-as-assets.md) — boundary effects for
  #3.
- [docs/research/voiceover-adr-data-models.md](../research/voiceover-adr-data-models.md)
  — alignment/data-model research behind the transcript/fit/mix primitives.
