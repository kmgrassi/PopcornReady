# Web E2E Tests

This suite covers split-app browser behavior with Playwright. The default mode
is local auth:

```sh
pnpm --filter @popcorn/web test:e2e
```

`asset-studio.spec.ts` uses browser API fixtures to verify the production
`/create` route, default Image selection, choice-card padding, proposal review,
explicit confirmation, queued status, and desktop/mobile Create navigation
without spending provider credits.

The command starts the Express API and Vite app, using:

- `AUTH_MODE=local`
- `VITE_API_URL=http://127.0.0.1:4180`
- `WEB_ORIGIN=http://127.0.0.1:3100`

The API still uses the current Supabase-backed store in local auth mode, so the
repo's normal local Supabase service-role env must be available for assertions
that resolve `/api/v1/me`. Route and health checks still run without those
secrets.

For a true local-first database run, start and reset the Supabase CLI stack,
then use the local DB E2E command:

```sh
pnpm db:local:start
pnpm db:local:reset
pnpm test:e2e:local-db
```

That command wraps Playwright with `scripts/with-local-supabase-env.mjs`, reads
the local URL and keys from `supabase status -o json`, sets
`DB_BACKEND=supabase`, and loads `apps/web/e2e/e2e.local-db.env`. Unlike the
fast local-auth suite, it runs `AUTH_MODE=supabase` and signs up a real local
user to cover the production authentication path.

Hosted Supabase auth is opt-in and skipped unless all required secrets are
present:

```sh
POPCORN_E2E_SUPABASE_EMAIL=qa@example.com \
POPCORN_E2E_SUPABASE_PASSWORD='...' \
VITE_SUPABASE_URL='...' \
VITE_SUPABASE_ANON_KEY='...' \
SUPABASE_URL='...' \
SUPABASE_SERVICE_ROLE_KEY='...' \
pnpm --filter @popcorn/web test:e2e:hosted
```

Hosted mode builds the app and serves it through `vite preview` so protected
routes run with `import.meta.env.DEV === false`; this keeps the dev autopilot
path out of the hosted auth assertions.

PWA regressions also run against a production preview build because service
worker registration is gated behind `import.meta.env.PROD`:

```sh
pnpm --filter @popcorn/web test:e2e:pwa
```

That command validates the web app manifest, confirms the share-target service
worker registers, and simulates the OS share-target POST with a fixture file.

Use `PLAYWRIGHT_WEB_PORT` or `POPCORN_E2E_WEB_PORT`, and
`POPCORN_E2E_API_PORT`, to override the default ports when running beside
another local stack.
