# Feedback: ORCH-20260731-PR844-REVIEW

<!-- agent-summary: Task feedback for the PR 844 review response. -->
<!-- agent-summary: Direct-role visibility should follow durable causation. -->
<!-- agent-summary: Tool-name allowlists are too broad and drift as capabilities grow. -->
<!-- agent-summary: Idempotent persistence APIs must return the winning stored value. -->
<!-- agent-summary: Terminal wrappers must project persisted state, not requested intent. -->
<!-- agent-summary: Positive local-role tests complement static policy assertions. -->
<!-- agent-summary: This record is committed with the worksheet and implementation. -->

## Lesson

Least-privilege workflow reads should follow the same durable causation the
transaction validates: parent root, dispatch action, proposal, reservation,
and specialist child. A hardcoded primitive-tool list either becomes too broad
or drifts when executors gain capabilities.

Idempotency also applies to returned data. When a concurrent persistence call
replays another request's winner, returning the losing caller's generated value
creates an envelope that never existed. Likewise, a cancellation wrapper must
report an already-terminal success as success, not infer cancellation from the
request that arrived too late.

## Follow-up

Keep future provider-backed rerun executor tests on the exact `popcorn_api`
role and include at least one positive child-run, primitive-action, budget, and
output-causation path.
