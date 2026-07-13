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
