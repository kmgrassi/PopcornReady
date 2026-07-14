# Agent Feedback Log

<!-- agent-summary: Append one concise entry after every completed durable agent task. -->
<!-- agent-summary: Entries capture workflow friction and improvements, not a duplicate task narrative. -->
<!-- agent-summary: Commit entries with their implementation and worksheet. -->
<!-- agent-summary: Review this log interactively at least monthly. -->
<!-- agent-summary: Turn repeated problems into a scoped task in TODOS.md. -->
<!-- agent-summary: Do not include secrets, private prompts, or customer data. -->
<!-- agent-summary: Delivery lead owns periodic synthesis. -->

## Template

```md
### YYYY-MM-DD — <WORKSHEET_ID>
- What helped:
- Friction or failure:
- Suggested improvement:
- Follow-up: <TODO / PR / none>
```

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

### 2026-07-14 — ARCH-20260714-01
- What helped: The new task router, isolated worktree, existing durability research, and independent checkpoints made the architecture dependencies explicit.
- Friction or failure: Tool ownership and counts are duplicated across types, prompts, documentation, and UI projections, making the current surface easy to misstate.
- Suggested improvement: Establish one canonical capability catalog and derive specialist registries, labels, gates, and detailed documentation from it.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 1–2.

### 2026-07-14 — ARCH-20260714-02
- What helped: Comparing the proposal to the concrete `driveLoop` injection seams separated reusable runtime mechanics from agent-role configuration.
- Friction or failure: “Persistent child agent” initially blurred a durable session identity with a finite terminal run and hid serialization/stale-result risks.
- Suggested improvement: Name session, assignment, run, message, and graph-state boundaries explicitly in every multi-agent architecture scope.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 4–8.
