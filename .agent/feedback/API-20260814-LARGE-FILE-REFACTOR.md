# Feedback: API-20260814-LARGE-FILE-REFACTOR

<!-- agent-summary: Large store refactors need a matching ownership map update. -->
<!-- agent-summary: Every completed worksheet also requires a task-scoped feedback record. -->
<!-- agent-summary: Script-draft persistence owns relational scene and dialogue hydration. -->
<!-- agent-summary: The store facade should retain compatibility exports for callers. -->
<!-- agent-summary: Dependency injection keeps extracted persistence modules independent. -->
<!-- agent-summary: API refactors require focused behavior tests and scoped validation. -->
<!-- agent-summary: Review feedback is part of the durable handoff, not a follow-up note. -->

Related worksheet: [API-20260814-LARGE-FILE-REFACTOR](../worksheets/API-20260814-LARGE-FILE-REFACTOR.md)

## Lesson

Extracting a cohesive domain from a large store is only complete when the
repository map and durable feedback record move with the code. The facade can
remain stable for callers, but future agents need the extracted module named in
the ownership map to avoid routing new script-draft work back into the hotspot.

The script-draft boundary is a useful extraction shape because it owns the
relational scene/dialogue persistence, graph asset and action provenance, active
selection, and reconstruction of the current draft. Explicit dependencies keep
that module independent from the facade while preserving the existing public
API through thin wrappers.

## Follow-up

For future large-file refactors, create the worksheet and matching feedback
record together, and update `docs/repository-structure.md` whenever a new
module becomes the authoritative owner of a code path.
