# Feedback: ORCH-20260730-PR7B-SCHEMA-RETIREMENT

<!-- agent-summary: Record the deployment lesson from destructive profile retirement. -->
<!-- agent-summary: A removed discriminator requires structural retirement before its drop. -->
<!-- agent-summary: Audit every terminal-to-active route, not only normal worker recovery. -->
<!-- agent-summary: Preserve a mixed-schema application window in a separate earlier deployment. -->
<!-- agent-summary: Classify under lock and assert cleanup before removing the old database fence. -->
<!-- agent-summary: Pair destructive replay with a seeded upgrade test and positive controls. -->
<!-- agent-summary: Never use CASCADE to hide an incomplete dependency inventory. -->

## Lesson

Dropping a routing discriminator is safe only when historical rows cannot become
eligible for current role-only code. Terminal state alone was insufficient:
storyboard approval intentionally reopens a succeeded run, and credit retry
intentionally reopens a failed run based on either run or action error.

PR 7B therefore classifies legacy roots while the profile still exists, rejects
their unresolved gates, supersedes their retryable terminal states, and makes
supersession irreversible in the existing database immutable guard before
dropping the discriminator.

## Follow-up

For future destructive schema retirements, require:

1. a prior application-only deploy that stops naming the schema;
2. a locked upgrade migration that preserves the old discriminator through
   cleanup assertions;
3. positive-control fixtures proving current rows retain intended behavior; and
4. a drop without `CASCADE`, followed by catalog and application readiness
   checks.
