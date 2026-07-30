# Feedback: ORCH-20260730-PR7-CLEANUP

<!-- agent-summary: Record the process lesson from provisional PR 7 cleanup. -->
<!-- agent-summary: Treat behavioral stack dependencies separately from file overlap. -->
<!-- agent-summary: Recheck active parallel branches before every cleanup commit. -->
<!-- agent-summary: Do not delete compatibility routes before their callers move. -->
<!-- agent-summary: Pair health contract cleanup with its owning operations document. -->
<!-- agent-summary: Keep provisional cleanup unpublished until its final stack exists. -->
<!-- agent-summary: Regenerate legacy-reference inventories before final deletion. -->

## Lesson

Parallel cleanup must distinguish textual file overlap from behavioral stack
dependencies. A legacy endpoint can live in a disjoint file and still be unsafe
to delete while another branch is moving its callers.

## Follow-up

Before completing PR 7, regenerate both inventories: changed files on the PR 6
branch and runtime references to restart, revision, flat-profile, registry, and
tool-loop compatibility surfaces.
