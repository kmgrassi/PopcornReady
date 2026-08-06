# Orchestrator Step Durability — Scope

<!-- agent-summary: This scope defines transient-failure durability for individual orchestrator turns. -->
<!-- agent-summary: Idempotent store reads and patches use bounded retry with exponential backoff. -->
<!-- agent-summary: Append-only invocation writes remain non-retryable until they have idempotency keys. -->
<!-- agent-summary: Finite domain waits persist semantic reasons while compatible root waits may remain null. -->
<!-- agent-summary: Resume claims atomically change waiting runs to running and clear their wait reason. -->
<!-- agent-summary: Run pnpm db:test:orchestrator-wait-reasons:local against local Supabase; CI does not provision it. -->
<!-- agent-summary: Loop shape, parallel fan-out, and broader async retry policy remain outside this scope. -->

## Objective

Make a single orchestrator turn resilient to transient infrastructure failures so
a momentary blip (a dropped DB connection, a 5xx, a serialization conflict) costs
a **retry**, not the **whole run**. This is the first, lowest-risk slice of the
durability gap identified in
[async-tool-calling-orchestrator](../research/async-tool-calling-orchestrator.md):
the report's checklist item *"represent every tool call as a first-class state
object with retry metadata."*

## Background

Each turn of `driveLoop` (`apps/api/src/lib/orchestrator/engine.ts`) performs
several store round-trips: `listRunActions` + `listRunGates` (reads), the model
call, tool execution, `recordInvocation` (write), and usually
`updateOrchestratorRun` (write). Today any uncaught error in any of them is caught
by `driveGuarded` and marks the **entire run** `failed`. There is no per-step
retry: a single transient store error ends a run that was otherwise healthy.

## Part A — Idempotent store retry (this PR)

A `withRetry` helper (`orchestrator/retry.ts`) wraps an async step in bounded
exponential-backoff retries, and `withStoreRetry` applies it to the store's
**idempotent** methods. The engine wraps its store in `resolved()`, so every run
(production and tests) gets it; backoff `sleep` is injectable so tests don't wait.

Retried (idempotent): `getOrchestratorRun`, `updateOrchestratorRun` (set/patch),
`listRunGates`, `markGateReached`, `listRunActions`, `markInvocation` (patch by id).

**Not** retried: `recordInvocation`. It appends a new action row, so a
failed-but-applied write could **duplicate** the action on retry. Until actions
carry an idempotency key, the safe choice is to fail the run rather than risk a
double-append.

Acceptance criteria (met):

- A transient failure in an idempotent store op retries with backoff and the run
  proceeds (`engine-retry.test.ts`).
- A non-retryable error (or exhausted attempts) still surfaces; `recordInvocation`
  runs exactly once (`retry.test.ts`).
- No behavior change when nothing throws — existing engine tests stay green.

## Part B — Follow-ups (not in this PR)

1. **Idempotency key on actions**, so `recordInvocation` can retry safely (mirrors
   the v1 asset-job `Idempotency-Key` pattern). Then include it in `withStoreRetry`.
2. **Model-call retry policy** for transient provider/network errors, distinct
   from the existing turn timeout (a slow turn ≠ a failed turn; don't compound).
3. **Async tool-job retry/timeout policy** — today async tools park and rely on the
   worker; give them explicit deadlines + bounded retries (Temporal-Activity style).
4. **Transient-error classification.** Default `shouldRetry` retries all errors a
   bounded number of times; add a predicate that distinguishes transient
   (connection/5xx/serialization) from deterministic errors to fail fast on the
   latter.
5. **Action compaction** for long-form/recursive-composite runs so the replayed
   history fed to the model stays bounded (separate from durability, same file of
   concerns).

## Terminal completion correction (2026-08-01)

A malformed finite-domain terminal response is now separated from a failed
media invocation. When the terminal parser reports a model-correctable contract
error, the engine makes one structured, no-tools correction call and validates
the answer through the same parser. Successful primitive actions, jobs, and
assets are reused; the correction cannot invoke a tool or replay billable media.

The correction does not apply to missing/failed/unauthorized outputs, database
or asset-state failures, or other runtime faults. Provider and timeout failures
retain their own failure kinds, while an invalid corrected answer remains
`invalid_input`. The correction count is bounded per live drive attempt, not by
new durable state, so a worker crash before terminalization may start a fresh
attempt after lease recovery.

Question correction can inspect an incomplete output set so a specialist may
ask for missing creative direction after producing only part of its assignment.
That relaxed inventory still validates every asset's readiness, project/run
ownership, graph kind, and persisted semantic role. It does not relax terminal
completion: a corrected `done` response must allocate a distinct compatible
asset to each required semantic-role slot, including every `minimumCount` slot.

## Async completion ordering (2026-07-14)

An inline async worker can finish after its tool returns `accepted` but before the
engine has recorded the invocation and parked the run. Completion callbacks now
wake the durable dispatch queue instead of entering the engine directly. The
leased recovery worker is therefore the sole production owner of a run turn:
it parks first, checks whether the job is already terminal, and finalizes its
action before requesting another model turn. An atomic `waiting → running` claim
protects parked-run recovery, while claimed recovery work drives queued/running
runs through the normal entrypoint. This prevents completion callbacks and the
recovery worker from concurrently observing incomplete lifecycle state.

Every engine park supplies one semantic reason. Finite Visuals and Audio runs
persist `media_job`, `domain`, or `approval` because their database constraint
requires a queryable reason for every waiting state. Creative Director roots
retain null media/approval waits for schema compatibility and persist `domain`
only while delegated specialist work is active. Recovery claims clear the
reason atomically before re-entering the loop and re-park with the same semantic
reason when the awaited work remains active.

The real schema/store regression is opt-in because it requires local Supabase:

```sh
pnpm db:local:start
pnpm db:local:reset
pnpm db:test:orchestrator-wait-reasons:local
```

It exercises Visuals, Audio, and Creative Director rows against the named
database constraint, then proves the production store maps each reason and
clears it through the atomic resume claim. The normal API suite discovers but
skips this file without `RUN_LOCAL_DB_INTEGRATION=1`; no current GitHub workflow
provisions local Supabase for it.

Creator progress projection treats the parent run transport as authoritative
once it is terminal. If a historical action row still says `running`, an
attached failed/canceled/succeeded job supplies its terminal display state; if
there is no terminal job, the parent failure/cancellation wins. Terminal runs
therefore never expose a current tool or animate stale activity, while the
immutable action and job records remain available for diagnosis. For a retried
tool, only jobs attached to the latest invocation may override its current stage
status; earlier attempt jobs remain visible as activity history but are not
authoritative for the active retry.

## Non-goals

- Changing the loop's shape, the one-tool-per-turn decision model, or the
  parking/gate semantics.
- Parallel multi-tool fan-out (tracked against North Star Principle 8 separately).
