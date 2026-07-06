# Audio Post: AI-Synced Voiceover for Uploaded Footage

> **Research basis:**
> [docs/research/voiceover-adr-data-models.md](../research/voiceover-adr-data-models.md)
> (deep research on professional ADR/dialogue-replacement data models, alignment
> stacks, and agentic ADR architecture). This scope adapts that research to the
> Popcorn Ready asset graph and cuts a first shippable slice.

## Objective

Let a user who has footage with **bad or unusable sound** — the canonical case
is a home movie shot on a phone — get a **clean, synced audio track in
post-production**: AI-written narration/voiceover, music, and (optionally)
ducked original audio, all timed to the picture by the agent rather than by the
user dragging waveforms.

The user experience target:

1. Upload footage. ("The audio on this is terrible.")
2. The agent watches/listens, recovers what was said or what happens when,
   and proposes a replacement audio plan.
3. The agent generates the audio, fits it to the picture, and presents a
   per-segment before/after for approval.
4. Approve → render. Request changes → the agent recomputes only the affected
   audio segments (Principle 3, selective regeneration).

## What the research contributes (and how it maps to us)

The ADR research's core claim is that dialogue replacement is a
**data-management and synchronization problem before it is an ML problem**: the
systems that work are agentic orchestration layers over stable editorial
artifacts with per-artifact provenance, confidence scores, versions, and
human-in-the-loop approval — not monolithic end-to-end models.

That architecture is almost exactly our North Star, which means most of the
research's "minimum viable ADR schema" **already exists** in the asset graph:

| Research entity (ADR schema) | Popcorn Ready equivalent | Status |
| --- | --- | --- |
| `PROJECT` / `SCENE` / `CLIP` | `projects`, `storyboard_scenes`/`storyboard_beats`, `assets` (kind `source_footage`, `clip`) | ✅ shipped |
| `AUDIO_SEGMENT` (unit of replacement + approval) | `audio_track` asset scoped to a beat/segment via `inputs` + role `voiceover` | ✅ shipped (per-beat voiceover already exists) |
| `PROVENANCE_EVENT` | `actions` (tool, params, input/output asset ids, rationale) | ✅ shipped |
| `VERSION` (immutable, approval state, no silent overwrite) | `lineage_id` + `version`, immutability guards, `regenerate_asset_version`, selections | ✅ shipped |
| `PHONEME_ALIGNMENT` (word/phone timings) | **missing** — no transcript or alignment asset | ❌ this scope |
| `CONFIDENCE_SCORE` (gates human review) | `critique` asset kind exists but nothing scores audio↔picture sync | ❌ this scope |
| Voice consent / legal-basis metadata | **missing** — not needed until voice cloning | ⏭ deferred with cloning |

The research's layered-alignment stack (coarse timecode → transcript/forced
alignment → lip-sync estimation) also gives us the phasing: each layer is a
tool the agent can call, and we only need the first two layers for the home
movie use case.

## The key simplification for v1: narration-first, not lip-sync

Professional ADR replaces **on-camera dialogue**, which drags in the hardest
problems: phoneme-level forced alignment, lip-sync scoring (SyncNet/Wav2Lip),
voice cloning, and the consent/legal machinery the research is emphatic about.

The home-movie user usually doesn't need any of that. Their footage is mostly
**not lip-critical** — kids running around, a birthday, a vacation — and what
they want is a **narrated, scored version of their footage** where the audio
matches *events* in the picture ("the splash happens when she jumps in"), not
lips. That is:

- **moment-level sync** (word lands within a beat/usable-moment window),
  not phoneme-level sync;
- a **new synthetic narrator voice** (no cloning, no consent problem);
- original audio **kept as an asset and optionally ducked under** the new
  track, never destroyed (Principle 9 — nothing is throwaway).

So v1 = **"Fix my audio" → transcribe + understand → script → TTS → fit to
picture → review → mix**. Lip-synced same-voice dialogue replacement is a later
phase on the same data model.

## Current state (what already exists)

- **Generation:** `generate_audio` orchestrator tool
  (`apps/api/src/lib/orchestrator-tools/generate-audio.ts`) produces per-beat
  ElevenLabs voiceover + a project soundtrack; speech/dialogue/music/SFX modes
  in `apps/api/src/lib/generative/audio.ts`.
- **Timing primitives:** real playback duration measurement
  (`apps/api/src/lib/generative/audio-duration.ts`), duration-fit policies and
  the 2.5 words/sec pacing estimate (`packages/shared/src/audio-alignment.ts`),
  `RenderPlan.audioDurationSec` / `audioAssetIds`.
- **Data model:** `audio_track` + `narration_script` asset kinds; `voiceover`,
  `soundtrack`, `upload` roles; `asset_media = 'audio'`; per-asset `inputs` +
  edges + fingerprints.
- **Upload:** `POST /projects/:projectId/assets` registers user media, infers
  `audio`/`video` kind, and already emits a `transcribe_audio` knowledge gap —
  but nothing services it.
- **Related scopes:** `ui-video-upload.md` (upload UX) and
  `uploaded-footage-agent-editing.md` (asset intake/knowledge pass) describe
  the ingestion side; this scope is the **audio-post continuation** of those.

**Missing:** transcription, any word-level alignment, event/moment-aware audio
placement, sync scoring, an audio mix step (ducking), and the review UI.

## V1 flow: "Fix my audio"

All steps are orchestrator tools (stages-as-tools, Principle 1); the run is
autonomous by default with an approval gate before the mix (Principle 2/5).

```
upload footage (existing)
  → transcribe_audio        NEW: ASR over the original audio → transcript asset
                                 (word-level timestamps; works surprisingly well
                                 even on "bad" audio, per research: MFA/WhisperX-
                                 class tooling; v1 = Whisper-class API, word level)
  → analyze footage         EXISTING direction (uploaded-footage scope): sampled
                                 frames → usable moments with start/end secs
  → draft_script            EXISTING tool, new input: transcript + moments, so the
                                 narration references what actually happens/was said
  → generate_audio          EXISTING tool, per-segment voiceover + music
  → fit_audio_to_picture    NEW: place each generated audio segment against its
                                 beat/moment window; measure fit (duration vs
                                 window, word-timestamp overlap with the moment);
                                 apply bounded retime (±10% atempo) or propose a
                                 script tighten; emit a sync report
  → request_approval        EXISTING gate: per-segment before/after audition
  → mix_and_render          NEW mix step inside export: replacement track +
                                 music + original audio ducked or muted per segment
```

The sync report is the v1 stand-in for the research's confidence-score gating:
each audio segment gets a `fit` score (`ok` / `needs_review` / `fail`) and the
agent only auto-applies `ok` segments; the rest land in the approval gate. This
follows the research's "high-confidence auto-apply vs mandatory human review"
calibration guidance.

## Data model additions (asset graph, no schema rollbacks)

New **asset kinds** (additive enum migration):

- `transcript` — data asset; content = `{ language, segments: [{ startSec,
  endSec, text, words: [{ w, startSec, endSec, confidence }], speaker? }] }`.
  Derived from a `source_footage` or `audio_track` asset via `inputs`
  (relation `transcribed_from`). Word-level only in v1; phoneme/viseme fields
  are additive later.
- `audio_mix` — data asset describing the mix: ordered layers
  `[{ audioAssetId, gainDb, duckUnder?, inSec, outSec }]` over a composite.
  The render consumes it; it is the provenance of "why the final sounds like
  this."

Reused as-is:

- **Sync report → `critique` asset** over the (`audio_track`, beat) pair, with
  typed content `{ fit, offsetSec?, retimeApplied?, reasons[] }` — matches the
  existing critique pattern instead of a new score table.
- **Approval/versioning** — existing gates + immutable versions + selections.
  A re-recorded segment is `regenerate_asset_version`, exactly like images.
- **JSONB discipline (CLAUDE.md):** transcript/mix payloads are typed, versioned
  asset content (allowed); if the UI later edits mix layers directly, promote
  layers to relational rows at that point.

New **orchestrator tools**: `transcribe_audio`, `fit_audio_to_picture`, and a
mix-aware `export_video` (or a discrete `mix_audio` if export stays pure). Each
validates preconditions and returns typed failures (Principle 7): e.g.
`fit_audio_to_picture` without a transcript for a dialogue-replacement request
returns `missing_transcript`, and the agent self-heals by calling
`transcribe_audio` first.

## UI (observe-first, per docs/ui-interaction-model.md)

- Project audio panel: original track, transcript (readable, time-linked),
  proposed replacement segments with fit badges.
- Per-segment **before/after audition** in the approval gate (play original ↔
  play replacement over the same picture window).
- All changes via **Request Changes** ("make the narration warmer", "don't
  talk over the singing at 0:42") — the agent recomputes only affected
  segments via the graph. No waveform-dragging editor.

## Testing strategy (applies to every PR)

Each new capability ships in three layers so it can be tested in isolation
before it is ever wired into an orchestrator run:

1. **Pure core function** — the deterministic logic (fit math, transcript
   normalization, mix-plan resolution) lives in a plain module with no I/O and
   gets `node:test` unit tests (the repo runner: `npm test` →
   `tsx --test "src/**/*.test.ts"`; existing examples
   `apps/api/src/lib/__tests__/audio-alignment.test.ts`,
   `render-plan.test.ts`).
2. **Provider adapter with a `mock` implementation** — same pattern as
   `generate_audio`'s existing `provider: "elevenlabs" | "mock"`. The mock ASR
   returns canned word timestamps for fixture audio; the mock TTS returns a
   fixture MP3 of known duration. This makes every flow runnable in CI with no
   API keys and deterministic outputs.
3. **A standalone API endpoint** (thin route over the core) added *before* the
   orchestrator tool wrapper, so each stage is curl-testable against a single
   asset without running a full generation. This mirrors the existing
   per-asset pattern (`POST /assets/:id/regenerate`). The orchestrator tool is
   then a thin wrapper over the same lib function the route calls.

Cross-PR fixtures: check in a tiny fixture set under a test-fixtures dir — a
~5s WAV with known speech ("testing one two three" with known word times), a
~5s silent/noisy WAV, and a short MP4 with audio — so transcription, fit, and
mix tests all run against the same known-answer media. Smoke scripts follow the
existing `apps/api/scripts/*-smoke.ts` convention (`storage:smoke`,
`smoke:tool-calls`) for the paths that need real providers or ffmpeg.

## PR plan

### PR 1 — Transcript asset kind + `transcribe_audio` (foundation)

**Scope:** additive migration adding `transcript` to `graph_asset_kind`
(unique timestamp — see migration-collision convention); transcript content
schema in `packages/shared`; ASR provider abstraction
(`apps/api/src/lib/generative/transcription.ts`) with `openai-whisper` (or
equivalent) + `mock` providers; asset-ingest wiring so the existing
`transcribe_audio` knowledge gap is serviceable.

**Isolated endpoint:**

```
POST /api/v1/projects/:projectId/assets/:assetId/transcribe
  body: { provider?: "openai" | "mock", language?: string }
  → 202 { job } (async, follows generate_audio job pattern)
GET  /api/v1/projects/:projectId/assets/:assetId/transcript
  → 200 { transcript asset } | 404
```

Precondition failures are typed (Principle 7): asset not audio/video →
`asset_not_transcribable`; video with no audio stream → `no_audio_stream`.

**Tests:**
- Unit: ASR-response → transcript-content normalization (word merge, segment
  splitting, confidence carry-through); content schema validation; provenance
  `inputs` carry `transcribed_from` relation to the source asset.
- Unit (mock provider): endpoint → job → transcript asset end-to-end against
  the fixture WAV; idempotency (re-transcribe mints a new version, same
  lineage).
- Smoke script `transcribe-smoke.ts` (real provider, gated on API key): run
  against the fixture WAV, assert word timestamps within ±0.3s of known times.

**Done when:** you can upload an audio/video asset, hit the endpoint with
`provider: "mock"` in CI (and the real provider locally), and read back a
word-timestamped transcript asset with correct provenance edges.

### PR 2 — Footage-grounded scripting

**Scope:** feed transcript + usable moments (from the uploaded-footage
analysis pass) into `draft_script` / `plan_shots` inputs so narration
references real names, quotes, and event timestamps; beats gain optional
`sourceWindow` (which stretch of source footage they cover).

**Isolated testing:** no new endpoint — this is a prompt/contract change on
existing tools. Test via:
- Unit: prompt-assembly includes transcript excerpts + moment windows when
  present, omits cleanly when absent; structured-output parsing tolerates
  missing `sourceWindow`.
- Existing tool-test harness (`npm run test:tools` /
  `smoke:tool-calls`): add a case with a fixture transcript asset in the
  project and assert the drafted script quotes it.
- Optional eval: add a graded case to `evals:orchestrator` ("script mentions
  the birthday girl by name from the transcript").

**Done when:** a project containing footage + transcript produces a script
that demonstrably uses transcript content, and prompt-only projects are
unchanged.

### PR 3 — `fit_audio_to_picture` + sync report

**Scope:** the fit core as a pure function — inputs: generated audio measured
duration + (optionally) its own transcript word times, target beat/moment
window; outputs: placement (`startSec`), bounded retime factor (default cap
±10%), and a fit verdict `ok | needs_review | fail` with reasons. Sync report
persisted as a `critique` asset over the (`audio_track`, beat) pair. Staged
retreat encoded in the verdict reasons (retime → tighten script → regenerate),
per the research. Approval-gate wiring: `needs_review` segments require the
gate; `ok` auto-applies.

**Isolated endpoint:**

```
POST /api/v1/projects/:projectId/audio-fit
  body: { audioAssetId, beatId, options?: { maxRetime?: number } }
  → 200 { placement, retime, verdict, critiqueAssetId }
```

Sync (no job needed — it's arithmetic + one optional ffmpeg atempo render for
the retimed variant, which is minted as a new asset version).

**Tests:**
- Unit (the bulk of this PR's value): fit math is fully deterministic — audio
  shorter/longer than window, retime within/exceeding cap, word-timestamp
  overlap with a moment window, degenerate windows. Table-driven known-answer
  tests, no mocks needed.
- Unit: critique asset content shape; retimed audio minted as new version with
  provenance to the original + the fit action.
- Smoke: fixture MP3 vs fixture beat windows through the endpoint; assert the
  retimed file's measured duration (via the existing
  `audio-duration.ts` parser) matches the window within tolerance.

**Done when:** given any audio asset + beat, the endpoint returns a
deterministic, unit-tested fit decision and an inspectable critique asset, and
the orchestrator tool wrapper surfaces `needs_review` through the existing
gate flow.

### PR 4 — `audio_mix` asset + mix-aware render

**Scope:** additive `audio_mix` asset kind; mix-plan resolution (layers →
per-segment gain/duck envelope) as a pure function extending the existing
`RenderPlan` (`audioAssetIds` generalizes to layered entries); export consumes
the mix (duck/mute original audio under voiceover); before/after audition UI
in the approval gate.

**Isolated endpoint:**

```
POST /api/v1/projects/:projectId/audio-mix/preview
  body: { mixAssetId | layers, segmentId? }
  → 202 { job } → rendered preview audio (or short AV snippet) for one segment
```

This is what powers the before/after audition and is independently testable
long before a full export.

**Tests:**
- Unit: mix-plan resolution (overlapping layers, duck windows, gain clamps)
  extending `render-plan.test.ts` patterns.
- Integration (ffmpeg required, skipped when absent — matching the
  degrade-cleanly convention): render a 5s preview from fixtures; assert
  output duration and that RMS level in the ducked window drops by the
  expected amount (a cheap, robust "did ducking actually happen" check).
- Web: audition UI against the preview endpoint with mock data.

**Done when:** a project with original footage + fitted voiceover + soundtrack
exports with the original audio ducked per the mix asset, and the user can
audition any single segment before/after in the gate.

### Later phases (explicitly deferred)

- **Same-language dialogue replacement** (speaker on camera): forced
  alignment to word/phone level, per-line replacement, lip-sync *scoring*
  (SyncNet-class) as a critique — data model already leaves room
  (words → phones is additive on `transcript`).
- **Voice cloning ("sound like grandpa")**: requires the research's consent
  model — a voice asset must carry legal basis (who consented, scope, term,
  revocation). Do not ship any cloning path before that metadata exists.
- **Pro interchange (AAF/BWF/OTIO)**: not our market; revisit only if we
  target pro post handoff.

## Open questions

- Transcribe on upload by default, or only when the user asks for audio work?
  (Cost is small vs video generation; default-on gives the agent grounding for
  free and services the existing knowledge gap.)
- Does `fit_audio_to_picture` fold into `assemble_timeline` (audio as another
  selection per segment) or stay a discrete tool? Discrete keeps the sync
  report inspectable; assemble keeps the tool count down.
- Retime bounds: how much atempo stretch is acceptable before the agent should
  tighten the script instead? Research suggests staged retreat (retime →
  rewrite → regenerate) rather than aggressive stretching.
- Music: keep the current single project soundtrack in v1, or allow per-scene
  cues once `audio_mix` exists?
