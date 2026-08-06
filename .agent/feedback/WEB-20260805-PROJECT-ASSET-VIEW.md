# Feedback: WEB-20260805-PROJECT-ASSET-VIEW

<!-- agent-summary: A failed parent run can still own a valid succeeded media item. -->
<!-- agent-summary: Run stage items identify the exact saved asset without guessing from a broad collection. -->
<!-- agent-summary: Active full-video work and prior standalone asset results need separate selection rules. -->
<!-- agent-summary: Canonical Library deep links preserve signed-media refresh and viewer behavior. -->
<!-- agent-summary: Mobile next-step precedence should put playable results ahead of unrelated storyboard recovery. -->
<!-- agent-summary: Mixed-run fixtures catch discoverability bugs that single-run fixtures miss. -->
<!-- agent-summary: Desktop and mobile manual checks remain necessary alongside Playwright coverage. -->

Related worksheet: [WEB-20260805-PROJECT-ASSET-VIEW](../worksheets/WEB-20260805-PROJECT-ASSET-VIEW.md)

## Lesson

A project's current production run is not always the run that owns its latest
standalone result. Selecting those independently keeps a succeeded media item
visible when its parent later fails and when newer full-video work starts. The
stage item is the safe identity boundary: it names the exact asset, while the
canonical Library viewer owns URL refresh, playback, billing, and Request Changes.

Browser fixtures can conceal a production projection gap when they hand-author
optional fields that the real summary endpoint drops. Any UI filter that depends
on a run discriminator needs an assertion at the API summary boundary, not only
an E2E response fixture. Loading and error states also need lower precedence than
real workflow actions: failed historical enrichment must not hide current review.

## Follow-up

If project overviews eventually need complete asset history rather than the most
recent standalone run represented in the recent-run window, add a purpose-built,
ordered project-result projection instead of inferring from the unordered asset
collection.
