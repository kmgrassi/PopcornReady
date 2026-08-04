# Feedback: WEBAPI-20260804-STUDIO-RUN-CONFIG

<!-- agent-summary: Task feedback for removing retired client run-config knobs. -->
<!-- agent-summary: When server policy takes ownership of a behavior, delete the client knob in the same effort. -->
<!-- agent-summary: Silent no-op fields mislead QA docs, future agents, and draft persistence. -->
<!-- agent-summary: Read-side tolerance (drop, not reject) is the right shape for retiring persisted fields. -->
<!-- agent-summary: Audit same-named fields on other contracts before deleting; export captions stayed live. -->
<!-- agent-summary: Manual-test documents are part of the contract and must move in the same change. -->
<!-- agent-summary: This feedback ships with worksheet WEBAPI-20260804-STUDIO-RUN-CONFIG. -->

## Lesson

When the server takes ownership of a behavior — here `initialRunStopAfterTools`
making the storyboard gate mandatory and ignoring client review-gate payloads —
the client knobs it replaced must be deleted in the same effort, not left as
accepted-and-ignored fields. The retired `seedAsset`, wizard captions, and
`reviewGates` state survived long enough to be persisted in drafts, typed in
the shared wire contract, validated by the API, and prescribed by manual-test
documentation as the way to exercise checkpoints. Every one of those surfaces
was silently wrong, and QA following the documented `reviewGates` deep link
would have believed they tested a checkpoint that the parameter no longer
creates.

Retiring persisted fields wants read-side tolerance with write-side removal:
old drafts and payloads must keep parsing (fields dropped, never rejected) so
users do not lose work, while new writes stop emitting the fields entirely.

Field names are not unique across contracts. `showCaptions` appears on both
the retired run-start payload and the live timeline-export input; only the
run-start one was dead. Grepping by name alone would have deleted a working
feature — trace each occurrence to the endpoint that consumes it before
removing.

## Follow-up

- When a migration or policy change strips a client-controlled option, update
  `docs/manual-tests/*` in the same commit; those documents are executable
  instructions for QA, not commentary.
- If a checkpoint picker ever returns as a product feature, it must be
  server-negotiated (the client requests, the server owns the boundary), not a
  revival of the `reviewGates` pass-through.
- Apply the same trace-to-consumer audit before deleting any other
  long-carried draft field; the draft store and shared wire types accumulate
  fields faster than the server contract retires them.
