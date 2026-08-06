# Feedback: WEBAPI-20260805-ASSET-FEEDBACK

<!-- agent-summary: Task feedback for exact-asset advisory AI critique. -->
<!-- agent-summary: Advisory analysis and content mutation need separate product contracts. -->
<!-- agent-summary: Exact asset identity must survive every summary and review surface. -->
<!-- agent-summary: Scripts need an authoritative active graph asset ID, not project-level fallback. -->
<!-- agent-summary: Video critique must disclose that representative frames are sampled. -->
<!-- agent-summary: Retry-safe model calls require a stable client idempotency key. -->
<!-- agent-summary: This feedback ships with worksheet WEBAPI-20260805-ASSET-FEEDBACK. -->

## Lesson

“Ask AI about this” looks visually close to Request Changes, but its system
contract is materially different. A critique must be allowed to observe and
persist its own provenance while remaining incapable of changing the reviewed
asset, moving a selection, starting generation, or creating a rerun proposal.
Keeping a separate endpoint, mutation, and dialog makes that boundary testable.
The durable HTTP idempotency reservation is the first retry fence;
deterministic action/result IDs and persisted-result replay are the recovery
fence if a process dies after domain persistence but before the HTTP record is
completed.

Exact identity is the enabling primitive. Images and videos already carried
asset IDs through most review surfaces; scripts did not. Reading the selected
active script asset and its typed immutable snapshot from the dedicated script
boundary lets the UI display and review the same object, avoiding a tempting but
incorrect project-level fallback or duplicate general-project projection.

Multimodal fidelity also needs honest limits. Image critique can send the stored
bytes directly. Video critique sends representative sampled frames, so every
answer must disclose that temporal nuance, audio, and unsampled moments may be
missed. That limitation is part of the result contract, not incidental UI copy.

## Follow-up

- Preserve exact graph IDs when adding future asset summary or review surfaces.
- Keep advisory critique responses out of active content selections even when
  they are stored as graph assets for provenance.
- If audio feedback is added later, introduce an audio-capable provider contract
  and its own limitations instead of treating a soundtrack as a video frame set.
- Reuse one stable idempotency key when retrying the same submitted question so
  network uncertainty cannot multiply paid model calls.
