# Feedback: API-20260812-LARGE-FILE-REFACTOR

<!-- agent-summary: Read-only projection boundaries are effective extraction seams. -->
<!-- agent-summary: Facade re-exports preserve focused test and route compatibility. -->
<!-- agent-summary: Fresh worktrees need dependency bootstrap before checks can run. -->
<!-- agent-summary: Detail refactors require authorization and diagnostics regression coverage. -->
<!-- agent-summary: Keep metadata loading and hierarchy assembly together with detail projection. -->
<!-- agent-summary: Record unavailable independent review providers instead of implying review occurred. -->
<!-- agent-summary: This feedback entry ships with its matching worksheet and implementation. -->

## Lesson

The orchestrator route module had a cohesive read-only boundary separate from
entrypoint and lifecycle mutations. Moving detail assembly, asset/job metadata,
and hierarchy projection together reduced the facade substantially while
preserving its public exports.

## Follow-up

For future route refactors, identify read-only projection or mutation-policy
boundaries first, then validate both the facade contract and the extracted
module's authorization behavior. Fresh automation worktrees should bootstrap
the cached dependencies before invoking package scripts.
