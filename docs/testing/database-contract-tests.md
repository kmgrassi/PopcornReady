# Database contract tests

<!-- agent-summary: Database contracts separate schema drift, service-client tenancy, request RLS, and direct-role privileges. -->
<!-- agent-summary: The always-on AST guard rejects production API references to explicitly retired relations. -->
<!-- agent-summary: Production-reader unit tests execute real query construction and observable row mapping without Postgres. -->
<!-- agent-summary: Local Supabase integration proves current relations, concrete fixtures, owner visibility, and foreign isolation. -->
<!-- agent-summary: Service-role success never substitutes for authenticated RLS coverage, and empty fixtures prove nothing. -->
<!-- agent-summary: Direct popcorn_api grants stay operation-specific and are not broadened for generic smoke coverage. -->
<!-- agent-summary: Database contract tests never invoke model or media providers and must create zero actions or jobs. -->

These tests catch the two database failure classes that otherwise look similar
in production:

- **Schema drift:** runtime code names a table or column that the migration
  chain retired.
- **Authorization drift:** the current object exists, but the intended
  request session or trusted role cannot use it.

They deliberately test those boundaries separately so a service-role read
cannot hide an RLS bug and an RLS-hidden empty result cannot be mistaken for a
missing fixture.

## Required, provider-free checks

The API agent validation runs the static retirement boundary:

```sh
pnpm db:relations:test
pnpm db:relations:validate
pnpm agent:validate -- --scope api
```

`validate-api-db-relations.mjs` parses production TypeScript rather than
grepping text. It rejects literal `.from()` calls to the retired relation
catalog and rejects dynamic or aliased targets that could conceal a retired
surface. Production helpers use literal branches when they accept a
literal-union table choice. Tests, migrations, docs, storage buckets,
`Array.from`, and `Buffer.from` are outside that database-call inventory.

The orchestrator production-reader regression is also in the default API suite:

```sh
pnpm --filter @popcorn/api exec tsx --test \
  src/lib/orchestrator-context/__tests__/graph-snapshot-reader.test.ts
```

It executes the production query builder through a recording Supabase client
and proves the unified story-spine relation names, selected columns, explicit
project predicates, non-empty conditional reads, and mapped snapshot rows.

## Local Supabase schema and RLS contract

Start and reset the local stack, then run the opt-in contract:

```sh
pnpm db:local:start
pnpm db:local:reset
pnpm db:contracts:test:local
```

The integration test creates two local auth users and a concrete private
`story_blueprints → story_blueprint_acts → story_blueprint_scenes → story_beats
→ story_panels` fixture. It then proves:

1. the service client sees each exact fixture id;
2. the real `loadProjectGraphSnapshot` production path maps every row;
3. the owning authenticated session sees every private row;
4. an unrelated authenticated session and the anonymous role see none; and
5. the read-only test path imports no provider entrypoint and creates no
   `actions` or `jobs` rows.

The test is opt-in because it requires the local Supabase CLI stack. Its normal
API-suite skip is not the schema/RLS proof; the always-on AST and recording
tests are the CI protection, and this local command is required when the
database read boundary changes.

## Failure interpretation

| Failure | Meaning | Fix direction |
| --- | --- | --- |
| Static validator names a retired relation | Production source drifted behind migrations | Repoint the caller to the asset graph/current relational spine; never restore the table |
| Service fixture insert/read fails | Current schema, column, constraint, grant, or schema-cache mismatch | Inspect the named operation and PostgREST/Postgres code |
| Service sees the fixture, owner does not | Auth-to-domain mapping, membership, grant, or RLS policy drift | Check `current_app_user_id()` and workspace policies |
| Outsider or anon sees a private fixture | Tenant isolation regression | Treat as a security failure |
| Direct `popcorn_api` capability test fails | One reviewed transaction role drifted | Repair only that transaction's policies/ACLs/readiness contract |

Each new direct-Postgres workflow keeps its own positive and negative
least-privilege tests. There is intentionally no universal `popcorn_api` access
matrix: broadening that role for test convenience would violate the database
access boundary.
