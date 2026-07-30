# Feedback: WEB-20260730-IMAGE-PROMPT-QUALITY

<!-- agent-summary: Prompt refinement belongs inside the idempotent proposal operation. -->
<!-- agent-summary: The effective prompt must be visible before generation confirmation. -->
<!-- agent-summary: Original and effective prompts belong in durable proposal provenance. -->
<!-- agent-summary: Stale success and error responses require the same version guard. -->
<!-- agent-summary: Inline-managed mutation errors should suppress duplicate generic toasts. -->
<!-- agent-summary: Fast-model usage remains observable through the shared project cost ledger. -->
<!-- agent-summary: Live quality scoring remains opt-in until spend and thresholds are chosen. -->

## Lesson

A pre-generation model pass belongs inside the same idempotent proposal
operation as the prompt it changes. Returning the effective prompt for explicit
review and retaining both prompt versions in action provenance makes the
quality intervention visible, replay-safe, and auditable.

## Follow-up

Add an opt-in live prompt-quality evaluation over a small fixed weak-prompt
corpus once the team chooses acceptable provider spend and scoring thresholds.
