# Feedback: ORCH-20260731-PR847-REVIEW-FIXES

<!-- agent-summary: Review feedback exposed a gap between executor replay and lifecycle terminalization. -->
<!-- agent-summary: Retryability depends on durable output and immutable settlement state, not error text. -->
<!-- agent-summary: Transient zero-spend failures may retain one approved reservation and fenced identity. -->
<!-- agent-summary: Spent failures without durable output must not replay under one settlement key. -->
<!-- agent-summary: Database settlement errors need a transient allowlist rather than a broad retry default. -->
<!-- agent-summary: Work-item cardinality must agree from model parsing through production preflight. -->
<!-- agent-summary: Terminal execution cleanup must release every still-reserved child admission. -->

## Lesson

Executor-level idempotency does not create lifecycle replay by itself. A thrown
executor error used to flow through `failWorkItem`, which made direct retry
tests pass while production work became terminal. Safe recovery now depends on
what is durable: a transient zero-spend failure can retain its original
admission, and a durably staged asset can replay an ambiguous settlement
acknowledgement. A
spent call without a staged result cannot reuse the same immutable settlement
tuple for another provider attempt.

Database errors also cannot be classified as one retryable bucket. Connection,
serialization, deadlock, and timeout classes are ambiguous; missing, invalid,
wrong-state, and settlement-replay conflicts are permanent. Defaulting unknown
database codes to terminal avoids parking a work item forever on an invariant
violation.

Finally, capability coverage is not only per binding. When an executor consumes
one relational pointer at a time, parser, finalizer, registry, and executor must
all agree that one work item owns one matching target/output pair. Multi-row
intent remains valid, but it is represented as multiple bounded work items.

## Follow-up

Run the direct `popcorn_api` lifecycle integration in CI (or a healthy local
Supabase stack) to confirm expired recovery releases the retained child key.
If spent-before-output provider retries become a product requirement, introduce
attempt-specific primitive actions and reservation keys with explicit remaining
ceiling admission rather than widening this replay path.
