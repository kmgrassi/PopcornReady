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

### 2026-07-13 — API-20260713-01
- What helped: Durable action history and Railway deployment context made the no-op completion reproducible without rerunning customer work.
- Friction or failure: A feedback action was allowed to complete a run without a downstream output; direct image regeneration needed explicit run-credit accounting.
- Suggested improvement: Add route-level integration coverage for terminal image-tile revisions with mocked generation and credit dependencies.

### 2026-07-13 — AGENT-OPS-001
- What helped: The review surfaced two concrete command-line correctness gaps that were easy to reproduce with small shell smokes.
- Friction or failure: `pnpm --` forwarding and partially staged markdown made the first tooling cut validate the wrong content.
- Suggested improvement: Add a lightweight script-level regression harness for agent tooling so review-fix cases do not rely on ad hoc shell probes.
- Follow-up: none.
