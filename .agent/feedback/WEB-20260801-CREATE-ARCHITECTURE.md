# Feedback: WEB-20260801-CREATE-ARCHITECTURE

<!-- agent-summary: Task-scoped feedback for aligning the global asset-creation architecture. -->
<!-- agent-summary: Global Create and full-video creation need distinct routes, labels, and active states. -->
<!-- agent-summary: A recent-project surface must define recency instead of trusting API array order. -->
<!-- agent-summary: One dominant CTA means ambient page treatments and shell navigation stay neutral. -->
<!-- agent-summary: Responsive claims require geometry and overflow assertions, not desktop inference. -->
<!-- agent-summary: Loading, empty, missing-media, and populated states need observable browser coverage. -->
<!-- agent-summary: This record ships with worksheet WEB-20260801-CREATE-ARCHITECTURE. -->

## Lesson

Cross-surface creation alignment is an information-architecture change, not just
a route rename. The shell, empty states, next-action copy, navigation semantics,
and responsive workspace all need to agree on what global Create means. New
summary controls such as Recent projects also need explicit ordering and
fallback contracts because upstream array order and poster availability are not
presentation guarantees.

## Follow-up

Keep future full-video entry points explicit about creating a video and directed
to `/projects/new`. When expanding `/create`, preserve one prominent generation
action and extend the browser matrix for any new loading, empty, error, or
responsive state introduced by the change.
