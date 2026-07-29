# Feedback: ORCH-20260729-PR1-PROPOSALS

<!-- agent-summary: Task-scoped feedback for the model-backed selective-regeneration proposal. -->
<!-- agent-summary: Public preview input must not author source, policy, graph closure, or execution. -->
<!-- agent-summary: Semantic model output and deterministic server policy need separate schemas. -->
<!-- agent-summary: Bounded graph context must retain stable IDs, depth, pins, and truncation evidence. -->
<!-- agent-summary: Story pointer contracts must name the live canonical relational columns. -->
<!-- agent-summary: Output binding identity must survive duplicate kind and role combinations. -->
<!-- agent-summary: The record is committed with the implementation and worksheet. -->

## Lesson

The safest proposal boundary is narrower than the final durable proposal.
The model needs enough stable graph/story context to make a semantic decision,
but it must never return the fields that authorize execution. Parsing a
semantic-only decision and deriving bindings, pins, cost, risk, approval, and
pointer moves afterward makes that ownership visible and testable.

The live relational schema also matters at the type boundary. A generic
`panel`/`storyboard` pointer union would imply snapshot heads that do not exist.
Naming the exact blueprint, scene, and beat pointers prevents later executor
code from inventing writes against retired or noncanonical surfaces.

Clarification identity is also authorization state, not creative content. A
model may propose the question and bounded choices, but only the server can
derive the answer fingerprint because it must cover every freshness pin. The
same principle applies to ambiguous asset-to-selection relationships: when one
asset is active in multiple slots, decisioning must require the stable
selection identity instead of silently choosing the first match.

Collection bounds must apply recursively. Capping the outer asset/action lists
is insufficient if one asset can carry unbounded inputs or selection references,
or if routine actions can evict terminal domain reports. Each nested collection
now has its own deterministic deduplication, budget, and truncation evidence.

## Follow-up

Roadmap PR 2 must carry each server-issued `bindingId`, `workItemId`, target, and
ordinal through `DomainRequiredOutput` and `DomainReport.v1` output entries,
then reject reports that claim any other binding. It must not infer output
identity from asset kind, role, or order.
