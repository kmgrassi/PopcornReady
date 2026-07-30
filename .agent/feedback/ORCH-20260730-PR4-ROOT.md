# Feedback: ORCH-20260730-PR4-ROOT

<!-- agent-summary: Task feedback for root story, assembly, and critique rerun adapters. -->
<!-- agent-summary: Prospective outputs must be consumed by binding, not active pointer. -->
<!-- agent-summary: Stable story row identity and immutable snapshot identity are separate. -->
<!-- agent-summary: Missing fan-in is scheduling state, not permission to widen scope. -->
<!-- agent-summary: Model-backed critique failures may still have measurable cost. -->
<!-- agent-summary: Follow-up critique proposals remain inert until separately approved. -->
<!-- agent-summary: This record ships with the implementation worksheet. -->

## Lesson

Pooling an output is only half of selective regeneration. Downstream root work
must also be able to consume that pooled output before it becomes active.
Reading `current_selections` inside assembly would silently reconstruct the old
forward-only pipeline and assemble the prior cut whenever fan-in had not yet
moved pointers.

Story identity has the same two-layer shape. Scene and beat row IDs remain
stable product identities, while their snapshot asset IDs advance through
immutable history. An executor therefore needs both the exact row identity and
the pinned predecessor pointer; an asset ID alone cannot authorize a semantic
row update.

Finally, a failed critic is not necessarily a free critic. If the canonical
service invokes a model before failing, its approved child reservation must
remain available for measured settlement and recovery. Zero-cost release is
safe only for demonstrably deterministic services that did not call a
provider.

## Follow-up

PR 5 owns dependency-aware ordering, canonical-service wiring, production
registration, atomic pointer/selection application, and terminal cost
settlement. It should treat typed missing prospective bindings as an internal
fan-in scheduling condition before invocation, not as grounds for blind retry
or broader authority.
