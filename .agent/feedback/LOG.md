# Agent feedback log

<!-- agent-summary: Records concise, durable delivery-process feedback. -->
<!-- agent-summary: Add one entry for every completed durable task. -->
<!-- agent-summary: Keep entries free of secrets and customer data. -->
<!-- agent-summary: Group recurring friction during periodic review. -->
<!-- agent-summary: Link the owning worksheet when practical. -->
<!-- agent-summary: Promote repeated lessons into process documentation. -->
<!-- agent-summary: Preserve historical entries; append new feedback. -->

## Template

```md
### YYYY-MM-DD — <WORKSHEET_ID>
- What helped:
- Friction or failure:
- Suggested improvement:
- Follow-up: <TODO / PR / none>
```

## Entries

### 2026-07-14 — Async orchestration completion must be single-flight

Completed `API-20260714-02`. An inline asset worker can complete before its
accepted invocation has been recorded and parked. Completion callbacks must not
drive the engine; they should wake the durable dispatch queue so its lease is the
single production turn owner. A `waiting -> running` claim protects parked-run
recovery. The public-share URL issue observed in the same session was an
incorrectly handed-off workspace route, not a defect in the existing
`/p/:projectId` share control.

### 2026-07-14 — API-20260714-01

- **Lesson:** When bridging adjacent asset-graph stages, record the dependency as a graph input and state whether it is prompt guidance or a deterministic product-structure link.
- **Action:** The story-spine scope now explicitly distinguishes this narrow bridge from the pending relational scene/beat migration.

### 2026-07-13 — AGENT-OPS-001

- What helped: Existing E2E inventory and repository conventions supplied a useful base.
- Friction or failure: No alternate-agent CLI is configured, so independent review is documented but not executed in this task.
- Suggested improvement: Configure `AGENT_REVIEW_COMMAND` for a provider different from the implementing agent.
- Follow-up: `TODOS.md` visual-regression and performance-baseline items.

### 2026-07-13 — AGENT-OPS-001

- What helped: The review surfaced two concrete command-line correctness gaps that were easy to reproduce with small shell smokes.
- Friction or failure: `pnpm --` forwarding and partially staged markdown made the first tooling cut validate the wrong content.
- Suggested improvement: Add a lightweight script-level regression harness for agent tooling so review-fix cases do not rely on ad hoc shell probes.
- Follow-up: none.
