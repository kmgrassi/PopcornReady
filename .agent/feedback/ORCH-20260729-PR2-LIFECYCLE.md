# Feedback: ORCH-20260729-PR2-LIFECYCLE

<!-- agent-summary: Task-scoped feedback for the durable selective-regeneration lifecycle. -->
<!-- agent-summary: Execution authority belongs in locked database transitions, not route code. -->
<!-- agent-summary: External work needs a callback fence before the provider can be launched. -->
<!-- agent-summary: Completed work and callbacks must replay without repeating billable execution. -->
<!-- agent-summary: Proposal budget settlement must derive from canonical child reservations. -->
<!-- agent-summary: Nullable preview attribution must not create observable ghost root runs. -->
<!-- agent-summary: The record is committed with the implementation and worksheet. -->

## Lesson

Durability is not obtained by persisting an execution status around an
otherwise synchronous handler. Admission, freshness, budget, ownership, and
idempotency have to become one locked database decision. Otherwise two valid
requests can each pass an application-level check and both launch billable
work.

The same rule applies at every asynchronous boundary. A callback identity and
lease generation must exist before a provider launch, and the callback must
revalidate the exact proposal, reservation, work item, and output binding
before its result can become eligible for reconciliation. A retry should read
completed work or a stored callback result and continue; it should never infer
that an executor needs to run again merely because the process restarted.

For composed work, the durable boundary must be the executor step rather than
the coarse work item. Each step needs its own binding subset, child/report
identity, primitive actions, budget keys, and output rows. Persisting only the
fan-in result leaves a crash window where an earlier executor can be invoked
again and makes two child reports impossible to validate without discarding
causation.

Cost accounting also needs one authoritative ledger. The proposal reservation
is the parent commitment, each provider or model launch reserves beneath it,
and terminal actual cost is the sum of settled child reservations. Accepting an
executor-reported total would create a second mutable source of truth and make
duplicate callbacks or partial recovery financially ambiguous.

Finally, preview attribution is not execution materialization. A proposal can
honestly have no root run until admission succeeds. Creating a queued root to
obtain an ID makes inert preview visible as active work and complicates
refresh, rejection, and stale-proposal cleanup. Nullable attribution plus
transactional root materialization keeps that boundary explicit.

## Follow-up

PRs 3A, 3B, 3C, and 4 should implement adapters against the capability-level
registry and durable accepted/blocked result union without registering them in
production. PR 5 owns production activation, atomic selection/story-pointer
application, reconciliation, and final cost settlement.
