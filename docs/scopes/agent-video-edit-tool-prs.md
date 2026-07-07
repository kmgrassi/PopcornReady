# Agent video-edit tool — PR breakdown

**Status:** Proposal (2026-07-07)
**Builds on:** PR #721 (dev video-edit harness, merged) — proved that
`gemini-omni-flash-preview` edits user-uploaded footage from a natural-language
instruction alone (Files API + interactions API, plain `GEMINI_API_KEY`, no
masks). See `apps/api/src/routes/v1/dev-video-edit.ts` and the
`gemini-omni-video-editing` notes.

## Goal

Make prompt-driven video editing a **first-class agent tool**: a user uploads
footage (or has a generated clip), opens Request Changes, and says "add a
dinosaur sitting on the couch" — and the orchestrator plans and executes an
`edit_video_asset` tool call that produces a new asset with full provenance,
selected into the timeline in place of the source.

This follows NORTH_STAR directly: stages are tools the agent calls, any stage
can be re-triggered, and the edit recomputes only the affected asset via the
dependency graph. Per the UI interaction model, the *only* entry point is
Request Changes — no inline "edit video" form anywhere.

## Architecture at a glance

```
Request Changes ("add a dinosaur on the couch", target: clip/footage asset)
  → board_feedback action (existing pseudo-tool, orchestrator-runs.ts)
  → engine model reads instruction + target, plans edit_video_asset   [PR 3-4]
  → tool creates asset_generation job → runEditVideoAssetJob          [PR 3]
  → createGeneratedAsset (video-edit branch)                          [PR 2]
      → localPathForAssetBytes(source) → geminiProvider (Omni edit)   [PR 1]
      → new asset row + graphInputs {role: "edited_from"} + billing
  → selection: edited asset takes the source's timeline slot          [PR 2]
  → run resumes; projections/UI show the edit stage + provenance      [PR 5]
```

Design decisions locked up front:

- **The edited output is a first-class asset row** (`media: "video"`,
  `kind: "clip"`) with `graphInputs` linking to the source — never a JSONB
  side-payload. This is the Asset-Graph Migration Rule; the trigger mirrors
  `graphInputs` into `asset_edges`, so no direct edge writes.
- **Edge role:** `"edited_from"` (`relation: "input"`), joining the existing
  role vocabulary (`beat_keyframe`, `first_frame_of`, `transcribed_from`,
  `reference`, `anchor`).
- **Non-destructive:** the source asset is untouched; re-editing or reverting
  is a selection change, not a data change.
- **No auto-run:** an upload never triggers an edit (per the 2026-07-06
  no-auto-run decision). Edits happen only when the user asks via Request
  Changes or an explicit run instruction.

---

## PR 1 — Gemini Omni video-edit in the provider layer

*Scope: `packages/shared`, `apps/api/src/lib/generative`. No new callers.*

- `packages/shared/src/generative/types.ts`: extend `GeminiVideoRequest` with
  an optional edit input — `editSourceVideoPath?: string` (a resolved local
  file path, matching how `referencePaths` works). When present, the request
  means "edit this footage per the prompt" rather than "generate".
- `apps/api/src/lib/generative/providers/gemini.ts`: new
  `editGeminiVideo(...)` branch inside `generateGeminiVideo` dispatch,
  promoting the battle-tested harness pipeline:
  - `ai.files.upload` → poll to `ACTIVE` → `ai.interactions.create`
    (`gemini-omni-flash-preview`, `background: true`, input
    `[{type:"video", uri, mime_type}, {type:"text", text: prompt}]`) → poll
    `ai.interactions.get` → extract the `model_output` video block →
    `ai.files.download` (authed `?alt=media` fetch fallback).
  - Mime normalization (`video/quicktime` → `video/mov`, enum-only values)
    and the **invalid-argument → ffmpeg H.264 transcode → retry-once**
    fallback for phone footage (HEVC/QuickTime). Both already proven against
    real iPhone footage in #721.
- `apps/api/src/lib/generative/pricing.ts`: add an Omni edit entry to
  `estimateCostUsd` (per-second of source video; confirm rate against
  Google's pricing page when it publishes — use the Veo per-second rate as a
  placeholder and mark it).
- Unit tests with a mocked `@google/genai` client (upload states, interaction
  status transitions, transcode-retry path, output extraction).
- Re-point the dev harness (`dev-video-edit.ts`) at the shared provider
  function and delete its duplicated pipeline — the harness becomes the
  manual smoke rig for this provider path.

**Acceptance:** harness still edits a real `.mov` end-to-end; typecheck and
provider unit tests green.

## PR 2 — `createGeneratedAsset` video-edit branch + provenance + selection

*Scope: `apps/api/src/lib/api/v1/generated-assets.ts`, `store.ts` helpers.*

- Accept `editSourceAssetId?: string` on the generated-asset request. In
  `runGeneration`:
  - Resolve it with the existing `localPathForAssetBytes` (readiness gate:
    `status === "ready"` + `storageKey`, same as reference assets) and pass
    it as `editSourceVideoPath` in the provider request (dispatch-ladder
    branch next to the existing `gemini/video` case).
  - Include the source in `graphInputs`:
    `{assetId: editSourceAssetId, relation: "input", role: "edited_from"}`.
  - Provenance payload: instruction, provider/model, source asset id, source
    duration.
  - **Role: the edited asset keeps the role its slot expects — no new
    `edited_clip` role.** `selectGeneratedBeatClipAsset` hard-rejects
    anything but `role === "beat_clip"` (store.ts ~3273), and slot consumers
    look assets up with `expectedRole: "beat_clip"` (`generate-clip.ts`,
    `generate-clip-job.ts`) — a novel role would fail selection and make
    reruns treat the beat as empty and regenerate over the edit. The
    "edited" fact is carried entirely by the `edited_from` graph input and
    provenance. Edits of unslotted library footage keep the source's
    role/use unchanged for the same reason.
  - Billing flows through the existing hooks unchanged
    (`assertRunBudgetAllows`, `recordModelCallCost` with `unit: "seconds"`
    of source duration, `noteBillableGeneration("gemini", costUsd)`).
- Renditions: reuse the existing pipeline (`extractFirstFrameImage`,
  thumbnail) so the edited clip gets a poster like any other video asset.
- Selection: `selectEditedClipAsset(...)` following the
  `selectGeneratedBeatClipAsset` pattern — when the source clip occupies a
  timeline/beat slot, the edited asset becomes the active selection for that
  slot (reversible via selections). Add the slot to the restart-from-stage
  `SELECTION_SLOTS` clearing logic where appropriate.
- Tests: store-level test that the edge lands in `asset_edges` with
  `role = "edited_from"`, and a `provider: "mock"` end-to-end write test
  (extend the mock provider to answer edit requests — also needed by PR 4's
  battery).

**Acceptance:** calling `createGeneratedAsset` with `editSourceAssetId`
against the mock provider produces a ready asset with the `edited_from` edge,
poster rendition, and selection swap.

## PR 3 — `edit_video_asset` orchestrator tool + job worker

*Scope: `apps/api/src/lib/orchestrator-tools`, orchestrator registration
points.*

- `edit-video-asset.ts`: `createEditVideoAssetTool(deps)` per the standard
  factory. `execution: "async"`; `parseInput` takes
  `{sourceAssetId, instruction, beatId?}`; precondition failures return
  `unmetRequirements` + `suggestedNextTools` (e.g. source not ready → suggest
  waiting on upload processing). The job is created with a **deterministic
  `idempotencyKey`** — `createOrGetJob` only dedups when the caller supplies
  one, and the existing generation tools don't, so without it a retried tool
  call mints duplicate edited assets. Key =
  `sha256(sourceAssetId, source contentHash, normalized instruction, model)`
  so re-running the same edit reuses the in-flight/completed job while a
  *different* instruction on the same source is a new edit.
  `estimateCost` uses the PR 1 pricing entry
  with source duration.
- `edit-video-asset-job.ts`: `runEditVideoAssetJob` per the
  `generate-clip-job` pattern — `jobs.setStep`, call `createGeneratedAsset`
  with `editSourceAssetId`, `jobs.succeed({assetIds})` / `jobs.fail`, and
  `resumeOrchestratorRun` in `finally`.
- Register in `default-registry.ts` and add the `ToolName` to **every**
  duplicated union/array (this is the fiddly part; missing one breaks
  planning or projections silently):
  - `orchestrator-tools/types.ts`
  - `orchestrator/types.ts` `TOOL_NAMES`
  - `orchestrator/tool-errors.ts`, `orchestrator/tool-invocations.ts`
  - `orchestrator-run-projections.ts` (`toolStage` — new/existing media
    stage, `toolItemKind`, `TOOL_ORDER`, `TOOL_LABELS`)
  - `orchestrator/registry.ts` `mediaToolNames`
- Tool description/`usage.useWhen` written for the planner: "use when the
  user asks to change the *content* of existing footage or a generated clip
  (add/remove/replace something in the video) rather than generate a new
  clip from scratch."

**Acceptance:** tool appears in `GET /dev/tool-tests` as wired; a scripted
run with `provider: "mock"` executes the tool through the engine and resumes
the run on job completion.

## PR 4 — Request Changes routing + planner verification

*Scope: `apps/api/src/routes/v1/orchestrator-runs.ts`, model guidance,
tool-tests.*

- `asset-revisions` / `board-revisions` already record a `board_feedback`
  action with `{message, target}` that the engine model reads — verify
  `parseBoardRevisionRequest` accepts an uploaded-footage `target.assetId`
  (not just keyframe/clip slots) and that the revision surface allows
  targeting `primary_footage` assets; extend the schema if not.
- Model guidance: extend the planner prompt/tool descriptions so feedback
  that describes a content change to existing footage plans
  `edit_video_asset`, while "make me a different clip" still plans
  `generate_clip`. This is a prompt + description change, not new routing
  code — the tool list the model sees comes straight from the registry.
- `tool-tests/specs/edit-video-asset.ts` battery: seed a project with a mock
  uploaded video asset; instruction "Add a dinosaur sitting on the couch in
  the uploaded office clip"; expect `edit_video_asset` with
  `callStatus: "waiting_for_job"`; verify the edited asset + `edited_from`
  edge + selection in the sandbox DB.
- At least one live-provider eval case (flag-gated like the other live
  harnesses) exercising real Omni against a tiny fixture clip.

**Acceptance:** battery green with mock provider; a manual Request Changes on
an uploaded clip in a dev workspace produces an edited asset without touching
any other pipeline stage.

## PR 5 — Surfacing: projections, gallery, watch

*Scope: `apps/api` projections (partly done in PR 3 registrations),
`apps/web`.*

- Run progress: the edit shows as a stage item with the standard
  running/complete states (labels from PR 3's `TOOL_LABELS`).
- Media gallery: edited assets render like clips, with provenance surfaced
  read-only — "Edited from ⟨source⟩ · ⟨instruction⟩" from the asset's
  provenance/graph inputs; source remains visible (non-destructive story).
- Watch/timeline surfaces read through selections, so the edited clip plays
  automatically once selected — verify, no new edit controls (observe-first;
  the only affordance anywhere is the existing Request Changes entry point).
- Keep it minimal per the mobile direction: no new panels, one provenance
  line + the existing request-changes affordance.

**Acceptance:** after a PR 4 manual run, the dashboard shows the edit stage,
the gallery shows both assets with lineage, and watch plays the edited clip.

## PR 6 — Cleanup + docs

- Fold what remains of the dev harness: keep `/dev/video-edit` as a
  provider smoke rig (it now calls the shared provider path only) or delete
  it if the battery + eval coverage feels sufficient.
- Document the tool in the orchestrator tool docs and update
  `docs/NORTH_STAR.md`-adjacent references if any enumerate the tool set.
- Add the Omni preview caveats where operators will see them (see risks).

---

## Sequencing and dependencies

| Order | PR | Depends on | Independently shippable? |
|---|---|---|---|
| 1 | Provider layer (Omni edit) | — (harness already merged) | Yes — no callers change behavior |
| 2 | Generated-asset branch + provenance | PR 1 | Yes — dark until a caller passes `editSourceAssetId` |
| 3 | Orchestrator tool + job | PR 2 | Yes — registered but only plannable when the model picks it |
| 4 | Request Changes routing + battery | PR 3 | Yes — activates the feature |
| 5 | UI surfacing | PR 3 (labels), PR 4 (real data) | Yes |
| 6 | Cleanup/docs | PR 5 | Yes |

PRs 1–3 are safe to land back-to-back with zero user-facing change; PR 4 is
the activation switch.

## Risks and open questions

- **Preview model.** `gemini-omni-flash-preview` may be renamed, rate-limited,
  or priced differently at GA. Keep the model id in one constant (provider
  file) and the pricing entry marked as provisional. Editing uploaded videos
  is currently unavailable to EEA/CH/UK users — surface Google's error as a
  clear, user-readable failure (`ToolError.recoverable = false`).
- **Cost accounting.** Omni edit pricing isn't in our `pricing.ts` table yet;
  PR 1 must not ship a $0 estimate (budget guard would under-reserve). Use
  the Veo per-second rate as a conservative placeholder until confirmed.
- **Duration/size limits.** The harness caps uploads at 250MB; Files API
  allows more but Omni preview behavior on long clips is unverified. Decide
  a per-edit duration cap (suggest ≤60s initially) enforced in the tool's
  precondition check, with a clear unmet-requirement message.
- **Format fallback cost.** The transcode-retry doubles upload time for
  HEVC/QuickTime sources (most phone footage). Acceptable for v1; a later
  optimization is probing the container first (ffprobe already available)
  and transcoding preemptively.
- **Slot semantics.** "Edited footage replaces source in the timeline" is
  clean for beat-slotted clips; for footage not yet placed on a timeline the
  edit simply yields a new library asset. PR 2 should implement the second
  case as the default and only swap selections when the source holds a slot.
- **Idempotency/retries.** `createOrGetJob` deduplicates **only when the
  caller supplies an `idempotencyKey`** (the column is nullable and the
  existing generation tools create jobs without one) — do not rely on
  `inputsFingerprint`, which is asset-graph metadata, not job dedup. PR 3
  therefore requires the tool to pass a deterministic key derived from
  `(sourceAssetId, source contentHash, normalized instruction, model)`:
  retrying the same edit reuses the in-flight/completed job, while a
  different instruction on the same source is a new edit.
