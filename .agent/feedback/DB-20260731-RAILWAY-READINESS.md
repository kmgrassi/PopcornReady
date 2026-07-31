# Feedback: DB-20260731-RAILWAY-READINESS

<!-- agent-summary: A schema grant and the exact application-readiness contract shipped out of sync. -->
<!-- agent-summary: Railway correctly refused to promote the container when readiness returned 503. -->
<!-- agent-summary: The required semantic snapshot pointer is now explicit in the direct-role allowlist. -->
<!-- agent-summary: Unused stable-identity grants are removed by a forward migration. -->
<!-- agent-summary: Complete-array tests protect exact least privilege rather than checking only inclusion. -->
<!-- agent-summary: Real-role catalog validation must accompany every application-role grant change. -->
<!-- agent-summary: Schema and health contracts should be reviewed and deployed as one compatibility unit. -->

## Lesson

An exact production-readiness audit is itself a deploy-time schema contract.
Changing a least-privilege role grant without changing that contract guarantees
an availability failure even when the migration and application are each
otherwise correct. The audit also exposed that two of the new grants were not
needed by direct application SQL, so the safe repair is a combination of one
allowlist addition and two grant revocations.

## Follow-up

Require every `popcorn_api` grant migration to update complete-array readiness
coverage and pass the real-role integration against the full migration chain
before merge.
