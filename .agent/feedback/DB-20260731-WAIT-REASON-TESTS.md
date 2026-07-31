# Feedback: DB-20260731-WAIT-REASON-TESTS

<!-- agent-summary: Task-scoped feedback for finite-run wait-reason database coverage. -->
<!-- agent-summary: Mocked Supabase tests cannot prove a cross-column Postgres constraint. -->
<!-- agent-summary: Opt-in integration suites need a dedicated, discoverable root command. -->
<!-- agent-summary: Fixtures must satisfy the real session, delegation, task, and root shapes. -->
<!-- agent-summary: Assert both store projections and raw persisted rows at the boundary. -->
<!-- agent-summary: Negative writes should identify SQLSTATE and the named constraint. -->
<!-- agent-summary: This record accompanies worksheet DB-20260731-WAIT-REASON-TESTS. -->

## Lesson

A unit test for `updateOrchestratorRun` can prove that an update object contains
`wait_reason`, but it cannot prove that the complete row satisfies the database's
role/status/reason relationship. The regression suite therefore needs a reset
local Postgres database, schema-valid domain-run fixtures, and assertions on both
the public store projection and the persisted row.

## Follow-up

Keep database-required integration suites reachable through explicit root
commands and state accurately whether CI provisions their dependencies. For
cross-field constraints, include accepted shapes, rejected shapes, unchanged-row
assertions after rejection, and the recovery transition that clears coupled
fields atomically.

The false-confidence audit temporarily restored the dropped-reason behavior in
the production store. The suite failed immediately with SQLSTATE `23514` at
`orchestrator_runs_wait_reason_shape`, demonstrating that it detects the original
failure rather than merely exercising fixture setup.
