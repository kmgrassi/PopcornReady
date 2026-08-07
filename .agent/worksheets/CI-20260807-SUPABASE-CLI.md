# Worksheet: CI-20260807-SUPABASE-CLI

<!-- agent-summary: Durable record for the Supabase migration workflow recovery. -->
<!-- agent-summary: The production migration job regressed when setup-cli resolved v2.112.0. -->
<!-- agent-summary: The workflow pins the last known-good stable CLI instead of floating latest. -->
<!-- agent-summary: A policy test prevents accidental return to an unreviewed floating CLI. -->
<!-- agent-summary: Production rollout still requires the migration workflow and Railway redeploy to succeed. -->
<!-- agent-summary: Do not include secrets, private prompts, or customer data. -->
<!-- agent-summary: Use worksheet/CI-20260807-SUPABASE-CLI as the completion tag. -->

## Goal and acceptance criteria

Restore the serialized `Apply Supabase migrations` workflow after the Supabase
CLI began failing during `supabase link`, and prevent an unreviewed `latest`
upgrade from silently breaking production migrations again.

Acceptance criteria:

- the workflow installs the last known-good stable Supabase CLI release;
- a repository policy test rejects a floating CLI version;
- deployment documentation explains the pin and upgrade procedure;
- targeted tests and `pnpm agent:validate -- --scope all` pass;
- the change is committed, tagged, pushed, and opened as a ready PR.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/agent-system/README.md`
- `docs/agent-system/reviews.md`
- `docs/agent-system/worksheets-and-feedback.md`
- `docs/railway-deployment.md`
- `docs/supabase-identity-and-rls.md`
- `docs/scopes/database-access-boundary.md`

## Decisions

- Pin `supabase/setup-cli` to CLI `v2.111.0`. The last successful production
  migration run occurred while that was the latest stable release; failures
  began after `v2.112.0` was published on 2026-08-07.
- Keep the existing linked-project workflow. Avoiding `supabase link` would
  require introducing and maintaining a direct database URL path, which is a
  larger secret/configuration change than the observed regression warrants.
- Add a policy assertion for the exact pin and a negative assertion against
  `latest` so upgrades are explicit and reviewed.

## Changes

- `.github/workflows/supabase-migrations.yml` pins `supabase/setup-cli` to
  `2.111.0` and links the upstream regression.
- `scripts/validate-github-actions-policy.test.mjs` requires that exact pin and
  rejects `latest` or `beta` for the production migration workflow.
- `supabase/README.md` documents the hosted migration pin and intentional
  exact-version upgrade policy.
- `docs/railway-deployment.md` documents why migration failure blocks Railway
  health and the required recovery ordering.
- `.agent/feedback/CI-20260807-SUPABASE-CLI.md` records the workflow lesson.

## Validation evidence

Research evidence:

- GitHub run `31187176638` failed at `supabase link` with a schema error at
  API-key field `[2]["inserted_at"]`; `db push` never ran.
- GitHub run `31019626379` succeeded on 2026-08-05, when `v2.111.0` was the
  current stable Supabase CLI.
- Supabase published stable `v2.112.0` at 2026-08-07T10:08:19Z; the failed run
  resolved `version: latest` later that day.
- Railway deployment `850d21ab-eb73-4baa-904e-d0d0ee887fad` built and started
  the API, then failed health checks because production still had 101 applied
  migrations while the build required 103.

Commands and results:

- `npx --yes supabase@2.111.0 --version` — passed; reported `2.111.0`.
- `npx --yes supabase@2.111.0 db push --help | rg -- '--include-all'` — passed;
  the required flag is supported.
- `node --test scripts/validate-github-actions-policy.test.mjs` — passed after
  correcting the initial test regex to account for `liveYaml` stripping
  comments.
- `pnpm db:migrations:validate` — passed; 103 migrations.
- `pnpm agent:lint:fix` — passed.
- First `pnpm agent:validate -- --scope all` — stopped because this fresh
  worktree had no `node_modules` and could not import TypeScript; workflow and
  migration checks before that point passed.
- `pnpm install --frozen-lockfile` — passed; restored locked dependencies.
- Second `pnpm agent:validate -- --scope all` — passed, including agent lint,
  workflow policy, migration tests/validation, RPC/relation boundaries, and web
  plus API typechecks.
- Final `pnpm agent:lint:fix && pnpm agent:validate -- --scope all && git diff
  --check` — passed. Workflow policy reported 3/3 tests; migration validation
  reported 103 versions; RPC/relation boundaries and web/API typechecks passed.

## Independent reviews

- Research: `/root/migration_ci_review` confirmed the `v2.112.0` regression,
  upstream issue #6115, and `v2.111.0` as the last known-good version.
- Plan: approved the exact pin and rejected direct-URL or `.temp`-state bypasses
  as broader and less durable.
- Implementation: no P0-P2 findings. One P3 requested moving the CLI assertions
  into a separately named test; resolved before final validation.
- Wrap-up: `/root/migration_ci_review` found no remaining P0-P3 findings and
  confirmed the diff, documentation, task records, and validation evidence are
  ready for commit and a ready PR. The hosted mutation remains explicitly
  post-merge evidence.

## Blockers and risks

- Local validation cannot reproduce an authenticated production `supabase
  link` without GitHub secrets. The authoritative end-to-end proof is the
  workflow run after merge.
- If `v2.111.0` also rejects the current management API response, the next
  recovery is an explicit direct-database workflow or Supabase platform fix.

## Next action / handoff

Commit, tag, push, and open a ready PR. After merge, observe the production
migration and Railway deployment runs; local validation cannot prove
authenticated hosted mutation.
