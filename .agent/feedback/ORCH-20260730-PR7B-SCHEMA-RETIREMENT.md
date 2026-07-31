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

When a destructive retirement PR conflicts with its required preparatory base,
the merged documentation must preserve both phases of the rollout. In this
case, PR 7A's continuation fencing is still historical evidence for why the
profile can be dropped; PR 7B's final state must not erase that evidence or
describe the temporary trigger as still live.

Database migration runners do not guarantee an implicit transaction around a
multi-statement file. Any migration that uses `LOCK TABLE` or transaction-scoped
temporary tables must declare its transaction boundary explicitly and test that
the lock and final assertions remain inside it.

Upgrade harnesses should distinguish internal durable state from compatibility
API projections. Assert destructive structural markers directly in SQL, then
assert the public status vocabulary separately when it intentionally collapses
new internal states for older clients.

For a final destructive layer, reconstruct from the resolved preparatory branch
and apply the reviewed merge delta relative to that preparatory parent. This
keeps the schema drop auditable as one bounded change and avoids re-resolving
the non-destructive rollout bridge through duplicate stacked histories.
