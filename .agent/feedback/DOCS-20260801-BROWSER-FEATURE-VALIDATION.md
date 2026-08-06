# Feedback: DOCS-20260801-BROWSER-FEATURE-VALIDATION

<!-- agent-summary: Clarify browser testing as changed-feature exercise, not generic inspection. -->
<!-- agent-summary: Name actual entry points and observable results in validation evidence. -->
<!-- agent-summary: Treat automated browser coverage as complementary evidence. -->
<!-- agent-summary: Record routes, states, viewports, and outcomes in worksheets. -->
<!-- agent-summary: Block complete handoff when live-browser validation cannot run. -->
<!-- agent-summary: Require explicit user acceptance for a documented exception. -->
<!-- agent-summary: Review future worksheets for evidence tied to the changed feature. -->

Worksheet: [DOCS-20260801-BROWSER-FEATURE-VALIDATION](../worksheets/DOCS-20260801-BROWSER-FEATURE-VALIDATION.md)

## Lesson

A general instruction to inspect the browser can still leave ambiguity about
whether an agent must exercise the feature it changed. Naming the changed
feature's actual browser entry point, required viewport classes, and the
relationship between manual inspection and automation makes the handoff
expectation auditable.

## Follow-up

Watch future worksheets for explicit browser evidence tied to the changed
feature and its actual entry point, not only a Playwright command or a generic
route smoke result.
