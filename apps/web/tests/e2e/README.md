# Web E2E Tests

This suite covers split-app browser behavior with Playwright. The default mode
is local auth:

```sh
pnpm --filter @popcorn/web test:e2e
```

The command starts the Express API and Vite app, using:

- `AUTH_MODE=local`
- `VITE_API_URL=http://127.0.0.1:4180`
- `WEB_ORIGIN=http://127.0.0.1:5174`

The API still uses the current Supabase-backed store in local auth mode, so the
repo's normal local Supabase service-role env must be available for assertions
that resolve `/api/v1/me`. Route and health checks still run without those
secrets.

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

Use `POPCORN_E2E_WEB_PORT` and `POPCORN_E2E_API_PORT` to override the default
ports when running beside another local stack.
