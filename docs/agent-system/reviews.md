# Independent Agent Reviews

<!-- agent-summary: Major work receives independent review at research, plan, implementation, and wrap-up. -->
<!-- agent-summary: The reviewer must use a different model or provider from the implementing agent when available. -->
<!-- agent-summary: Reviews are recorded in the worksheet with findings, disposition, and unavailable-provider reasons. -->
<!-- agent-summary: Personas focus review attention but do not replace targeted technical checks. -->
<!-- agent-summary: Review output must name concrete files, risks, and verification gaps. -->
<!-- agent-summary: Code-review comments attribute generated code with @Codex or @CLAUDE. -->
<!-- agent-summary: The agent-review script is an adapter for a user-configured external reviewer command. -->

## Checkpoints

| Checkpoint | Reviewer asks |
| --- | --- |
| Research | Are the source-of-truth docs, constraints, and problem framing correct? |
| Plan | Is the scope minimal, reversible, and adequately testable? |
| Implementation | Are correctness, security, performance, accessibility, and maintainability risks handled? |
| Wrap-up | Do validation evidence, docs, worksheet, and PR tell the truth? For browser-facing work, does the worksheet confirm the locally running web app and identify the changed feature's actual browser entry point, exercised states, viewports, and observed results, with any exception explicitly accepted by the user? |

## Personas and document ownership

| Persona | Focus | Owns |
| --- | --- | --- |
| Maintainer | boundaries, duplication, documentation | documentation contract, commit sweeps |
| Test skeptic | false positives, assertions, fixtures | testing policy, false-confidence audits |
| Security/data steward | auth, RLS, secrets, tenancy | Supabase identity and auth scopes |
| Performance engineer | latency, rendering, payloads | performance and visual-regression policy |
| Product/UI critic | flows, accessibility, responsive quality | UI interaction model and design docs |
| Domain specialist | task-specific correctness | relevant domain scope document |

Run `pnpm agent:review -- <checkpoint> <worksheet-id>` after setting `AGENT_REVIEW_COMMAND`. The command receives `AGENT_REVIEW_PHASE` and `AGENT_WORKSHEET_ID`; it must write review output to stdout for the worksheet.
