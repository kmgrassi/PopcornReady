# Feedback: WEB-20260802-QUICK-LOADING

Related worksheet: [WEB-20260802-QUICK-LOADING](../worksheets/WEB-20260802-QUICK-LOADING.md)

<!-- agent-summary: Loading indicators should communicate semantic work, not API duration guesses. -->
<!-- agent-summary: The studio crew belongs to known creative production states. -->
<!-- agent-summary: Quick route fetches benefit from a short reveal threshold that never delays content. -->
<!-- agent-summary: Content-shaped reservations are calmer and preserve final layout geometry. -->
<!-- agent-summary: Compact fallbacks still need route-appropriate height to prevent layout shift. -->
<!-- agent-summary: One accessible status should own each loading state while visual geometry stays hidden. -->
<!-- agent-summary: Fast-path tests should avoid unresolved gates and wall-clock races. -->

## Lesson

The awkward flash came from assigning narrative production artwork to every initial query. A durable boundary is semantic: known creative work can carry the studio scene, while ordinary navigation and data fetches use a delayed, purpose-sized state even when an API call happens to be slow.

Existing skeleton markup was useful infrastructure once it became the visible state instead of an invisible reservation. The Watch review also showed that a “compact” indicator must not imply compact layout; its reservation should still match the eventual media frame.

## Follow-up

New route loaders should use `QuickLoadingState` and supply content-shaped geometry where practical. Tests for fast paths should use immediate fixtures, while delayed fixtures cover the reveal branch. Keep `StudioCrewLoader` tied to the creation-production presentation rather than generic server-state hooks.

An anti-flash assertion must record state throughout navigation, not only inspect the settled DOM. Install the observer before navigation, inspect mutation-added nodes directly so fast add/remove cycles cannot disappear before callback delivery, and prove the observer with a delayed-loader positive control.
