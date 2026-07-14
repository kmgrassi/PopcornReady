# Agent feedback log

<!-- agent-summary: Records concise, durable delivery-process feedback. -->
<!-- agent-summary: Add one entry for every completed durable task. -->
<!-- agent-summary: Keep entries free of secrets and customer data. -->
<!-- agent-summary: Group recurring friction during periodic review. -->
<!-- agent-summary: Link the owning worksheet when practical. -->
<!-- agent-summary: Promote repeated lessons into process documentation. -->
<!-- agent-summary: Preserve historical entries; append new feedback. -->

## Entries

### 2026-07-14 — Async orchestration completion must be single-flight

Completed `API-20260714-02`. An inline asset worker can complete before its
accepted invocation has been recorded and parked. Completion callbacks must not
drive the engine; they should wake the durable dispatch queue so its lease is the
single production turn owner. A `waiting → running` claim protects parked-run
recovery. The public-share URL issue observed in the same session was an
incorrectly handed-off workspace route, not a defect in the existing
`/p/:projectId` share control.

### 2026-07-14 — API-20260714-01

- **Lesson:** When bridging adjacent asset-graph stages, record the dependency as a graph input and state whether it is prompt guidance or a deterministic product-structure link.
- **Action:** The story-spine scope now explicitly distinguishes this narrow bridge from the pending relational scene/beat migration.
