# Worksheet: ORCH-20260731-PR847-REVIEW-FIXES

<!-- agent-summary: This worksheet resolves the two outstanding review threads on PR 847. -->
<!-- agent-summary: Retryable root failures park durable work instead of terminalizing it. -->
<!-- agent-summary: Only transient zero-spend failures and ambiguous settlement responses may replay. -->
<!-- agent-summary: Spent failures without durable output remain terminal to prevent double billing. -->
<!-- agent-summary: Each revise_story work item owns exactly one matching target and snapshot output. -->
<!-- agent-summary: Crafted multi-output story work fails production preflight before approval. -->
<!-- agent-summary: Use worksheet/ORCH-20260731-PR847-REVIEW-FIXES as the completion tag. -->

## Goal and acceptance criteria

Resolve both unresolved review threads on PR 847 without weakening budget,
binding, or approval fences. Completion requires lifecycle-level replay for
safe root-service failures, terminal accounting for spent failures without a
durable output, early rejection of multi-output story work, focused tests,
runtime/API validation, documentation updates, and independent review.

## Research and plan

- Root executor errors currently reach `failWorkItem`, which terminalizes the
  work and prevents the documented settlement-response replay.
- Reusing one immutable settlement key after a spent provider failure without
  a durable output can double-spend or conflict, so that case cannot replay.
- Child budget keys are durably appended when reserved; parking can retain the
  exact key while the pending callback remains reclaimable with no provider job.
- Registry preflight checks bindings independently and groups multiple story
  outputs under one executor, while the executor accepts exactly one output.
- Independent research and plan review required narrow retry classification,
  canonical story target equality, and lifecycle rather than executor-only
  replay coverage.

## Decisions and changes

- Added a typed retryable executor failure that carries exact child budget keys.
- Root services use it only for transient zero-recorded-spend failures or
  ambiguous settlement acknowledgement after a durable output. Validation,
  permanent ledger errors, and spent failures without an output remain
  terminal.
- The lifecycle parks the exact durable work aggregate and then the execution;
  replay reuses the callback generation, idempotency key, and reservation key.
- Terminal execution cleanup releases every still-reserved child reservation.
- `revise_story` parsing and finalization require one matching target/output,
  while production executor coverage rejects crafted aggregate work before
  approval. Multiple story rows use separate work items.
- Updated the root, activation, and cutover contracts with the precise retry and
  cardinality behavior.

## Validation evidence

- Focused decision, lifecycle, and root executor tests passed (59/59).
- API typecheck passed.
- The direct lifecycle integration compiles and is selected, but its two cases
  skipped because `RUN_LOCAL_DB_INTEGRATION` was unavailable. A local Supabase
  status request hung and was stopped; CI must run the new retained-budget
  expiry assertion.
- The API booted on port 4317 and `GET /api/v1/health` returned 200. Background
  worker errors were expected because Supabase credentials are absent here.
- `pnpm agent:lint:fix` and `pnpm agent:validate -- --scope api` passed.

## Independent reviews

- Research and plan reviews approved the narrow retry classes and early story
  cardinality rejection; spent-but-unstaged failures remain terminal.
- Implementation review caught permanent Postgres settlement codes and
  permanent zero-spend API errors that needed terminal classification. Re-review
  approved the implementation after the transient allowlist and regression
  coverage landed.
- Wrap-up review approved the final code, documentation, test coverage, and
  documented CI follow-up with no remaining blocker.

## Next action

- Commit, tag, and push PR 847.
