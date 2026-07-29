# Agent feedback record

<!-- agent-summary: This record captures a reusable lesson from the PR caretaker sweep. -->
<!-- agent-summary: It links the lesson to the durable caretaker worksheet. -->
<!-- agent-summary: It contains no secrets, private prompts, or customer data. -->
<!-- agent-summary: The lesson is based on observed repository workflow friction. -->
<!-- agent-summary: Follow-up actions remain concise and verifiable. -->
<!-- agent-summary: Future caretaker runs should inspect thread state before acting. -->
<!-- agent-summary: Keep this record committed with the worksheet and implementation. -->

# Feedback: PR-CARETAKER-20260716-01

## Lesson

Thread-aware review and reaction inspection distinguished PRs that were merely blocked by required review from the one needing a branch change. Isolating the conflicted PR in a worktree protected unrelated local files.

## Follow-up

After pushing a conflict-resolution merge, re-check mergeability, required checks, and review state before considering any merge.
