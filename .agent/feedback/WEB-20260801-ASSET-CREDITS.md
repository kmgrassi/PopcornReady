# Feedback: WEB-20260801-ASSET-CREDITS

<!-- agent-summary: Task-scoped feedback for per-asset charged-credit visibility. -->
<!-- agent-summary: User-facing cost must come from immutable credit debits, not provider estimates. -->
<!-- agent-summary: Multi-output generation cannot be split honestly without first-class allocation data. -->
<!-- agent-summary: Detail-only billing avoids list-endpoint N+1 queries and limits sensitive data exposure. -->
<!-- agent-summary: Public surfaces must suppress both owner-only requests and cached owner-only values. -->
<!-- agent-summary: Nested and outer settlement need an explicit ownership fence to prevent double charging. -->
<!-- agent-summary: This record ships with worksheet WEB-20260801-ASSET-CREDITS. -->

## Lesson

Asset cost is a ledger fact, not a provider-cost estimate. The safe display
contract is nullable: sum the gross negative generation debits only when one
action produced exactly one asset, and omit the value when the historical
record cannot support an honest allocation.

Privacy also has two layers in a query-cached UI. Disabling the owner-only
request on public surfaces is necessary, but rendering must independently gate
cached data because the same selected identifiers can survive a scope change.

## Follow-up

If multi-output generation should show per-asset cost later, add an explicit
durable allocation model at settlement time. Do not divide an action-level
debit evenly after the fact.

Keep nested durable operation settlement and outer tool settlement separated by
an explicit handled-cost tally; merely relying on idempotency keys does not
prevent two different settlement layers from charging the same provider call.
