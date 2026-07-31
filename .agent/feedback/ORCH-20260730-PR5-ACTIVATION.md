# Feedback: ORCH-20260730-PR5-ACTIVATION

<!-- agent-summary: Task feedback for selective-regeneration production activation. -->
<!-- agent-summary: Activation and atomic graph application must ship together. -->
<!-- agent-summary: Durable output bindings are the only authority for pointer moves. -->
<!-- agent-summary: Final freshness checks belong inside the applying transaction. -->
<!-- agent-summary: Provider outputs remain pooled whenever terminal application fails. -->
<!-- agent-summary: Adapter-family composition should minimize parallel merge conflicts. -->
<!-- agent-summary: This record ships with the PR 5 implementation worksheet. -->

## Lesson

Production activation is not a registry toggle. Once real adapters can spend,
the final state transition must prove exact output identity, causation,
freshness, and accounting in the same transaction that makes outputs active.
Persisting output assets early is safe only when selection and story pointers
remain completely outside adapter authority.

Append-only selections also need two layers of concurrency control. A
transaction-scoped advisory lock serializes lifecycle writers without granting
the API role broad table-update authority; the unique slot/sequence index still
rejects writers that do not share that lock. Mapping that unique violation back
to `stale_proposal` makes the recovery path deterministic.

Direct-role integration found two issues that unit tests could not: untyped
array parameters in UUID comparisons and missing column privileges for
`ON CONFLICT` / graph application. The fix belongs both in the transaction and
in the health readiness inventory so deployment cannot report healthy with an
incomplete capability surface.

Independent review also caught a dangerous gap between "registered" and
"performed." A production adapter cannot substitute a metadata-only rewrite or
a segment-count critique for the approved semantic operation. Root execution
now shares the canonical story, assembly, and critique preparation paths;
model-backed work receives a nonzero proposal ceiling and action-scoped measured
cost. Assembly's timeline remains visual, but its causal graph includes every
semantically consumed plan, video, Audio, and preserved asset.

Story-pointer authority is safer as a fixed-shape database operation than as raw
column UPDATE plus a custom session claim. The security-definer boundary
rechecks the live reservation, terminal action, immutable planned move,
completed exact binding, destination asset role, and pointer CAS inside the
caller's final transaction.

Finally, overage is an accounting fact, not permission to apply. Actual spend
must settle first; then the successful transaction may reject the ceiling and
roll back every graph move while a separate failed terminalization preserves
the measured cost.

## Follow-up

PR 6 can move every Request Changes caller onto this lifecycle without knowing
provider details. PR 7 can delete the old revision and stage-restart paths only
after those callers no longer bypass the proposal boundary. Keep structured-call
ceilings aligned with canonical model pricing as those services evolve.
