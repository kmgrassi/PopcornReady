# Regeneration Coverage PR Plan

## Objective

Broaden regeneration from the current image-only endpoint into kind-specific,
graph-aware rerun contracts. Regeneration should mint new immutable versions or
new selected outputs through the orchestrator/tool layer, record provenance in
`actions`, and use graph rerun proposals to avoid unnecessary fan-out.

This scope closes gap 3 from
[`north-star-gap-audit.md`](north-star-gap-audit.md).

## Current State

Shipped:

- `POST /api/v1/assets/:assetId/regenerate` regenerates image assets from a
  saved or user-provided prompt.
- `regenerate_asset_version` mints a new immutable image version and repoints
  storyboard panels plus active selections.
- Several orchestrator tools accept `feedback` inputs and can produce new
  assets or selections as part of normal generation.
- `asset-revisions` and `board_feedback` can send targeted user intent back to
  the orchestrator.

Missing:

- Non-image assets are rejected by the image regenerate endpoint.
- There is no typed regeneration contract for keyframes, clips, audio,
  storyboards, or composite cuts.
- There is no shared proposal/execution vocabulary for "regenerate this
  candidate and maybe its dependents."
- Tool-specific regeneration behavior is not surfaced uniformly in the API/UI.

## Design Rule

Do not create one generic "regenerate anything" media endpoint.

Different asset kinds need different inputs:

- Images/keyframes need prompt, provider, size, anchors, and sometimes source
  frame.
- Clips need beat, keyframe, anchors, provider, duration, and video settings.
- Audio needs script/beat text, voice/soundtrack settings, provider, and timing.
- Storyboard rows need semantic text edits and snapshot assets.
- Cuts/composites need active child selections and assembly rules.

Each kind should have a small contract that maps to the existing tool surface
and records its inputs/outputs.

## Regeneration Contracts

```ts
type RegenerationKind =
  | "image"
  | "keyframe"
  | "clip"
  | "audio"
  | "storyboard"
  | "cut";

interface RegenerationRequest {
  schemaVersion: "regeneration_request.v1";
  kind: RegenerationKind;
  targetAssetId?: string;
  targetSelection?: {
    slotOwnerLineageId: string | null;
    slotRole: string;
  };
  message?: string;
  provider?: string;
  preserveInputs?: boolean;
  rerunDependents?: boolean;
}

interface RegenerationResult {
  schemaVersion: "regeneration_result.v1";
  actionId: string;
  inputAssetIds: string[];
  outputAssetIds: string[];
  movedSelections: Array<{
    slotOwnerLineageId: string | null;
    slotRole: string;
    activeAssetId: string;
  }>;
  downstreamProposalActionId?: string;
}
```

## Kind Strategy

### Image

Keep the existing endpoint behavior.

Changes:

- Align response metadata with `RegenerationResult`.
- Ensure the action row records prompt/provider/model and old/new asset IDs.

### Keyframe

Map to `generate_keyframe` with an explicit target beat/selection.

Inputs:

- beat snapshot asset
- visual anchors
- prior prompt/provider when available
- optional feedback message

Output:

- new keyframe asset
- active `beat_keyframe:*` selection moved to the new asset

### Clip

Map to `generate_clip` with the active keyframe and beat context.

Inputs:

- beat snapshot asset
- active keyframe
- anchors
- duration/aspect/provider
- optional feedback message

Output:

- new clip asset
- active `beat_clip:*` selection moved to the new asset

### Audio

Map to `generate_audio`.

Inputs:

- script/beat text
- voice/soundtrack slot
- provider/voice settings
- optional feedback message

Output:

- new audio asset
- active `voiceover:*` or `soundtrack:*` selection moved to the new asset

### Storyboard

Semantic storyboard changes should not mutate rows without snapshots.

Inputs:

- target scene/beat/panel
- user message
- current storyboard assets/selections

Output:

- new storyboard/beat/panel snapshot as needed
- downstream rerun proposal for affected keyframes/clips

### Cut / Composite

Map to `assemble_timeline`.

Inputs:

- current active visual/audio selections
- assembly settings
- optional feedback message

Output:

- new cut/composite asset
- active `cut` selection moved to the new asset

## API Shape

Keep image endpoint for compatibility:

- `POST /api/v1/assets/:assetId/regenerate`

Add graph-aware project endpoint:

- `POST /api/v1/projects/:projectId/regenerations`

Request:

```json
{
  "kind": "keyframe",
  "targetAssetId": "uuid",
  "message": "Make this frame brighter.",
  "rerunDependents": false
}
```

Response:

```json
{
  "regeneration": { "schemaVersion": "regeneration_result.v1" },
  "proposal": { "schemaVersion": "rerun_proposal.v1" }
}
```

If `rerunDependents` is true or if the regenerated asset has active downstream
consumers, the endpoint should create or reference a rerun proposal from
[`graph-rerun-decisioning-prs.md`](graph-rerun-decisioning-prs.md).

## PR Plan

### PR 1 - Shared Regeneration Types And Action Metadata

Add shared request/result types and update the image regenerate path to return
the common metadata shape.

Acceptance:

- Existing image regeneration clients keep working.
- New response includes old/new asset IDs and moved selections.
- Tests cover non-image rejection unchanged.

### PR 2 - Keyframe Regeneration

Implement `POST /api/v1/projects/:projectId/regenerations` for `kind=keyframe`.

Acceptance:

- Regenerates one keyframe from beat/anchor context.
- Appends/moves the correct active keyframe selection.
- Records action input/output assets.
- Does not regenerate clips automatically; returns a downstream proposal when
  dependents exist.

### PR 3 - Clip Regeneration

Add `kind=clip`.

Acceptance:

- Uses active keyframe, beat, anchors, and duration.
- Moves only the target clip selection.
- Records provider cost and action provenance.

### PR 4 - Audio Regeneration

Add `kind=audio` for voiceover and soundtrack slots.

Acceptance:

- Regenerates one audio slot without touching visual assets.
- Handles missing script/voice settings with typed precondition errors.

### PR 5 - Cut Reassembly

Add `kind=cut` mapped to `assemble_timeline`.

Acceptance:

- Creates a new cut/composite asset from current active selections.
- Moves the `cut` selection.
- Does not regenerate source media.

### PR 6 - Storyboard Semantic Regeneration

Add storyboard-specific regeneration for semantic beat/panel edits.

Acceptance:

- Semantic beat edits mint new snapshots.
- Affected downstream assets are proposed through graph rerun decisioning.
- No first-class storyboard structure is hidden in untyped JSONB.

## Non-Goals

- Do not auto-cascade all descendants without a proposal.
- Do not mutate existing asset semantic fields.
- Do not fold all kinds into the image regenerate endpoint.
- Do not duplicate tool logic in route handlers; route through tool services.

## Dependencies

- Keyframe/clip/audio regeneration can start before full OODA learning.
- Downstream fan-out should depend on graph rerun proposals.
- Storyboard semantic regeneration depends on stable storyboard write-path
  contracts.
