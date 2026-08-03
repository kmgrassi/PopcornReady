# Feedback: WEB-20260803-CREATION-PROGRESS

<!-- agent-summary: Task feedback for the prominent creator-direct loading experience. -->
<!-- agent-summary: Development previews should consume production components without owning production routes. -->
<!-- agent-summary: Preview fixtures and copy stay inside development-only modules. -->
<!-- agent-summary: Production builds must omit deterministic preview fixture content. -->
<!-- agent-summary: Transformed sprites need containment coverage at breakpoint edges. -->
<!-- agent-summary: Loading reservations should share the live component's responsive geometry. -->
<!-- agent-summary: This record ships with worksheet WEB-20260803-CREATION-PROGRESS. -->

## Lesson

A deterministic UI preview stays trustworthy when it imports the same production
component but owns all fixture copy and page composition inside the development
route. Keeping preview-only exports out of a large production route also prevents
sample content from leaking into the production bundle.

Responsive sprite scaling needs a containment check at the breakpoint edge, not
only at canonical desktop and phone widths; transformed bounds can clip just
above an otherwise-correct mobile breakpoint.

## Follow-up

Use `/dev/creation-progress` for future loading-state visual review, and keep its
fixture text dev-owned while evolving `CreationProgressExperience` through the
live creator-direct route.
