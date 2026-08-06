# Feedback: WEB-20260803-ASSET-EDIT-DISCOVERABILITY

Related worksheet: [WEB-20260803-ASSET-EDIT-DISCOVERABILITY](../worksheets/WEB-20260803-ASSET-EDIT-DISCOVERABILITY.md)

<!-- agent-summary: Creator actions need stronger hierarchy than asset utilities. -->
<!-- agent-summary: Use the canonical Request Changes label across entry point and dialog. -->
<!-- agent-summary: Owned non-ready assets should explain why AI editing is unavailable. -->
<!-- agent-summary: Public-library assets remain read-only and should not render empty action chrome. -->
<!-- agent-summary: Disabled-state guidance must be visibly adjacent and programmatically connected. -->
<!-- agent-summary: Mobile geometry checks must also detect visual overlap, not only DOM visibility. -->
<!-- agent-summary: A constrained media track needs definite height and compact short-view audio. -->

## Lesson

The AI feedback workflow was present and functional, but the asset viewer made
it look like a low-priority utility: a small ghost control shared one footer row
with project, anchor, and visibility actions. Promoting the existing workflow to
the single gold **Request changes** action fixed discoverability without adding
a competing edit concept or changing the reviewed proposal lifecycle.

Silent status gating made processing assets look as though editing did not
exist. Keeping the action visible but disabled for owned assets, with concise
status-specific guidance connected by `aria-describedby`, communicates both the
capability and when it becomes usable. Public assets stay read-only and omit the
footer entirely when they have no actions.

DOM visibility and bounding-box containment were not sufficient responsive
checks. In the first portrait browser pass the button had a valid rectangle but
the oversized media element painted above it. Constraining media to the viewer's
grid track and asserting that the button is the topmost element at its center
turned that visual regression into deterministic coverage. Short landscape
viewports also need a compact stage and horizontal action grouping so the main
action remains visible without scrolling.

Constraining visual media to `height: 100%` solves footer overlap only when the
grid has a definite available height. Leaving the dialog at `max-height` alone
let absolutely positioned image content collapse the shared stage to its
minimum on ordinary desktop viewers. The dialog now takes a definite height
from the overlay's safe-area-aware padded content box, preserving a large image
inspection surface without letting media escape its track. Audio needs a
different short-height adaptation: a compact horizontal glyph-and-controls row
keeps native playback controls reachable inside the clipped stage.

## Follow-up

If more primary asset workflows are added, keep Request Changes as the single
creator CTA and place unrelated mutations in the utility group. Consider a
shared responsive viewer-action layout only when a second route needs the same
hierarchy; the current route-local module avoids premature coupling.
