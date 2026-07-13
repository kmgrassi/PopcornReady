# Agent Workflow

<!-- agent-summary: The required workflow for every repository change. -->
<!-- agent-summary: It routes discovery, implementation, testing, review, documentation, and handoff. -->
<!-- agent-summary: Agents must run the relevant application path, not only static checks. -->
<!-- agent-summary: Record durable work in a committed worksheet and feedback log entry. -->
<!-- agent-summary: Use independent reviewers at the four defined checkpoints when available. -->
<!-- agent-summary: Follow AGENTS.md for task-specific source-of-truth documents. -->
<!-- agent-summary: Run agent:validate before handoff; do not claim checks that did not run. -->

## Required loop

1. Read `AGENTS.md`, this file, and the router-selected documents before editing.
2. Create or continue an `.agent/worksheets/<WORKSHEET_ID>.md` record. Use a stable ID such as `WEB-20260713-01`; name the eventual git tag `worksheet/<WORKSHEET_ID>`.
3. Research the affected code and documentation. Request an independent review at the research and plan checkpoints when another configured agent is available; otherwise record why it was unavailable.
4. Implement in small, reversible increments. Run targeted unit, API, or E2E checks as each behavior becomes testable.
5. Run the application path yourself. UI work requires browser inspection at desktop and mobile widths; API work requires a real local request or the documented smoke harness.
6. Request independent implementation review, resolve findings, then update every source-of-truth document affected by the change.
7. Run `pnpm agent:validate -- --scope <web|api|docs|all>`, complete the worksheet and feedback entry, and request wrap-up review.
8. Commit the implementation, worksheet, and documentation together. Add the worksheet tag after the commit and create a ready-for-review PR.

## Non-negotiable checks

- Do not substitute type-checking for running the relevant app or test path.
- Add or update a targeted test for changed behavior unless the worksheet documents why a test is infeasible and names the manual verification used.
- Treat a test as suspect until it proves an observable result, not only that a mock was called. Follow `docs/agent-system/false-confidence-audits.md`.
- Run `pnpm agent:lint:fix` before final validation. It repairs safe repository-hygiene issues; it never invokes an LLM or changes product code.
- Never let an LLM repair hook silently modify code. A configured external repair command must produce a diff that is reviewed and retested by an agent.

## Continuation protocol

If a session ends early, the next agent starts from the worksheet: read its goal, decisions, changed files, commands, results, blockers, and next action. The worksheet is the handoff record; chat history is supplementary.

## Operating modes

- **Normal:** one bounded task; targeted checks plus the affected app path.
- **Autonomous/night shift:** follow `docs/agent-system/night-shift.md`.
- **Sweep/audit:** follow `docs/agent-system/commit-sweeps.md` and do not make broad speculative edits.
