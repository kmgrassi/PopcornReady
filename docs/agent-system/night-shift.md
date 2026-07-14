# Autonomous Night Shift

<!-- agent-summary: Night shift is bounded autonomous maintenance, not permission for broad unreviewed change. -->
<!-- agent-summary: It selects small queued tasks with clear acceptance criteria and no external coordination need. -->
<!-- agent-summary: Each task follows AGENT_WORKFLOW.md, including tests, app execution, worksheet, and review. -->
<!-- agent-summary: Stop for unclear product choices, production changes, secrets, destructive migrations, or repeated failures. -->
<!-- agent-summary: Finish with full validation for the changed scope and an open review-ready PR. -->
<!-- agent-summary: Leave a resumable worksheet when time or budget ends. -->
<!-- agent-summary: Delivery lead owns orchestration limits and escalation. -->

1. Choose the highest-priority unblocked item in `TODOS.md`.
2. Confirm ownership, acceptance criteria, and relevant router documents.
3. Implement one task only; do not bundle opportunistic refactors.
4. Run targeted checks, app validation, independent review, and final validation.
5. Commit, tag the worksheet, update feedback, and open a review-ready PR.
