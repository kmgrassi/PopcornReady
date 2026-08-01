# Feedback: WEB-20260801-VIDEO-PROMPT-QUALITY

<!-- agent-summary: Task-scoped feedback for creator-direct video prompt enhancement. -->
<!-- agent-summary: Image and video refinement preferences must remain independently default-on. -->
<!-- agent-summary: Modality-specific behavior needs modality-specific idempotency and failure tests. -->
<!-- agent-summary: Source-aware video edits must not inherit blind creation-prompt rewriting. -->
<!-- agent-summary: Uninspected reference assets are relationships, not visual facts for the text model. -->
<!-- agent-summary: Browser fixtures prove review behavior without spending provider credits. -->
<!-- agent-summary: This record ships with worksheet WEB-20260801-VIDEO-PROMPT-QUALITY. -->

## Lesson

When one UI control expands across modalities, a single shared boolean can
silently violate each modality's independent default. Keep per-modality
preferences and make the new modality itself exercise idempotency, failure
ordering, and provenance tests rather than relying on an older shared-path test.

## Follow-up

Any future `video_edit` prompt enhancement should be designed separately around
the pinned source asset and explicit minimal-delta preservation.
