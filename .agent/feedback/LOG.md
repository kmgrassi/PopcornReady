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
### YYYY-MM-DDTHH:mm:ss±HH:mm — <WORKSHEET_ID>
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

### 2026-07-13T13:20:10-04:00 — AGENT-OPS-001
- What helped: Existing E2E inventory and repository conventions supplied a useful base.
- Friction or failure: No alternate-agent CLI is configured, so independent review is documented but not executed in this task.
- Suggested improvement: Configure `AGENT_REVIEW_COMMAND` for a provider different from the implementing agent.
- Follow-up: `TODOS.md` visual-regression and performance-baseline items.

### 2026-07-13T14:05:36-04:00 — AGENT-OPS-001
- What helped: The review surfaced two concrete command-line correctness gaps that were easy to reproduce with small shell smokes.
- Friction or failure: `pnpm --` forwarding and partially staged markdown made the first tooling cut validate the wrong content.
- Suggested improvement: Add a lightweight script-level regression harness for agent tooling so review-fix cases do not rely on ad hoc shell probes.
- Follow-up: none.

### 2026-07-14T10:06:38-04:00 — ARCH-20260714-01
- What helped: The new task router, isolated worktree, existing durability research, and independent checkpoints made the architecture dependencies explicit.
- Friction or failure: Tool ownership and counts are duplicated across types, prompts, documentation, and UI projections, making the current surface easy to misstate.
- Suggested improvement: Establish one canonical capability catalog and derive specialist registries, labels, gates, and detailed documentation from it.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 1–2.

### 2026-07-14T10:42:39-04:00 — ARCH-20260714-02
- What helped: Comparing the proposal to the concrete `driveLoop` injection seams separated reusable runtime mechanics from agent-role configuration.
- Friction or failure: “Persistent child agent” initially blurred a durable session identity with a finite terminal run and hid serialization/stale-result risks.
- Suggested improvement: Name session, assignment, run, message, and graph-state boundaries explicitly in every multi-agent architecture scope.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 4–8.

### 2026-07-14T11:18:46-04:00 — ARCH-20260714-03
- What helped: Treating standalone creation as a second entry mode into the same domain runtime exposed reusable session, provenance, and output contracts instead of creating three new generator silos.
- Friction or failure: “Run a sub-agent independently” initially left project ownership, approval, report recipient, shared-session contention, and selection movement underspecified.
- Suggested improvement: For every new agent entrypoint, require an origin/recipient matrix plus explicit queue, cost-gate, output-lineage, and selection semantics before designing routes or UI.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 4–13.

### 2026-07-14T11:25:49-04:00 — WEB-20260714-01
- What helped: Independent review caught the key CSS-module risk before moving keyframes and later caught untracked split files before PR creation.
- Friction or failure: Playwright browser cache revisions were mismatched, so visual smoke needed installed system Chrome instead of the managed binary.
- Suggested improvement: Add a repo script for local web smoke that selects an available browser executable and records the fallback.
- Follow-up: none.
