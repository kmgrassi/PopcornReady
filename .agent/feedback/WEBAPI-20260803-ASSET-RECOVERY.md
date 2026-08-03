# Feedback: WEBAPI-20260803-ASSET-RECOVERY

<!-- agent-summary: Task feedback for creator-direct completion and output recovery. -->
<!-- agent-summary: Detailed creative prompts are not suitable completion-evidence criteria. -->
<!-- agent-summary: A failed terminal report does not invalidate an already persisted ready asset. -->
<!-- agent-summary: Recovery must remain exact-run, project-scoped, semantic, and ready-only. -->
<!-- agent-summary: Asset readiness and run success must be presented as separate facts. -->
<!-- agent-summary: Active runs continue polling after an output preview becomes available. -->
<!-- agent-summary: This feedback ships with worksheet WEBAPI-20260803-ASSET-RECOVERY. -->

## Lesson

A creator prompt can legitimately use the product's full 4,000-character limit,
but a domain completion criterion is a bounded audit check. Copying the prompt
into both fields coupled successful media generation to a later 500-character
report validator. Server-authored, task-kind-specific criteria preserve the
creative instruction while keeping terminal evidence stable and reviewable.

The immutable graph may already contain a valid output when terminal report
bookkeeping fails. Status recovery should therefore validate exact-run applied
actions independently, hydrate only ready assets through the request's
workspace/project boundary, and keep any failed runtime state intact. The UI
can truthfully say “the asset was saved” without claiming the run succeeded.

Once status exposes the asset's media URL, it also owns the signed-credential
contract. The JSON must remain private and no-store, and terminal run polling
cannot be the URL-renewal mechanism. Carry the real nullable expiry into the
shared auth/workspace/asset-scoped media query so credential refresh remains
independent of orchestration state.

## Follow-up

- Keep detailed prompt content out of future acceptance-criterion fields; add a
  bounded server-owned criterion when introducing each creator-direct task kind.
- Preserve report-first ordering if multi-output creator flows expand, and add
  explicit output selection UX rather than silently changing the primary asset.
- Continue testing terminal failure both with and without a persisted output so
  generic failure handling never hides usable media or invents one.
- Reuse the focused media query whenever another status or activity surface
  begins rendering signed asset URLs; do not add surface-specific refresh timers.
