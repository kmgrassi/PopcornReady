# Documentation Contract

<!-- agent-summary: Documentation is a maintained product interface, not a historical diary. -->
<!-- agent-summary: Update the authoritative system document whenever its behavior or ownership changes. -->
<!-- agent-summary: New or substantially rewritten system docs carry seven agent-summary lines below the title. -->
<!-- agent-summary: Summaries state scope, owner, source of truth, commands, and important constraints. -->
<!-- agent-summary: Use rg on headings and agent-summary text to discover documentation quickly. -->
<!-- agent-summary: Keep the E2E inventory current whenever browser coverage changes. -->
<!-- agent-summary: Record stale or conflicting documentation as a worksheet blocker, then repair it. -->

## Rules

- Link to the canonical document instead of duplicating rules in a new scope note.
- Put commands beside prerequisites and expected results.
- Label proposals and historical audits clearly; they are not live policy.
- When a document is replaced, add a short redirect until router references move.
- `pnpm agent:lint` checks the summary convention for new agent-system docs.
