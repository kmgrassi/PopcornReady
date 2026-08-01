# Feedback: WEB-20260801-AUTO-PROJECT

<!-- agent-summary: Task-scoped feedback for automatic project creation from global Create. -->
<!-- agent-summary: Optional context should not become a blocking required setup step. -->
<!-- agent-summary: Reuse server-owned AI naming instead of duplicating title heuristics in the browser. -->
<!-- agent-summary: Request-only naming inputs avoid persisting an asset prompt as project metadata. -->
<!-- agent-summary: Async create-and-continue flows must navigate with returned IDs, not pending React state. -->
<!-- agent-summary: Async continuations must stop after their owning route unmounts. -->
<!-- agent-summary: This record ships with worksheet WEB-20260801-AUTO-PROJECT. -->

## Lesson

An optional organizer should not block a creator's primary action. When the
system can create that context safely, creation belongs inside the action the
creator already intended to take. Existing server-owned naming behavior is a
better boundary than a browser-side random generator because it keeps fallback,
normalization, and future model changes consistent across entry points.

## Follow-up

Keep request-only naming context bounded, make the implicit step visible through
loading and inline errors, and cover duplicate clicks and stale-state navigation
whenever another create-and-continue interaction is added.

## PR review follow-up

Review exposed two lifecycle edges that happy-path locking did not cover. A
disabled popover trigger does not disable an already-mounted panel, so the panel
must be removed from the interaction tree and its local state closed. Likewise,
an async mutation belongs to the route that started it: after that route
unmounts, completion may update caches but must not navigate or set local state.
