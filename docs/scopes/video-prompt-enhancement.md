# Video Prompt Enhancement

<!-- agent-summary: Asset Studio video requests use a default-on text-model motion-direction pass. -->
<!-- agent-summary: The creator can disable enhancement and send the trimmed original prompt exactly. -->
<!-- agent-summary: Enhancement applies to video creation, never source-aware video editing. -->
<!-- agent-summary: The reviewed effective prompt is bound to the digest, task, run, action, and preview. -->
<!-- agent-summary: Proposal provenance retains the original prompt, effective prompt, and policy version. -->
<!-- agent-summary: Invalid or failed enhancement creates no run, action, gate, or silent fallback. -->
<!-- agent-summary: The policy favors one coherent short shot with restrained, physically legible motion. -->

## Purpose

Asset Studio should turn a creator's video idea into useful motion direction
without asking them to learn provider-specific prompting. For `video_create`,
the web UI offers **Improve video prompt** as a default-on control. The
configured fast text model preserves the request while clarifying the opening
state, subject action, temporal order, camera behavior, spatial continuity,
environmental motion, and end state when those details are useful.

The policy assumes one coherent short shot and an eight-second downstream
default. It honors requested cuts or montage but does not invent them. It also
forbids invented subjects, products, logos, copy, brand facts, plot, dialogue,
audio, durations, extra beats, and simultaneous actions. Because the text model
does not inspect reference assets, it preserves their relationships without
claiming what they depict.

`video_edit` remains outside this policy. An edit instruction targets a pinned
source asset and must preserve minimal-delta semantics; any future edit-prompt
enhancement needs a separate source-aware design.

## Proposal and provenance contract

Enhancement is part of `POST
/api/v1/projects/:projectId/agent-creations/proposals`. The endpoint requires an
`Idempotency-Key` before project/reference validation or model spend, and the
shared mutation wrapper reserves the complete proposal operation. A retry with
the same key therefore replays the effective prompt and proposal without a
second refinement call.

The server:

1. parses `improvePrompt` as a strict boolean;
2. verifies the authenticated project and referenced assets before model spend;
3. enhances only `video_create` requests whose flag is true;
4. validates a non-empty result no longer than 4,000 characters;
5. binds the effective prompt to the digest, domain task objective and
   instruction, run summary, proposal rationale, and action provenance, while
   deriving a separate server-authored acceptance criterion bounded to the
   domain completion contract; and
6. stores original/effective prompts, applied state, and the versioned
   `video_motion_direction_v1` policy in action provenance.

The proposal response returns `effectivePrompt` and `enhancementApplied`.
Asset Studio keeps the original prompt editable and shows both versions on the
review route before manual or timed confirmation. If enhancement fails or
returns invalid output, the endpoint returns `model_output_invalid` before any
creator-direct run, proposal action, or gate is created. The creator can retry
or turn off enhancement; the server never silently falls back.

## Cost boundary

Prompt refinement is a small text-model call recorded against the project
through the shared LLM cost ledger. It happens before confirmation and remains
outside the proposal maximum for asset generation. UI copy therefore states
that asset generation has not started, rather than claiming that no model work
has occurred.

## Ownership and validation

- Policy and structured call:
  `apps/api/src/lib/api/v1/video-prompt-enhancement.ts`
- Proposal binding and provenance:
  `apps/api/src/routes/v1/agent-creations.ts`
- Typed client mutation:
  `apps/web/src/lib/agent-creations.ts`
- Creator control and review:
  `apps/web/src/routes/StandaloneCreationPage.tsx` and
  `apps/web/src/routes/AssetCreationReviewPage.tsx`

Required coverage includes policy/output validation, cost recording, enhanced
video propagation, exact video opt-out, exact pass-through for video edits and
audio, failure-before-persistence ordering, idempotent replay, default-on UI
state, motion-specific progress copy, effective-prompt preview, draft-preserving
revision, and desktop/mobile behavior.
