# Database access boundary

<!-- agent-summary: User-scoped API access stays on Supabase so Postgres RLS evaluates the session. -->
<!-- agent-summary: Trusted multi-table server workflows migrate from RPCs to TypeScript transactions. -->
<!-- agent-summary: New application workflow RPC targets are prohibited by a checked allowlist. -->
<!-- agent-summary: Triggers, RLS helpers, integrity functions, and database-native search may remain in Postgres. -->
<!-- agent-summary: Direct Postgres has no request JWT; role policies and explicit tenancy predicates are required. -->
<!-- agent-summary: Production DATABASE_URL uses the least-privilege popcorn_api session-pooler role. -->
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
the same reviewed PR. Dynamic RPC target names, aliased RPC members, dynamic
element-access calls that could conceal an RPC, and NUL-containing TypeScript
sources fail validation. Parenthesized direct calls remain valid and are
inventoried. `pnpm agent:validate -- --scope api` runs the boundary test and
validator.

Production Data API relation targets have a second checked boundary:
`scripts/validate-api-db-relations.mjs` rejects calls to explicitly retired
tables and rejects dynamic or aliased `.from()` targets. The validator is not an
RLS test; local owner/outsider/anonymous coverage remains separate. Commands and
failure interpretation live in
[`docs/testing/database-contract-tests.md`](../testing/database-contract-tests.md).

## Current inventory (2026-07-30)

- Production database catalog, `public` schema: **119 functions**.
- Trigger-backed functions: **36**.
- Non-trigger functions: **83**.
- `SECURITY DEFINER` functions: **96**.
- Active API production runtime: **47 `.rpc()` expressions targeting 48
  distinct functions**.
- Internal test-sandbox support: **2 expressions targeting one additional
  function**, `delete_test_sandbox`.

The API target inventory is exact and enforced. It is not the migration
backlog by itself: identity helpers, searches, and database integrity functions
can remain RPCs. Each migration PR should remove its retired target from the
allowlist.

The 2026-07-30 relation scan observed **424 literal `.from()` calls** and the
checked boundary permits **no dynamic calls**. Retired storyboards, generation-stage tables,
composition/edit-graph tables, timelines, and brief versions are prohibited
runtime targets.

The durable rerun-proposal lifecycle is the second direct-Postgres workflow
family. Approval, refresh, execution admission, leases, work/callback
reservations, child-budget admission, cancellation, reconciliation, and
terminal cost settlement run as typed `popcorn_api` transactions. The API does
not call the corresponding service-role workflow routines. PostgreSQL retains
the lifecycle transition trigger, budget-admission trigger, constraints, RLS,
and the narrow pin-freshness locking function. The role's lifecycle read
policies expose the Creative Director roots and lifecycle actions plus only the
Visuals/Audio child runs and primitive actions whose parent root, dispatch
action, proposal approval context, and execution reservation match one durable
rerun work item. Unrelated domain runs and primitive actions remain hidden.

Asset-detail billing is intentionally a request-scoped Supabase read. The
owner-only project asset route resolves attributable `actions` and
`credit_transactions` through the caller's JWT-backed client, so project and
ledger RLS remain authoritative. Public discovery routes do not expose or
request this billing projection. Only actions with exactly one output asset
are attributable; ambiguous and historical unlinked debits return `null`
instead of inventing a per-asset split.

## Direct Postgres safety rules

`DATABASE_URL` is server-only. The pool is lazy, but production readiness now
requires the exact creator-direct and rerun-lifecycle role capabilities before Railway
promotes a deployment. Non-production processes may still boot without the URL;
the first direct transaction then fails clearly if it is missing or its bounded
pool settings are invalid.

A direct connection carries no request JWT identity. A connection as `postgres`,
the schema owner, or a `BYPASSRLS` role bypasses policies entirely. The
production `popcorn_api` role deliberately remains `NOBYPASSRLS`; it has
role-specific policies and column grants only for reviewed transaction modules.
Therefore:

- never pass a direct client into browser/request code that expects RLS;
- require workspace/project predicates in every trusted query;
- do not log connection URLs, SQL parameters, approval tokens, or secrets;
- provision a dedicated least-privilege API database role before the first
  production workflow conversion;
- grant that role only the tables, sequences, and routines required by the
  migrated module;
- keep workspace/project/actor predicates in the SQL even when a role-specific
  policy permits the reviewed row family.

The connection string must retain the SSL parameters supplied by Supabase. The
current Node `pg` driver requires
`sslmode=require&uselibpqcompat=true` for the Supavisor certificate chain.
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
7. preserves the original failure if rollback also fails, while evicting the
   transaction-poisoned client from the pool.

The pool is small and bounded, applies connection/idle/statement timeouts, and
closes after the HTTP server drains during shutdown.

## Creator-direct confirmation transaction

`apps/api/src/lib/postgres/creator-direct-confirmation.ts` owns the trusted
confirmation workflow formerly orchestrated by
`consume_creator_direct_proposal_gate`. It authorizes and locks the
workspace/project/actor gate before replay lookup, preserves PostgreSQL's
canonical numeric digest representation, locks the queued creator-direct run,
and records gate consumption plus idempotency in one transaction.

`reserve_orchestrator_run_budget` and `wake_orchestrator_dispatch` remain
database-native routines. They are reusable budget/locking and lease-safe queue
integrity primitives, not HTTP workflow orchestration. The role receives direct
`EXECUTE` grants only for those two routines in this module.

Production health checks the exact role, its safe attributes and lack of role
memberships/ownership, the absence of extra effective table or column
privileges, named RLS policies, and routine grants once and caches only a
successful result. This prevents Railway's caller deployment from becoming
healthy before the independent Supabase migration workflow has installed the
required capabilities. Every migration that changes a `popcorn_api` table or
column grant must update the readiness allowlist and the real-role integration
coverage in the same PR. The rerun lifecycle directly reads the semantic scene
snapshot pointer, but stable scene/beat identity remains behind the service
client or the bounded story-application function and is not a direct-role
grant.

Release readiness adds one non-workflow metadata exception outside `public`:
`popcorn_api` has `USAGE` on `supabase_migrations` and column-level
`SELECT(version)` on `supabase_migrations.schema_migrations`. It cannot select
the table as a whole or read migration names/statements. Health uses those
nonsecret versions only to prove that every version declared by the immutable
API build artifact is applied. The query returns no customer data, carries no
request identity, and is never exposed through PostgREST or an application RPC.

The storyboard creator entrypoint takes a transaction-scoped advisory lock on
the project before its service-store find-or-create decision. The lock carries
no table access and adds no role grants; it only serializes this entrypoint
across API instances so two creator requests cannot create duplicate active
storyboard-bound roots. Project authorization still runs first on the
request-scoped access path, and the orchestrator store remains the durable
run/gate writer. The gate lookup is backed by
`orchestrator_run_gates(stage, created_at DESC, orchestrator_run_id)` so the
two-second active-run poll does not scan and sort gate history.

Full-video script approval and rejection use the typed transaction in
`apps/api/src/lib/postgres/script-review-transaction.ts`. It locks the exact
reached script gate, Creative Director run, project pointer, and active script
draft; binds the decision to the reviewed draft id; and atomically updates the
script status, gate decision, and resumable run state. Rejection also inserts
its text-only feedback action in the same transaction. The `popcorn_api` role
has column-level access and RLS policies only for that script-review shape, and
release readiness checks those grants and policies explicitly.

## Incremental migration sequence

1. Provision and test the least-privilege production API database role. ✅
2. Choose one existing service-role workflow RPC family. ✅ Creator-direct
   confirmation.
3. Copy its transaction and lock semantics into a typed TypeScript module.
4. Add unit tests plus an observable local Postgres integration test.
5. Switch the single caller, compare behavior, and remove the retired RPC
   target from the allowlist.
6. Retire the database function only after no deployed caller uses it.

The legacy `consume_creator_direct_proposal_gate` function remains during the
rolling deployment observation window, but it has no API runtime caller and is
no longer in the checked RPC allowlist. Retire it only after the direct caller
has been deployed and observed.
