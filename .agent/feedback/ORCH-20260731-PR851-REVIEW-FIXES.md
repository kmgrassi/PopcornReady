# Feedback: ORCH-20260731-PR851-REVIEW-FIXES

<!-- agent-summary: Review feedback exposed dependency, identity, projection, and cardinality gaps. -->
<!-- agent-summary: A tool prompt cannot preserve fields excluded by its structured-output schema. -->
<!-- agent-summary: Stable IDs must be reconciled by identity and new nodes marked explicitly. -->
<!-- agent-summary: Dependent root work must not share the provider fan-out wave. -->
<!-- agent-summary: Pointer application must update every semantic projection used by readers. -->
<!-- agent-summary: Ambiguous aggregate bindings should fail coverage before approval. -->
<!-- agent-summary: This feedback ships with the PR 851 review-fix worksheet. -->

## Lesson

Structured generation contracts outrank prompt instructions. Asking a model to
preserve IDs is inert when the JSON schema excludes those IDs; a revision path
needs an identity-bearing schema and server reconciliation that distinguishes
known entities from explicit new nodes.

Concurrency also needs dependency shape, not only durable callbacks. Parallel
media generation is correct, but assembly and critique consume those outputs
and therefore belong to later waves. Parking an upstream wave must prevent even
reserving dependent work.

Finally, an immutable asset pointer is only useful when every live reader sees
the same semantics. Whole-blueprint and exact-beat rows have an atomic typed
projection today. Aggregate storyboard/scene revisions do not: their relational
IDs differ from plan IDs and scene asset columns also own visual media. Failing
coverage early is safer than claiming executability or partially updating the
projection. The same rule applies to storyboard tile cardinality—one binding
must name one exact beat/panel output.

## Follow-up

Add a dedicated semantic scene snapshot column and explicit plan-to-relational
identity mapping before re-enabling aggregate storyboard or scene story
revisions. Proposal construction can then expand aggregate storyboard media
intent into exact per-beat bindings.
