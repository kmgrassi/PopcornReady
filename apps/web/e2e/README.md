# Web E2E Tests

<!-- agent-summary: This document owns Playwright coverage across the split Vite SPA and Express API. -->
<!-- agent-summary: The default suite uses local auth and starts both application servers. -->
<!-- agent-summary: Local Supabase parity runs through the dedicated local-database command. -->
<!-- agent-summary: Hosted auth and PWA checks use explicit opt-in production-preview modes. -->
<!-- agent-summary: GitHub runs E2E for runtime-affecting pull requests and main pushes. -->
<!-- agent-summary: Superseded runs cancel, jobs have a 15-minute cap, and failure reports upload. -->
<!-- agent-summary: Required checks need a successful no-op path before workflow filters are enabled. -->

This suite covers split-app browser behavior with Playwright. The default mode
is local auth:

```sh
pnpm --filter @popcorn/web test:e2e
```

`asset-studio.spec.ts` uses browser API fixtures to verify the production
`/create` route, default Image selection, choice-card padding, proposal review,
default-on image and video prompt refinement, motion-specific progress, exact
effective-prompt preview, creator bypass, draft-preserving video revision,
immediate navigation to `/create/review`, manual **Approve this** confirmation,
the visible 10-second automatic-confirmation boundary, at-most-once dispatch,
Back/Forward proposal restoration without reposting, stale-proposal recovery,
queued status, invalid review-state recovery, desktop/mobile Create and review
layouts, project-picker keyboard behavior, existing/first/new-project selection,
and project-list, proposal, confirmation, and creation failure recovery. It also
verifies that revising preserves the editable draft, failed confirmation remains
manual-only on Forward, a delayed project creation cannot override a newer
selection, and pagination failures preserve loaded projects, without spending
provider credits.

`rerun-proposal-lifecycle.spec.ts` verifies the durable Request Changes UI
without provider spend: exact-target proposal preview, preserved/affected work,
cost approval, separate execution, waiting-state polling, reload recovery,
visible owning-surface refresh after restored completion, truthful cancellation,
terminal cleanup, keyboard focus restoration, and mobile overflow. The run and
storyboard suites also assert that their entry points open this lifecycle instead
of posting the retired reject, board-revision, or stage-restart mutations.

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

## GitHub Actions runner policy

The `Web E2E` workflow runs for pull requests and `main` pushes that include
runtime-affecting files. Changes made only to Markdown files and `.agent/**`
records skip the workflow. A newer commit to the same pull request or branch
cancels its superseded run, and each job has a 15-minute runner budget.
Playwright reports upload only after an ordinary test failure; cancellation or
job timeout may end before an artifact can be preserved.

The workflow-level path filter is safe while Web E2E is not a required branch
check. Before making it required, replace the filter with a path-classifier or
no-op job that reports success for documentation-only changes; otherwise GitHub
can leave the required check absent or pending.

Use `PLAYWRIGHT_WEB_PORT` or `POPCORN_E2E_WEB_PORT`, and
`POPCORN_E2E_API_PORT`, to override the default ports when running beside
another local stack.
