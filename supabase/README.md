# Supabase

Postgres schema, Storage, and RLS for Popcorn Ready. Migrations in `migrations/`.

## Local-first database

Use the Supabase CLI stack when you want a disposable local Postgres/Auth/Storage
environment for development or tests:

```sh
pnpm db:local:start
pnpm db:local:reset
pnpm test:e2e:local-db
```

`pnpm db:local:start` runs `supabase start` from the repo root.
`pnpm db:local:reset` applies every migration and `seed.sql` to the local DB.
`pnpm test:e2e:local-db` reads the local Supabase URL and keys from
`supabase status -o json`, injects them into the API and web test processes, and
runs the Playwright suite against `DB_BACKEND=supabase`.

The checked-in local Supabase ports use a repo-specific `555xx` range to avoid
colliding with other Supabase projects that use the CLI defaults:

- API: `http://127.0.0.1:55521`
- Postgres: `127.0.0.1:55522`
- Studio: `http://127.0.0.1:55523`

If `supabase status` mentions a stale hosted project ref or missing container,
clear the ignored CLI cache with `rm -rf supabase/.temp`, then run
`pnpm db:local:start` again.

## Hosted database migrations

For hosted Supabase projects, link first and push:

```sh
supabase link --project-ref <ref>
supabase db push
```

## ⚠️ Identity & RLS — read before writing a policy

There are **three different ids** and mixing them up is the #1 data-layer bug:

- `auth.uid()` — the auth session's id (`auth.users.id`).
- `public.users.id` — the app/domain user id (its **own** uuid). **Not** `auth.uid()`.
- `public.users.auth_id` — nullable link between the two (NULL = invited / pre-auth).

Quick rules:

- Own-row check on `public.users` → `auth_id = auth.uid()`.
- Any other table's domain user column (FK to `public.users.id`) →
  `= public.current_app_user_id()`, **never** `= auth.uid()`.
- Helpers reading `public.users` inside a policy must be `SECURITY DEFINER`
  (avoids RLS recursion).
- Server code uses the **service_role** key (bypasses RLS); the browser client
  enforces RLS.

Full explanation, examples, lifecycle, and gotchas:
**[`../docs/supabase-identity-and-rls.md`](../docs/supabase-identity-and-rls.md)**.
