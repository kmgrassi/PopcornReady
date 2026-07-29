# Feedback: WEB-20260729-CHOICE-CARD-PADDING

<!-- agent-summary: Task-scoped feedback for the Asset Studio choice-card padding fix. -->
<!-- agent-summary: Shared component roots can be native form labels. -->
<!-- agent-summary: Broad descendant selectors can override CSS Module styles by specificity. -->
<!-- agent-summary: Direct-child selectors keep page fields separate from nested components. -->
<!-- agent-summary: Token-aware browser assertions protect spacing without hard-coded values. -->
<!-- agent-summary: Desktop and mobile checks cover the responsive card layouts. -->
<!-- agent-summary: This record accompanies worksheet WEB-20260729-CHOICE-CARD-PADDING. -->

## Lesson

Route-level selectors for native form elements should target the form's direct
fields; broad descendant selectors can silently override component-scoped
interactive-card styles through higher specificity.

## Follow-up

Prefer explicit field classes or direct-child selectors when a form contains
reusable components whose root element is a native `label`.
