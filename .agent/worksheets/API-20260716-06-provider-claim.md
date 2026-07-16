# Worksheet: API-20260716-06-provider-claim

<!-- agent-summary: Durable provider-launch fence for the PR 5 generated-assets runtime. -->
<!-- agent-summary: The generated-assets executor must not use process-local JSON job state. -->
<!-- agent-summary: One durable job owns one live provider launch through a token-fenced claim. -->
<!-- agent-summary: A stale claimant cannot complete a job after ownership changes. -->
<!-- agent-summary: Ambiguous crashes during non-idempotent provider calls are never auto-replayed. -->
<!-- agent-summary: Canonical action identity belongs to jobs.action_id before provider execution. -->
<!-- agent-summary: Asset relation/provenance expansion and edit-video parity stay out of this slice. -->

## Goal

Replace the process-local generated-assets job path with the existing durable
`public.jobs` store and add a service-role compare-and-set claim before any
provider call. Concurrent API instances must have one live launcher for a job.

## Scope boundary

This PR owns generated-assets execution only. It does not migrate unrelated
legacy JSON job consumers, add `action_assets`, or make an ambiguous external
provider crash safely replayable.

## Design decisions

- Use typed `jobs` columns and service-only RPCs for provider claim state; do
  not overload `progress` JSON or repurpose the recovery lease.
- Preallocate the canonical action and persist its identity in `jobs.action_id`
  before the provider call; only a token-fenced terminal job transition may
  change that action's terminal status.
- Treat the provider claim as a renewable lease: active execution heartbeats
  the service-only token, while a claim with no current heartbeat is terminalized
  for reconciliation and never replayed automatically.
- Complete the linked action in the same token-fenced database transaction as
  the terminal job update; generated-asset polling safely reconciles only stale
  running claims and never launches a provider from the read path.
- Claim only a queued job. A job that is already running is held, and a terminal
  job is replayed. Recovery must terminalize ambiguous stale running jobs rather
  than launch the provider again.
- Fence terminal job and action updates with the claim token.

## Planned validation

- Add an env-gated Postgres race test for simultaneous claims, token-fenced
  terminal writes, held/terminal outcomes, and stale-claim reconciliation.
- Add migration contract coverage and an env-gated Postgres race test.
- Run API typecheck, focused tests, lint/validation, and the API health smoke.

## Validation evidence

- `pnpm --filter @popcorn/api typecheck` passed after the claim-renewal update.
- Focused migration contract tests passed; the env-gated Postgres race test covers
  one winner/one holder, wrong-token rejection, lease renewal, terminal state,
  and stale reconciliation but was skipped without Supabase credentials.
- `supabase migration up --local` could not connect to the local Postgres port
  `55522` (connection timeout), so the migration and race test still need a
  healthy local/CI Supabase run.
- API health smoke passed at `GET /api/v1/health` on port `4018` (the
  unconfigured local worker logged expected Supabase credential errors).
- `pnpm agent:lint:fix` and `pnpm agent:validate -- --scope api` passed after
  the final atomic action-completion and polling reconciliation changes.
- Independent wrap-up review found no release blockers; it re-ran API typecheck,
  migration contract coverage, and whitespace validation.

## Caretaker follow-up

- Addressed both unresolved review findings with `@Codex` attribution: resolve
  workspace provider/model defaults before inserting the canonical action, and
  persist those resolved values in the queued job input.
- Claim renewal now mirrors its heartbeat into `jobs.progress.lastProgressAt`
  so run observability does not report healthy provider work as stalled.
- `git diff --check` passed. Focused test/typecheck commands were attempted but
  cannot start in this isolated worktree because `tsx` and `tsc` are unavailable.
- Independent reviewer was unavailable in this automation environment.
