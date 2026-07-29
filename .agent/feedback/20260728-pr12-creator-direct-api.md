# PR 12 creator-direct API feedback

<!-- agent-summary: Feedback for the PR 12 creator-direct API implementation. -->
<!-- agent-summary: The route reuses durable domain sessions and finite runs. -->
<!-- agent-summary: Proposal confirmation remains a one-use gate transition. -->
<!-- agent-summary: Product request kinds are server-mapped to trusted domains. -->
<!-- agent-summary: Project and actor scope are checked at the protected route. -->
<!-- agent-summary: Follow-up and selection changes require dedicated durable transitions. -->
<!-- agent-summary: This entry records validation and review constraints for handoff. -->

The API route intentionally reuses the existing domain-run transport and proposal-gate RPCs. Follow-up, blocked dependency attachment, and selection movement need their dedicated server transitions before they are exposed; they must not be improvised as route-local writes.
