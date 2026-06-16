# Orchestrator Step Durability — Scope

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

## Non-goals

- Changing the loop's shape, the one-tool-per-turn decision model, or the
  parking/gate semantics.
- Parallel multi-tool fan-out (tracked against North Star Principle 8 separately).
