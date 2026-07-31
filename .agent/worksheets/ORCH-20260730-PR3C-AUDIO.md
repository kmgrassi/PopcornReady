# Worksheet: ORCH-20260730-PR3C-AUDIO

<!-- agent-summary: Durable record for selective-regeneration roadmap PR 3C. -->
<!-- agent-summary: This slice adds bounded Audio and picture-fit rerun executors. -->
<!-- agent-summary: Executors remain absent from the production registry until PR 5. -->
<!-- agent-summary: Audio outputs stay immutable and pooled until atomic application. -->
<!-- agent-summary: Exact proposal targets, pins, bindings, and causation remain authoritative. -->
<!-- agent-summary: Cross-domain picture/story gaps return typed root-owned prerequisites. -->
<!-- agent-summary: Use worksheet/ORCH-20260730-PR3C-AUDIO as the completion tag. -->

## Goal and acceptance criteria

Implement roadmap PR 3C behind the PR 2 executor interface for narration,
dialogue, soundtrack, sound-effect, and fit-to-picture outputs. Reuse canonical
Audio tool services, preserve typed script/story/timing inputs, never wake
Visuals for Audio-only work, and keep production execution disabled until PR 5.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`
- `docs/repository-structure.md`, `docs/NORTH_STAR.md`
- `docs/domain-agent-orchestration-contract.md`
- `docs/scopes/full-selective-regeneration-cutover-prs.md`
- `apps/api/src/lib/tool-tests/README.md`

## Decisions

- The implementation was developed on the reviewed PR 2 integration head. After
  PR #844 merged, PR #848 dropped its four patch-equivalent prerequisite commits
  and replayed only the two Audio commits plus this worksheet onto `main`. This
  keeps PR #844's reviewed lifecycle hardening authoritative.
- After PR #850 merged, the final rebase retained its shared callback and Visual
  still budget-admission contracts while preserving Audio's durable derivation
  of reservation keys and nested provider-budget fallback. Explicit Visual
  admission remains the first choice; Audio proposal work uses the durable child
  reservation path.
- Keep adapters constructible only through explicit test/integration registries;
  do not add them to `productionRerunExecutorRegistry`.
- Reuse the task-bound Audio domain tools and durable job gateway rather than
  duplicate provider logic.
- Treat missing picture duration or exact script/story scope as a typed blocked
  prerequisite owned by the Creative Director.

## Changes

- Added constructible Audio production, source-revision, and picture-fit
  executors behind the PR 2 registry interface without production
  registration.
- Projected the approved work item into one exact `DomainTask.v1`, including
  proposal/approval/execution causation, graph pins, output bindings, and a
  runtime-only callback fence.
- Routed each canonical generated-asset provider claim into a nested child
  reservation under the proposal ceiling using the exact child run, primitive
  action, and provider job. Deterministic picture-fit reserves and settles one
  zero-cost child operation.
- Recorded terminal domain reports through the proposal callback transaction;
  exact binding validation rejects extra, missing, or rebound outputs, and the
  callback derives its primitive actions and settled budget keys from durable
  output causation. A late callback that lost cancellation/retry ownership
  cannot advance state.
- Kept fit critiques pooled by reusing the engine's child action without
  appending the legacy active `audio_fit:*` selection.
- Required picture-fit work to name one exact beat. Unsupported semantic scope
  returns a typed Creative Director prerequisite instead of broadening Audio.
- Corrected proposal delegation preserve projection to use graph content hashes
  and the same stable selection-key semantics as target-scope validation.
- Updated the authoritative orchestration contract and cutover roadmap.

## Validation evidence

- `pnpm agent:lint:fix`
- `pnpm --filter @popcorn/api typecheck`
- `pnpm exec tsx --test` over Audio fit, Audio profile, proposal delegation,
  generated-asset nested admission, Audio rerun executor, and rerun
  lifecycle-focused suites: 52 passing with 8 database-gated tests skipped
  when local Supabase is not configured across the final focused runs.
- Full repository validation and application-path smoke passed before the
  independent review. The review found three DB-causation/accounting blockers;
  the nested canonical reservation, pooled fit, and callback-causation changes
  above resolve them. Final independent re-review approved the hardened lane.
- On 2026-07-31, the branch first rebased its six implementation commits from
  merge base `41031195` onto `main` at `4c6e5779`; `git range-diff` reported all
  six rewritten commits as patch-equivalent.
- After PR #844 merged at `ef74950c`, rebased with `--onto` to drop the four
  duplicated lifecycle commits and replay only the two Audio commits plus this
  worksheet. That intermediate two-commit payload was patch-equivalent.
- When PR #850 advanced `main` to `ee404051`, rebased the three-commit PR again.
  Conflict resolution preserved PR #850's shared callback/Visual budget APIs
  and composed them with Audio's nested budget reservation fallback. Audio
  reservation keys remain derived from durable provider/action causation rather
  than trusted callback input.
- Post-rebase checks passed: `pnpm agent:lint:fix`,
  `pnpm --filter @popcorn/api typecheck`, the six focused Audio/rerun suites
  (53 passing, 8 database-gated skips), and
  `pnpm agent:validate -- --scope api`.
- The affected application path started locally with `AUTH_MODE=local`; a real
  `GET /api/v1/health` request returned HTTP 200 before graceful shutdown.
- Post-PR-844 conflict rebase checks passed: API and shared typechecks, the six
  focused Audio/rerun suites (55 passing, 8 database-gated skips), and a fresh
  local-auth API health request returning HTTP 200. Final
  `pnpm agent:validate -- --scope api` also passed.
- Final PR #850 integration checks passed: API/shared typechecks and the focused
  Audio, generated-asset, lifecycle, delegation, and Visual-still suites (63
  passing, 11 database-gated skips). A fresh local-auth API health request again
  returned HTTP 200, and `pnpm agent:validate -- --scope api` passed against the
  final integrated tree.

## Independent reviews

- Research/plan checkpoint reviewer slots were occupied by the three explicit
  parallel cutover lanes; an independent adapter agent performed the
  implementation and wrap-up reviews once its lane reached validation.
- Independent implementation review initially requested changes: domain
  callbacks lacked DB-provable primitive/budget causation, budget allocation
  bypassed canonical pricing, and fit retries could duplicate a critique.
- Final re-review approved after canonical nested provider reservations,
  exact execution-parent causation loading, pooled zero-cost fit admission, and
  deterministic fit artifact replay were implemented.
- Conflict research and plan review confirmed the apparent conflicts came from
  replaying four PR #844 commits already present in `main`; it approved dropping
  those duplicates while preserving the two patch-equivalent Audio commits and
  PR #844's reviewed lifecycle/RLS hardening.
- The first wrap-up review caught PR #850 advancing `main` before publication,
  so the stale-base result was not pushed and the branch was rebased again.

## Blockers and risks

- PR #844 is merged into `main`; PR #848 now contains only its Audio-specific
  payload and worksheet commits on top of that reviewed lifecycle foundation.
- PR 4's dispatch-finalization guard must land before PR 5 activates any
  proposal-origin domain adapter; it prevents ordinary child finalization from
  applying the shared work dispatch before fenced `completeWork`.
- Provider-backed production spend is not authorized for this adapter-only PR.

## Next action / handoff

- Keep PR #848 ready for review against `main`, and keep the production registry
  inert until PR 4's dispatch guard and PR 5's activation land.
