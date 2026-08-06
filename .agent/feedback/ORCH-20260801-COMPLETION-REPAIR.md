# Feedback: ORCH-20260801-COMPLETION-REPAIR

<!-- agent-summary: Task feedback for finite-domain terminal completion repair. -->
<!-- agent-summary: Successful media work must remain separate from malformed terminal-report transport. -->
<!-- agent-summary: Semantic correction needs a dedicated no-tools boundary. -->
<!-- agent-summary: Trusted criteria and ready run-owned outputs constrain repair. -->
<!-- agent-summary: The normal parser remains the sole authority after correction. -->
<!-- agent-summary: Output-state and persistence failures are not model-repairable. -->
<!-- agent-summary: This feedback ships with worksheet ORCH-20260801-COMPLETION-REPAIR. -->

## Lesson

A finite-domain run can finish its expensive primitive work and still fail on a
cheap terminal response. Treating both failures as one terminal condition
strands a valid asset and encourages an unnecessary media retry. Terminal-shape
correction should therefore be isolated from the tool loop and constrained by
server-owned evidence: task criteria, required bindings, and ready outputs
already created by the run.

Correction is not authority. The existing report parser, graph ownership checks,
and output-state validation remain the final gate. Database faults, missing or
failed assets, and unauthorized output claims must never be rewritten by a model.

Graph kinds alone are also not sufficient completion evidence. Several product
roles share the `image` graph kind, so semantic coverage must derive from the
persisted asset role and allocate each asset to at most one required slot. Keep
inventory authorization separate from completeness: question correction may
inspect a valid partial inventory, while `done` still enforces every distinct
semantic-role and `minimumCount` requirement.

## Follow-up

- If completion correction must be exactly once across worker crashes, persist a
  correction-attempt fence instead of relying on the current per-drive bound.
- Monitor correction-started, succeeded, exhausted, provider-failed, and timeout
  events to decide whether prompt or provider tuning is warranted.
