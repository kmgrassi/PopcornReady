# Agent feedback records

<!-- agent-summary: Each completed durable task owns one feedback record in this directory. -->
<!-- agent-summary: Name the record after its worksheet id: <WORKSHEET_ID>.md. -->
<!-- agent-summary: Do not append routine task feedback to a shared log file. -->
<!-- agent-summary: Task-scoped records avoid merge conflicts across parallel pull requests. -->
<!-- agent-summary: Keep entries concise, factual, and free of secrets or customer data. -->
<!-- agent-summary: Link the worksheet and describe the reusable process lesson. -->
<!-- agent-summary: Periodic review may summarize records elsewhere, but is not part of delivery work. -->

Create one Markdown file for each completed durable task. The record belongs in
the same commit as its worksheet and implementation. A historical shared log may
remain as a read-only archive, or be deleted after every entry has been migrated
to task-scoped records. Do not edit a shared log for routine task feedback.

## Record format

```md
# Feedback: <WORKSHEET_ID>

## Lesson

## Follow-up
```
