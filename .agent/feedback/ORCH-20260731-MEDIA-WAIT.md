# Feedback: ORCH-20260731-MEDIA-WAIT

<!-- agent-summary: Task feedback for the finite-run media wait repair. -->
<!-- agent-summary: A permissive fake allowed a production-invalid database transition to pass. -->
<!-- agent-summary: Runtime-state tests should model database invariants at the persistence seam. -->
<!-- agent-summary: Explicit semantic wait reasons prevent role-dependent null ambiguity. -->
<!-- agent-summary: Durable projections should prefer persisted reasons over action-shape inference. -->
<!-- agent-summary: The repair required no migration because the database contract was already correct. -->
<!-- agent-summary: This feedback ships with worksheet ORCH-20260731-MEDIA-WAIT. -->

## Lesson

The unit store accepted `waiting` without applying the production constraint, so the shared engine passed tests while every finite provider job failed in PostgreSQL. Persistence fakes for constrained lifecycle state should validate the same cross-field invariant and apply updates transactionally before mutating their fixture.

## Follow-up

When adding a new waiting state, require an explicit semantic reason at the engine boundary and add both finite-run and root-compatibility assertions. Prefer persisted reasons in projections, retaining inference only for readable historical rows.
