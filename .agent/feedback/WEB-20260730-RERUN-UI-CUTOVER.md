# Feedback: WEB-20260730-RERUN-UI-CUTOVER

<!-- agent-summary: Task-scoped feedback for the durable Request Changes UI cutover. -->
<!-- agent-summary: A mutation response alone cannot recover proposal state after reload. -->
<!-- agent-summary: Proposal identities should be persisted per project and semantic target. -->
<!-- agent-summary: Server state belongs in TanStack Query, while draft copy remains local. -->
<!-- agent-summary: Provider and model selection is not creator authority in the new lifecycle. -->
<!-- agent-summary: Clarification, staleness, cancellation, and failure are first-class UI states. -->
<!-- agent-summary: This record accompanies worksheet WEB-20260730-RERUN-UI-CUTOVER. -->

## Lesson

The UI cutover is not complete when callers merely post to the new create
endpoint. The lifecycle needs a durable read model so a refresh can recover the
same approval, execution, and terminal state without silently creating another
proposal.

## Follow-up

Keep target conversion and lifecycle query keys centralized so later legacy
route deletion cannot leave one surface on a divergent mutation path.

Review also showed that UI cutover tests must replace—not merely supplement—
legacy expectations. A browser test waiting for `/reject` or
`/board-revisions` makes the retired behavior part of the contract and can hide
a missed caller even when the new dialog has dedicated coverage.

An object label is not an object identity. A review checkpoint or “whole cut”
control must resolve to a stable document, storyboard, asset, beat, or timeline
asset before proposal creation. If that identity is unavailable, disabling the
affordance with a route to the exact object is safer than silently widening the
request to project scope.

Terminal lifecycle state has two distinct sources of truth: the proposal action
owns proposal status, while the linked execution-result action owns execution
failure provenance. Creator-facing reads must follow that link, translate
durable error kinds into approved copy instead of exposing raw provider details,
and suppress failure copy when the execution was canceled.

Cancellation is not merely a successful mutation response. Persist it on the
execution reservation and return the actual durable result when completion or
failure wins the cancellation race. Likewise, settlement callbacks must be
scoped to the proposal action so a restored execution cannot refresh a prior
object selected in the same mounted dialog.
