# Database access boundary

<!-- agent-summary: User-scoped API access stays on Supabase so Postgres RLS evaluates the session. -->
<!-- agent-summary: Trusted multi-table server workflows migrate from RPCs to TypeScript transactions. -->
<!-- agent-summary: New application workflow RPC targets are prohibited by a checked allowlist. -->
<!-- agent-summary: Triggers, RLS helpers, integrity functions, and database-native search may remain in Postgres. -->
<!-- agent-summary: Direct Postgres connections bypass user RLS and require explicit tenancy enforcement. -->
<!-- agent-summary: DATABASE_URL is optional until a direct transaction is invoked. -->
<!-- agent-summary: Migrate one service-role workflow family per PR after a least-privilege role exists. -->

This document owns the boundary between Supabase's Data API and direct
Postgres access in the Express API. The goal is not to remove Postgres
functions. It is to stop putting application orchestration into an RPC surface
that is hard to type, test, observe, and evolve.

## The boundary

| Work | Access path | Why |
| --- | --- | --- |
| Signed-in, user-scoped reads and writes | Request-scoped Supabase client | Preserves JWT-derived RLS and the `auth.uid()` to app-user mapping. |
| Ordinary trusted single-table operations | Existing service Supabase client | The current server already enforces tenancy; migrate only when a transaction or lower-level feature is needed. |
| Trusted multi-table application workflow | Direct Postgres transaction in TypeScript | Keeps orchestration typed and reviewable while guaranteeing one transaction. |
| RLS helpers, triggers, constraints, integrity checks | Postgres functions | These belong next to the data and must execute inside the database. |
| Database-native search/ranking or set-returning projections | Postgres function or reviewed SQL module | Keep where PostgreSQL is materially better, with an explicit boundary exception. |

No new application workflow RPC target may be added under `apps/api/src`
without updating `scripts/validate-api-rpc-boundary.mjs` and this document in
the same reviewed PR. Dynamic RPC target names, dynamic element-access calls
that could conceal an RPC, and NUL-containing TypeScript sources fail
validation. `pnpm agent:validate -- --scope api` runs the boundary test and
validator.

## Current inventory (2026-07-29)

- Production database catalog, `public` schema: **100 functions**.
- Trigger-backed functions: **34**.
- Non-trigger functions: **66**.
- `SECURITY DEFINER` functions: **78**.
- Active API production runtime: **48 `.rpc()` expressions targeting 49
  distinct functions**.
- Internal test-sandbox support: **2 expressions targeting one additional
  function**, `delete_test_sandbox`.

The API target inventory is exact and enforced. It is not the migration
backlog by itself: identity helpers, searches, and database integrity functions
can remain RPCs. Each migration PR should remove its retired target from the
allowlist.

## Direct Postgres safety rules

`DATABASE_URL` is server-only. The pool is lazy, so the API can boot and serve
paths that do not use direct Postgres when it is absent. The first direct
transaction fails clearly if it is missing or its bounded pool settings are
invalid.

A direct connection as `postgres`, the schema owner, or another privileged
role bypasses RLS and ordinary grants. Therefore:

- never pass a direct client into browser/request code that expects RLS;
- require workspace/project predicates in every trusted query;
- do not log connection URLs, SQL parameters, approval tokens, or secrets;
- provision a dedicated least-privilege API database role before the first
  production workflow conversion;
- grant that role only the tables, sequences, and routines required by the
  migrated module.

The connection string must retain the SSL parameters supplied by Supabase.
Persistent API processes should use the direct connection when their network
supports it, otherwise Supavisor **session mode on port 5432**. This foundation
does not support transaction-mode pooler URLs because it owns a persistent
application pool and may later rely on session behavior.

## Transaction module contract

Use `withTransaction("stable.operation.name", async (client) => ...)` from
`apps/api/src/lib/postgres/transactions.ts`. It:

1. acquires one pooled client;
2. issues `BEGIN`;
3. runs the callback on that same client;
4. commits on success;
5. rolls back after callback or commit failure;
6. releases in all acquired-client cases;
7. preserves the original failure if rollback also fails.

The pool is small and bounded, applies connection/idle/statement timeouts, and
closes after the HTTP server drains during shutdown.

## Incremental migration sequence

1. Provision and test the least-privilege production API database role.
2. Choose one existing service-role workflow RPC family.
3. Copy its transaction and lock semantics into a typed TypeScript module.
4. Add unit tests plus an observable local Postgres integration test.
5. Switch the single caller, compare behavior, and remove the retired RPC
   target from the allowlist.
6. Retire the database function only after no deployed caller uses it.

Creator-direct proposal confirmation is a good early candidate after the role
exists because its transaction, locking, budget reservation, and idempotency
semantics are already explicit. It must migrate separately from the incident
repair that restored production.
