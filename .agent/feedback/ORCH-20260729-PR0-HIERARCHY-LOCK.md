# Feedback: ORCH-20260729-PR0-HIERARCHY-LOCK

<!-- agent-summary: Task-scoped feedback for selective-regeneration roadmap PR 0. -->
<!-- agent-summary: Root ownership must be checked at every continuation boundary. -->
<!-- agent-summary: Immutable legacy profiles are terminalized rather than rewritten. -->
<!-- agent-summary: Project-scoped intent may start a fresh hierarchy root. -->
<!-- agent-summary: Run-scoped state must not be silently transplanted between roots. -->
<!-- agent-summary: Migration cleanup must close durable dispatches as well as runs. -->
<!-- agent-summary: The reusable lesson and follow-up are completed before handoff. -->

## Lesson

A durable root is not safely retired by changing only its own status. Its
causal family includes descendant runs, jobs, active session claims, budget
reservations, and dispatch leases, so migration and runtime replacement should
reuse the canonical family-cancellation boundary and explicitly close any
durable surface that boundary does not own. Likewise, project history must be
filtered to root roles before “latest” selection; a newer domain child is not a
candidate root. One-time cleanup is also insufficient during a rolling deploy:
install the database write fence before sweeping historical rows, and make the
runtime refusal path terminalize the causal family before retiring its dispatch.

## Follow-up

Roadmap PR 7 can delete the now-unreachable flat registry and
`root_execution_profile` compatibility column after the intervening rollout PRs
prove all production reads and writes are hierarchy-native.
