# Tool ↔ database interactions & write/read error handling

How the agent's orchestrator tools touch Postgres, where those calls can fail,
how failures surface today, and the hardening work that remains. Companion to
[supabase-cutover-prs.md](./supabase-cutover-prs.md) and
[NORTH_STAR.md](../NORTH_STAR.md).

## What landed (this PR)

- **`runQuery` wrapper** — `apps/api/src/lib/supabase/db-errors.ts`. Every
  Supabase store call now goes *through* `runQuery(operation, builder, opts?)`
  instead of the old opt-in `const { data, error } = await …; throwOnError(...)`
  pattern. The wrapper executes the query, emits one structured `db_error` log
  line on failure, and throws the typed `ApiError("database_error")` envelope —
  so a forgotten error check can no longer silently swallow a failed read or
  write. `{ allowMissing: true }` maps a PostgREST `PGRST116` (no-row
  `.single()`) to `null` for reads where absence is normal.
- **All production store call sites converted** — `api/v1/store.ts` (60),
  `api/v1/storyboards.ts` (30), `api/v1/orchestrator-store.ts` (8),
  `v1/store.ts` (7), `v1/generation-runs/store.ts` (4), `eval/store.ts` (13),
  `eval/judgment-store.ts` (3), and `supabase/clients.ts` (`resolveAppUserId`).
  Bespoke branches (the `ensureWorkspace` unique-violation re-read,
  optimistic-concurrency `updated_at` guards) keep hand-written
  `{ data, error }` handling but still surface via `databaseError`.
- **`database_error` is now a first-class tool-failure kind** —
  `orchestrator/tool-errors.ts` `preconditionFromApiError` maps it to a
  **recoverable, retry-the-same-tool** `ToolError` instead of letting it fall
  through to `provider_failed`/`recoverable: false`.

## How a tool call reaches the database

```
agent model → tool registry (orchestrator/registry.ts)
            → ToolDefinition.execute(input, context)
            → orchestrator-tools/*.ts  (e.g. plan-shots.ts)
            → store fn in api/v1/store.ts  (addProjectPlan, getActiveProjectBrief …)
            → runQuery(...)  →  Supabase Postgres
```

Tools do **not** wrap their store calls in try/catch — a thrown
`ApiError("database_error")` propagates out of `execute()`. The invocation loop
is expected to convert it via `classifyToolFailure` →
`preconditionFromApiError`. The tool-path stores run mostly as
`getServiceSupabase()` (RLS bypassed; tenancy enforced in app code via
`workspaceId`/`projectId`), with some reads on `getRequestSupabaseOrService()`.

## Per-tool DB interaction map

Legend: **R** = read, **W** = write. "Wired" = has a live handler today;
unwired tools return `failedUnimplemented` from `registry.ts`.

| Tool | Wired | DB interaction | Store fn(s) | Notes |
| --- | --- | --- | --- | --- |
| `create_or_load_brief` | ✅ | **W** brief, ensure workspace/project | `addProjectBrief` | Insert after schema validation; expensive work is small, so a failed write is cheap to retry. |
| `plan_shots` | ✅ | **R** active brief, **W** plan asset | `getActiveProjectBrief`, `addProjectPlan` | Persists *after* a `planEdit` model call — a failed write strands that model work (see Failure modes). |
| `generate_storyboard` | ✅ | **R** active plan, **W** storyboard tiles/job/assets | `getActiveProjectPlan`, `addStoryboardTiles`, agent-api job store | First async/media tool; writes span multiple tables + a job record. |
| `develop_story_blueprint` | ⬜ | **R** brief, **W** blueprint | (planned) | Unwired; map blueprint to a relational table per asset-graph rule. |
| `draft_script` | ⬜ | **R** blueprint, **W** script | (planned) | Unwired. |
| `plan_visual_anchors` | ⬜ | **R** plan, **W** anchor specs | (planned) | Unwired. |
| `generate_anchor` / `generate_keyframe` / `generate_clip` / `generate_audio` | ⬜ | **W** media assets + job rows | (planned) | Async; the write happens on job completion, off the request — error surfacing must go through the job record, not the HTTP response. |
| `assemble_timeline` | ⬜ | **R** ready assets, **W** timeline | `saveTimeline` (v1 store) | Unwired in orchestrator vocabulary. |
| `critique_timeline` | ⬜ | **R** timeline | (planned) | Read-only. |
| `request_approval` | ⬜ | **W** gate row | `markGateReached`/`resolveGate` (orchestrator-store) | Approval gate persistence. |
| `export_video` | ⬜ | **R** approved timeline, **W** render/export rows | (planned) | Async render. |

## Failure modes & how they surface now

1. **Transient DB error on a write after expensive work** (e.g. `plan_shots`
   persists after `planEdit`, `generate_storyboard` after media planning). Now:
   `runQuery` throws `database_error` → classified **recoverable, retry same
   tool**. Before: would have been `provider_failed`/unrecoverable, stranding
   the run. ⚠️ Retrying re-runs the model call — see task T4 (idempotency).
2. **Missing row on a required read** (`getActiveProjectBrief` returns `null`).
   Handled by the tool as a `precondition_unmet` (suggest `create_or_load_brief`),
   not a DB error — correct and unchanged.
3. **Async media write failure** (job-backed tools). The failure happens off the
   request, so it must be recorded on the job/stage-item row and reflected in
   the run — not thrown to an HTTP caller. Today's `database_error` envelope
   covers the throw; surfacing it *into the run* is task T3.
4. **Partial multi-table write** (`generate_storyboard` writes tiles + job +
   assets). `runQuery` surfaces the first failure, but there is no transaction —
   a mid-sequence failure can leave a partial storyboard. Task T2.

## Hardening tasks

> These are the "ways a tool might interact with the database" worth tracking.
> Each should ship as its own open PR (per CLAUDE.md). T0 is done in this PR.

- **T0 — `runQuery` wrapper + full call-site conversion + `database_error` tool
  kind.** ✅ Done in this PR.
- **T1 — Wire `classifyToolFailure` into the live invocation loop.** The
  error-classification vocabulary in `tool-errors.ts` (now including
  `database_error`) is currently exercised only by tests; the orchestrator
  invocation loop does not yet route thrown tool errors through it. Until then
  a `database_error` from a wired tool propagates uncaught. Also migrate
  `orchestrator-tool-invocations.json` (still a local JSON store via
  `localDir()`) onto Postgres.
- **T2 — Make multi-table tool writes atomic.** `generate_storyboard` (and
  future media tools) write several tables; wrap each trusted workflow's
  persistence in a typed direct-Postgres transaction module so a failure can't
  leave a partial storyboard. Preserve the `database_error` tool envelope at
  the module boundary. Do not add a new application workflow RPC; follow
  [`database-access-boundary.md`](./database-access-boundary.md).
- **T3 — Surface async write failures into the run/stage-item.** For job-backed
  tools, a DB write failure on completion must mark the stage item failed +
  `retryable`, not just throw into the worker. Reflect it in
  `generation_stage_items.error` and the run status.
- **T4 — Idempotent retries for "expensive work → write" tools.** Because
  `database_error` is now recoverable, a retry of `plan_shots` /
  `generate_storyboard` re-runs the model/media call. Key these writes by a
  request/content hash (the v1 store already has an idempotency table) so a
  retry after a write failure reuses the prior model output instead of paying
  for it twice.
- **T5 — Distinguish transient vs. permanent DB errors.** `runQuery` treats all
  non-missing errors alike. Classify Postgres SQLSTATEs: serialization/timeout
  (`40001`, `57014`) → retryable; constraint/check violations (`23xxx`) →
  `invalid_input` (the agent should revise, not retry). Feed this into
  `preconditionFromApiError` so the suggested recovery matches the cause.
- **T6 — Adopt `runQuery` in remaining DB touchpoints.** `tool-tests/`
  sandbox + specs read the DB directly to assert state; route them through
  `runQuery` (or a test variant) so test-time DB errors are legible too.
