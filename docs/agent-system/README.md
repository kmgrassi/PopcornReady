# Agent System

<!-- agent-summary: This directory owns repository-wide agent operating procedures. -->
<!-- agent-summary: AGENT_WORKFLOW.md is the mandatory execution loop; AGENTS.md routes task context. -->
<!-- agent-summary: Each document names an owner persona and must be updated with related behavior changes. -->
<!-- agent-summary: Worksheets and feedback logs make autonomous work resumable and improvable. -->
<!-- agent-summary: Scripts provide local checks and adapters, never hidden model-driven code changes. -->
<!-- agent-summary: This system complements product docs; it does not replace their source-of-truth role. -->
<!-- agent-summary: Start here only for agent-process work; otherwise use the router in AGENTS.md. -->

| Document | Purpose | Owner |
| --- | --- | --- |
| `documentation-contract.md` | Self-healing docs and summaries | Maintainer |
| `reviews.md` | Independent reviews and personas | Review lead |
| `worksheets-and-feedback.md` | Traces, tags, handoffs, feedback | Delivery lead |
| `night-shift.md` | Autonomous orchestration limits | Delivery lead |
| `testing-policy.md` | Test creation and inventory | Test skeptic |
| `false-confidence-audits.md` | Tests that do not prove behavior | Test skeptic |
| `performance-and-visual-regression.md` | Baselines, profiling, visual checks | Performance engineer |
| `commit-sweeps.md` | Higher-level review across commits | Maintainer |

## Active implementation proposals

- [Production Browser Testing for Agents](../scopes/production-browser-agent-testing.md)
  scopes deployed release identity, remote browser smoke, isolated production
  mutations, cleanup, provider budgets, and agent-run evidence. It is a proposal,
  not live production-testing authority.
