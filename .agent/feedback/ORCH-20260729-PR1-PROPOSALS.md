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

Preview persistence must also remain separate from run transport. A queued
orchestrator row is observable active work even when no dispatch exists, so an
inert proposal cannot create one merely to obtain an attribution ID. Nullable
action attribution is the honest state until approval creates executable work.

Stable target IDs are not sufficient model context on their own. Timeline and
transcript targets must resolve to bounded semantic rows and backing assets
before graph closure, while broad project context must seed its current
selection/story/timeline/transcript heads. Explicit targets and story rows are
reserved before bounded remainder so scale cannot silently erase the requested
meaning or its freshness pins.

Logical story targets cannot share a pointer identity merely because one
projection currently aliases their IDs. Blueprint asset freshness and
storyboard plan freshness are separate pins and separate planned moves; PR 2
must compare-and-swap the row kind named by the proposal.

At project scale, semantic-row and asset budgets must be allocated together.
The packet now chooses bounded timeline/transcript rows first, reserves their
backing assets ahead of selection-head remainder, and finally removes any row
whose required backing asset and asset pin did not fit. This preserves the
invariant that every semantic fact shown to the model is executable against a
freshness-fenced graph node.

Authorization must also cover model choices within the bounded packet, not
only the request's original targets. Exposing timeline and transcript rows while
rejecting them as selected work gives the model context it cannot act on. The
safe boundary is exactly the retained semantic rows, with their already-retained
backing-asset pins.

An absent selection is real freshness state, but only after the server derives
the slot identity from its canonical role catalog and existing stable rows or
lineages. That produces a truthful null/sequence-zero CAS pin without turning a
free-form slot string into write authority.

Creator-facing quotes cannot use a parallel price model. Mapping bound outputs
to the existing provider/kind estimator and deriving timed duration from the
authorized target keeps preview ceilings aligned with the tools that will
execute them. Whole-story snapshots have a similar canonical mapping:
project-level story work points to the story blueprint row, rather than leaving
its output pooled and unselected.

## Follow-up

Roadmap PR 2 must carry each server-issued `bindingId`, `workItemId`, target, and
ordinal through `DomainRequiredOutput` and `DomainReport.v1` output entries,
then reject reports that claim any other binding. It must not infer output
identity from asset kind, role, or order.
