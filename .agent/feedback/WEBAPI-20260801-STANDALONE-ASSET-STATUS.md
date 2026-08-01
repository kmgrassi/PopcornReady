# Feedback: WEBAPI-20260801-STANDALONE-ASSET-STATUS

<!-- agent-summary: Task feedback for one-off asset status and completion repair. -->
<!-- agent-summary: Generic production-stage fallbacks mislabeled creator-direct asset work as Script. -->
<!-- agent-summary: Terminal transport must win over stale mutable action status in creator projections. -->
<!-- agent-summary: Control, storage, and report actions are provenance, not creator-visible progress steps. -->
<!-- agent-summary: Conflicting model instructions can invalidate an otherwise successful durable output. -->
<!-- agent-summary: One-off assets still belong to real projects and the immutable asset graph. -->
<!-- agent-summary: This feedback ships with worksheet WEBAPI-20260801-STANDALONE-ASSET-STATUS. -->

## Lesson

Creator-visible progress cannot be reconstructed from stage-type fallbacks alone.
Finite domain runs already persist the stable origin and task identity needed to
choose the right presentation; consuming repeated broad fallback types caused a
single image tool to impersonate Brief and Script. Terminal transport also has
to bound the display lifecycle even when historical action cleanup was missed.

The successful retry exposed a second boundary mismatch: a shared “concise text
summary” instruction contradicted the role prompt's typed JSON report. Terminal
response shape belongs in the model-turn contract, not in a universal suffix.

## Follow-up

- Keep proposal/storage/report actions queryable for diagnosis but exclude them
  from creator progress projections.
- Use `origin_kind` + `task_kind` when adding future creator-direct task types,
  and extend the standalone presentation union deliberately.
- Maintain the terminal-state projection matrix whenever action/job lifecycle
  semantics change.
