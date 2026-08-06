# Feedback: WEB-20260804-HIERARCHY-PROD-FIX

Related worksheet: [WEB-20260804-HIERARCHY-PROD-FIX](../worksheets/WEB-20260804-HIERARCHY-PROD-FIX.md)

<!-- agent-summary: Empty hierarchy copy must be keyed by root state, not only session count. -->
<!-- agent-summary: Production-shaped fixtures should preserve stale upstream copy to prove UI guards. -->
<!-- agent-summary: Terminal headers, progress, and panel descriptions must agree. -->
<!-- agent-summary: Mobile flex items can shrink while their text still paints into siblings. -->
<!-- agent-summary: Internal scrolling needs document containment and reachable-current-item tests. -->
<!-- agent-summary: Long-label tests must use content long enough to exercise real ellipsis. -->
<!-- agent-summary: Manual desktop/mobile inspection remains necessary after responsive assertions pass. -->

## Lesson

The production regression was broader than the first visible sentence. Three UI
locations treated every empty hierarchy as active planning, and the API's generic
root message still described a canceled run as being guided. Centralizing the
empty-state vocabulary and overriding stale generic copy for empty non-active
roots keeps the status summary, Director header, and panel body consistent.

The breadcrumb bug was a paint-overflow problem rather than document overflow.
The page width assertion already passed because flex items shrank to fit, while a
long linked label continued drawing across later crumbs. Keeping mobile items at
their content width, clipping links, and testing internal scroll width plus the
current crumb's bounds covers the actual failure mode. Because the current crumb
is the last item, the component must also align the row to its end after route or
label changes; a test-side scroll would hide that production responsibility.

## Follow-up

The API projection should eventually emit root-state-aware messages itself so
every client receives truthful copy. Until then, the web guard is deliberately
limited to zero-session non-active states and preserves richer API messages for
active or populated hierarchies.
