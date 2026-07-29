# Agent Feedback Log

<!-- agent-summary: Append one concise entry after every completed durable agent task. -->
<!-- agent-summary: Entries capture workflow friction and improvements, not a duplicate task narrative. -->
<!-- agent-summary: Commit entries with their implementation and worksheet. -->
<!-- agent-summary: Review this log interactively at least monthly. -->
<!-- agent-summary: Turn repeated problems into a scoped task in TODOS.md. -->
<!-- agent-summary: Do not include secrets, private prompts, or customer data. -->
<!-- agent-summary: Delivery lead owns periodic synthesis. -->

## Template

```md
### YYYY-MM-DDTHH:mm:ss±HH:mm — <WORKSHEET_ID>
- What helped:
- Friction or failure:
- Suggested improvement:
- Follow-up: <TODO / PR / none>
```

### 2026-07-29T00:00:00-04:00 — PR-807-20260729-01
- What helped: Current `main` already contained the same route-helper refactor and its subsequent runtime-control updates, making the safe resolution directly inspectable.
- Friction or failure: The old PR introduced a second helper module that would duplicate the newer ownership boundary if retained.
- Suggested improvement: Rebase helper-extraction PRs promptly whenever their target file receives active parallel work.
- Follow-up: none.

### 2026-07-27T16:25:00-04:00 — API-20260727-04
- What helped: The atomic PR 6 report transaction made the missing counterpart for engine failures narrow and reviewable.
- Friction or failure: A generic orchestrator failure update could bypass the session claim fence after a stale or malformed domain completion.
- Suggested improvement: Keep every finite-domain terminal path behind an explicitly claim-fenced transport RPC and exercise it through the documented no-provider smoke before activation.
- Follow-up: Add write-scope authorization plus a local-Supabase full lifecycle smoke in the rollout PR.

### 2026-07-28T12:00:00-04:00 — WEB-20260728-PR13
- What helped: PR 12's explicit proposal and confirmation routes made the client boundary narrow and reviewable.
- Friction or failure: The initial dependency branch was only a placeholder; implementation could begin only after PR 820 supplied the actual contract.
- Suggested improvement: Merge or publish typed web-facing API contracts with API PRs so dependent UI worktrees do not need to infer response shapes.
- Follow-up: Enable the UI only after an API-side standalone feature flag and the remaining creator-direct follow-up endpoints exist.

### 2026-07-27T15:50:00-04:00 — API-20260727-04
- What helped: The merged PR 6/7 seams made it possible to prove the active root remains unchanged while introducing a fail-closed declarative domain configuration.
- Friction or failure: Independent implementation review exposed that context isolation is not write authorization and that session claim generations can disappear across an adapter boundary.
- Suggested improvement: Add an end-to-end contract test that follows the session generation from dispatch claim through bridge, job creation, callback, and terminal report before any domain runtime flag can be introduced.
- Follow-up: PR 8 continuation must add tool-write scope guards and provider-job claim propagation before activation.

### 2026-07-27T15:30:00-04:00 — API-20260727-02
- What helped: Thread-aware review retrieval plus the existing local transport suite made each lifecycle defect directly reproducible at the database boundary.
- Friction or failure: The local PostgREST stack intermittently returned an unstructured upstream error during the pre-existing concurrent idempotency drift test, even though the focused root, cancellation, and retry cases passed serially.
- Suggested improvement: Make the local integration runner serialize shared-stack tests by default and surface PostgREST upstream response bodies for failed RPC assertions.
- Follow-up: none.

### 2026-07-14T12:32:20-04:00 — API-20260714-02
- What helped: Treating the dispatch lease as the single turn owner exposed the inline-completion race clearly.
- Friction or failure: Inline provider completion could race invocation parking and wake duplicate engine turns.
- Suggested improvement: Route completion through a lease-fenced durable wake and validate the migration path with concurrency fixtures.
- Follow-up: Specialist-agent orchestration PRs 4–6 must extend the same lease and tenancy invariants.

### 2026-07-13T13:20:10-04:00 — AGENT-OPS-001
- What helped: Existing E2E inventory and repository conventions supplied a useful base.
- Friction or failure: No alternate-agent CLI is configured, so independent review is documented but not executed in this task.
- Suggested improvement: Configure `AGENT_REVIEW_COMMAND` for a provider different from the implementing agent.
- Follow-up: `TODOS.md` visual-regression and performance-baseline items.

### 2026-07-13T14:05:36-04:00 — AGENT-OPS-001
- What helped: The review surfaced two concrete command-line correctness gaps that were easy to reproduce with small shell smokes.
- Friction or failure: `pnpm --` forwarding and partially staged markdown made the first tooling cut validate the wrong content.
- Suggested improvement: Add a lightweight script-level regression harness for agent tooling so review-fix cases do not rely on ad hoc shell probes.
- Follow-up: none.

### 2026-07-14T10:06:38-04:00 — ARCH-20260714-01
- What helped: The new task router, isolated worktree, existing durability research, and independent checkpoints made the architecture dependencies explicit.
- Friction or failure: Tool ownership and counts are duplicated across types, prompts, documentation, and UI projections, making the current surface easy to misstate.
- Suggested improvement: Establish one canonical capability catalog and derive specialist registries, labels, gates, and detailed documentation from it.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 1–2.

### 2026-07-14T10:42:39-04:00 — ARCH-20260714-02
- What helped: Comparing the proposal to the concrete `driveLoop` injection seams separated reusable runtime mechanics from agent-role configuration.
- Friction or failure: “Persistent child agent” initially blurred a durable session identity with a finite terminal run and hid serialization/stale-result risks.
- Suggested improvement: Name session, assignment, run, message, and graph-state boundaries explicitly in every multi-agent architecture scope.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 4–8.

### 2026-07-14T11:18:46-04:00 — ARCH-20260714-03
- What helped: Treating standalone creation as a second entry mode into the same domain runtime exposed reusable session, provenance, and output contracts instead of creating three new generator silos.
- Friction or failure: “Run a sub-agent independently” initially left project ownership, approval, report recipient, shared-session contention, and selection movement underspecified.
- Suggested improvement: For every new agent entrypoint, require an origin/recipient matrix plus explicit queue, cost-gate, output-lineage, and selection semantics before designing routes or UI.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 4–13.

### 2026-07-14T11:25:49-04:00 — WEB-20260714-01
- What helped: Independent review caught the key CSS-module risk before moving keyframes and later caught untracked split files before PR creation.
- Friction or failure: Playwright browser cache revisions were mismatched, so visual smoke needed installed system Chrome instead of the managed binary.
- Suggested improvement: Add a repo script for local web smoke that selects an available browser executable and records the fallback.
- Follow-up: none.

### 2026-07-14T11:48:56-04:00 — ARCH-20260714-04
- What helped: Inspecting the live migrations and generated-assets path separated durable identities the system already owns from the one missing session boundary and the general action/asset integrity gap.
- Friction or failure: Naming a finite domain turn an “assignment” initially encouraged redundant assignment, report, output, queue, approval, job, and cost tables despite existing run/action/runtime records.
- Suggested improvement: Before adding agent-specific persistence, map every proposed lifecycle concept to the current schema and document the transactional, tenancy, privacy, and retry invariant that prevents reuse.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 4–6, 9–10, and 12.
### 2026-07-14T12:00:00-04:00 — TYPE-20260714-01
- What helped: The existing Remotion type definitions made the framework boundary and safe cast removal easy to verify with focused package typechecks.
- Friction or failure: Removing the renderer prop index signature was not compatible with Remotion's current `Composition` generic constraint, despite looking like a desirable tightening.
- Suggested improvement: Revisit the renderer prop contract when upgrading Remotion or when its component generics no longer require `Record<string, unknown>`.
- Follow-up: none

### 2026-07-14T12:27:05-04:00 — ORCH-20260714-02
- What helped: A focused shared module plus compile-time fixtures made canonical identity reuse, origin/recipient routing, and report/runtime separation reviewable before schema or runtime work.
- Friction or failure: Tool vocabulary counts had drifted across the North Star, operator harness, and historical implementation scopes, while the isolated worktree initially had no installed dependencies.
- Suggested improvement: Derive registry documentation and status projections from the code-owned capability catalog after PR 3, and initialize parallel worktrees with the offline package cache before validation.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PR 3.

### 2026-07-14T13:15:32-04:00 — ORCH-20260714-03
- What helped: Independent plan review caught the legacy regenerate projection fallback and forced recovery translation to stay pure, trusted-project scoped, fail-closed, and outside the flat runtime.
- Friction or failure: Tool identity was duplicated in one more invocation module than the initial map found, the driver and real flat registries have distinct historical insertion orders, and treating allowlisted hint keys as trusted targets initially left their string values untrusted.
- Suggested improvement: Keep catalog parity snapshots beside every model/UI projection, require server-authorized identity sets for any model-facing target projection, and initialize stacked worktrees from the offline package cache before implementation begins.
- Follow-up: `docs/scopes/specialist-agent-orchestration-prs.md` PRs 6–8 own runtime activation of the dormant registry and recovery boundaries.

### 2026-07-14T17:10:00-04:00 — PR782-20260714-01
- What helped: The unresolved review thread and existing type-test fixtures made the capability mismatch directly reproducible and easy to constrain without runtime changes.
- Friction or failure: A newly created worktree had no dependencies, so validation required a package install from the lockfile before checks could run.
- Suggested improvement: Add a standard dependency-bootstrap note or helper for caretaker worktrees.
- Follow-up: none.

### 2026-07-14T18:20:00-04:00 — PR-CARETAKER-20260714-01
- What helped: Isolating the PR branch kept unrelated dirty checkout changes out of the conflict resolution; the conflict was limited to the shared feedback log.
- Friction or failure: Fresh caretaker worktrees do not contain dependencies, so the lockfile install was required before validation.
- Suggested improvement: Add a standard dependency-bootstrap helper for caretaker worktrees.
- Follow-up: none.

### 2026-07-14T18:32:00-04:00 — PR-CARETAKER-20260714-01
- What helped: Rechecking branch protection after successful checks made the remaining merge blocker explicit.
- Friction or failure: `mergeable=true` does not imply mergeable under branch protection; `main` still requires one approving review.
- Suggested improvement: Include `mergeStateStatus` and required-review state in caretaker merge gates.
- Follow-up: none.

### 2026-07-14T22:54:34-04:00 — QA-20260714-01
- What helped: The manual browser guides, deployed commit in the health response, an existing guest fixture, and independent safety review made it possible to test production without provider spend.
- Friction or failure: The browser viewport capability needed a temporary CDP fallback, the auth-route pass ended the guest session, and the full API suite contains three unrelated merged-main failures.
- Suggested improvement: Add a repeatable read-only hosted smoke that records commit, route health, mobile overflow, and existing-run projection without depending on a transient browser session.
- Follow-up: Add a direct worker-completion wake assertion for `edit-video-asset-job.ts`; separately triage the three unrelated main-suite failures.

### 2026-07-15T15:10:00-04:00 — WEB-20260715-01
- What helped: The production failure shape and independent contract reviews exposed false midpoint progress, non-linear recovery, and incomplete-video success as one coherent UX problem.
- Friction or failure: Workspace summaries lack action evidence, and action timestamps record lifecycle changes rather than true worker heartbeats.
- Suggested improvement: Define terminal artifact invariants and evidence available per projection before designing progress copy.
- Follow-up: Consider real worker heartbeat data only if operators need provider-stall detection beyond last recorded activity.

### 2026-07-16T08:50:00-04:00 — API-20260716-02
- What helped: The PR 4 spec's explicit "do not add" list plus the running local 555xx stack made it possible to prove every invariant (origin XOR, sequence allocation, report uniqueness) against a real replayed migration history before opening the PR.
- Friction or failure: The TS contract uses `schemaVersion` while persisted JSONB checks require the repo's `schema_version` marker, and `ALTER TYPE ADD VALUE` cannot be consumed in the same migration transaction — both surfaced only at apply time.
- Suggested improvement: Document the persisted-JSONB `schema_version` marker convention and the enum-migration split rule next to the asset-graph JSONB rule in CLAUDE.md/AGENTS.md.
- Follow-up: PR 5 executes the documented action_assets dual-write/backfill/assert plan and must clear `wait_reason`/set `superseded_at` per the new constraints.

### 2026-07-16T08:55:00-04:00 — GEN-20260716-01
- What helped: The production run's raw `Object not found` message and persisted bucket metadata made the database/storage backend mismatch directly traceable before provider execution.
- Friction or failure: Existing handoff tests stopped at relational acceptance, and the async parking boundary discarded the underlying job error as a generic provider failure.
- Suggested improvement: Every cross-stage media handoff should prove the downstream worker can read stored bytes under the production database/storage backend combination.
- Follow-up: Keep the local Supabase + MinIO anchor/storyboard/keyframe integration in the required generation regression set.

### 2026-07-16T09:45:00-04:00 — GEN-20260716-01
- What helped: Thread-aware PR review data pinpointed the terminal async reconciliation branch, and a fake terminal job made retry behavior deterministic.
- Friction or failure: A recoverable resume initially created an unbounded fast-job retry path because each async resume resets the turn budget; the live local smoke was then blocked by repeated Supabase REST statement timeouts before media generation.
- Suggested improvement: Bound recoverable async retries in durable action history, and add a local-stack health check that verifies ordinary PostgREST reads/writes before spending provider credits.
- Follow-up: With explicit approval, reset the local Supabase test database and retry the 10-second live-provider smoke.

### 2026-07-16T14:00:00-04:00 — API-20260716-03
- What helped: Keeping the fresh graph reader, pure projections, target guards, and compaction in one isolated `orchestrator-context/` boundary made the PR 7 controls testable without conflicting with PR 5/6's sequential store ownership.
- Friction or failure: The broad API suite has three known merged-main failures, so the new observable fixture suite and scoped validation are the reliable regression signal for this PR.
- Suggested improvement: Keep every future domain write path calling the fail-closed target/closure guards in the same transaction as its asset, edge, or selection write.
- Follow-up: PRs 5/6 wire these guards into lifecycle transactions; PR 8 loads `loadDomainTurnProjection` at the finite-turn boundary.

### 2026-07-16T14:07:00-04:00 — PR-CARETAKER-20260716-01
- What helped: Thread-aware review data and isolated worktrees made it possible to fix all four actionable PR #795 findings and verify PR #794's outdated thread.
- Friction or failure: The merged PR advanced `main` and exposed a feedback-log conflict on PR #795 after its implementation push.
- Suggested improvement: Recheck mergeability after every caretaker comment resolution because branch protection and base updates can change during review.
- Follow-up: none.

### 2026-07-16T10:05:00-04:00 — API-20260716-04
- What helped: Starting at the pre-execution action boundary made the existing duplicate-action risk concrete and gave jobs one canonical initiating identity.
- Friction or failure: An independent review showed that in-process locks and local job-created guards are not enough for cross-instance retries, provider claims, or action-to-asset lineage.
- Suggested improvement: Design the database reservation, claim, and generated-asset provenance path as one crash-window testable transaction boundary before claiming idempotent orchestration behavior.
- Follow-up: Continue PR 5 with atomic idempotency reservation/consume, provider claim fencing, and canonical action propagation into generated assets.

### 2026-07-16T14:20:00-04:00 — API-20260716-04
- What helped: Thread-aware review retrieval isolated an FK violation caused by confusing ordinary tool-call correlation with an engine-reserved action identity.
- Friction or failure: The context exposed only `toolCallId`, so direct tool harnesses could accidentally persist a foreign key to an action row that never existed.
- Suggested improvement: Keep correlation IDs and durable identities as separate typed fields, and test both engine-reserved and direct-tool execution paths whenever a new durable link is added.
- Follow-up: Retain the remaining PR 5 cross-instance reservation, provider-claim, crash-recovery, and generated-asset provenance work as explicit blockers.

### 2026-07-16T16:00:00-04:00 — API-20260716-07
- What helped: Pure helper extraction and facade re-exports kept the route refactor behavior-preserving and easy to validate.
- Friction or failure: The branch's worksheet identifier collided with an unrelated main-branch worksheet during conflict resolution, so the branch record was renamed before committing.
- Suggested improvement: Reserve worksheet IDs across parallel worktrees before implementation begins.
- Follow-up: Keep the run-detail loading boundary as a separate future extraction.

### 2026-07-16T14:35:00-04:00 — PR-CARETAKER-20260716-02
- What helped: Rebase conflict inspection exposed a shared worksheet identifier rather than a product-code conflict.
- Friction or failure: Independent PRs used the same worksheet ID, which also collides with the worksheet tag namespace after merge.
- Suggested improvement: Reserve worksheet IDs when a worktree is created or include the PR scope in the identifier before implementation begins.
- Follow-up: Preserve `API-20260716-03` for merged PR 7 and use `API-20260716-04` for this PR 5 branch.

### 2026-07-16T15:10:00-04:00 — API-20260716-06
- What helped: Treating the idempotency row as a lease-backed reservation clarified the API-instance race without holding a transaction over producer work.
- Friction or failure: A lease token fences stale record writes but cannot by itself make a provider launch safe after a process crash; the dedicated job claim remains required follow-up work.
- Suggested improvement: Keep request reservation, provider claim, and generated-asset provenance as explicit separately-tested durability boundaries rather than implying one idempotency helper covers all three.
- Follow-up: Apply the migration and run the env-gated Postgres race test once the local Supabase database is healthy; then implement the provider-job claim fence.

### 2026-07-16T15:45:00-04:00 — API-20260716-06
- What helped: PR review isolated the distinction between a failed lease-renewal attempt and durable ownership loss.
- Friction or failure: Treating either renewal rejection or a false renewal result as final ownership loss skipped a valid token-fenced completion and could discard a successful response.
- Suggested improvement: Let the database token predicate make the final completion decision; use renewal only to extend an active lease, not to preemptively suppress completion.
- Follow-up: Keep provider-job claim fencing as the remaining protection for external side effects after a process crash.
### 2026-07-16T16:35:00-04:00 — TYPE-20260716-01
- What helped: A focused JSON sidecar boundary and a direct storage test made the type-safety improvement small and observable.
- Friction or failure: The API package test script always runs the full suite, exposing three unrelated baseline failures before the focused test was run directly.
- Suggested improvement: Add package-level support for selecting a single test file without appending the full glob.
- Follow-up: None for this PR; the full-suite failures remain outside this change.

### 2026-07-16T16:05:00-04:00 — API-20260716-06-provider-claim
- What helped: Separating the provider-launch fence from the existing recovery lease made the ambiguous external-call crash window explicit.
- Friction or failure: The generated-assets executor still used a process-local JSON job file, so a local mutex or recovery lease could not protect multiple API instances.
- Suggested improvement: Keep provider launch authority as typed, service-only job state and let recovery terminalize ambiguous running work instead of automatically replaying it.
- Follow-up: Add action-to-asset relation and edit-video parity only after the provider claim path is proven under a real Postgres race.

### 2026-07-16T16:20:00-04:00 — API-20260716-06-provider-claim
- What helped: Independent implementation review separated a durable provider-call fence from an expiring lease, revealing the long-running-call case before review.
- Friction or failure: A fixed stale timeout can falsely terminalize healthy provider work, and a preallocated action can remain nonterminal unless every post-claim failure finalizes it through the fenced job result.
- Suggested improvement: Pair every external-call claim with a service-owned renewable heartbeat and make action terminalization follow, rather than precede, the successful token-fenced job completion.
- Follow-up: Run the PostgreSQL claim race coverage once the local Supabase database accepts connections.

### 2026-07-16T16:45:00-04:00 — PR-CARETAKER-20260716-03
- What helped: Thread-aware review data identified that canonical action params and the eventual provider call could disagree when workspace defaults were resolved too late.
- Friction or failure: Claim renewal previously updated only lease metadata, leaving run observability's progress timestamp stale during healthy long-running provider work.
- Suggested improvement: Normalize durable job inputs at enqueue time and keep lease heartbeats mirrored into the projection fields used by operators.
- Follow-up: Re-run the focused API checks in CI or a worktree with dependencies installed.

### 2026-07-24T15:02:11Z — API-20260723-01
- What helped: Starting from the route's existing validation made the type improvement small and preserved the API error contract; the focused parser tests gave direct evidence for both valid and invalid bodies.
- Friction or failure: The worktree began without dependencies, and the full API suite still reports two unrelated guest-retention migration failures; the configured independent-review adapter is unavailable.
- Suggested improvement: Keep a lightweight request-body type at each API boundary and export pure parsers so route validation can be tested without database setup.
- Follow-up: Revisit the two guest-retention migration failures separately; configure an independent reviewer for future workflow checkpoints.

### 2026-07-27T10:15:00-04:00 — API-20260727-01
- What helped: The PR 4 schema tests and the merged #801/#805 slices made the remaining PR 5 surface (session store, claim transitions, fencing) very cleanly separable; exercising real store modules against the local stack caught behavior a mock suite would have missed.
- Friction or failure: Eight truly concurrent identical PK upserts through the local Kong gateway intermittently 502 ("invalid response from upstream server"); the bounded store retry the engine already uses is also the right fix in tests. The DB-gated generated-assets suite fails on a fresh local reset because its hard-coded workspace id is not seeded.
- Suggested improvement: Seed the local stack with the LOCAL_WORKSPACE_ID fixture (or make those tests create their workspace) so the Supabase-gated API suites are runnable after `supabase db reset --local`.
- Follow-up: PR 6 consumes claim/release + completeDomainRun for the turn-boundary dispatch transaction.

### 2026-07-27T15:30:00Z — API-20260727-03
- What helped: PR 5's claim/release/wake primitives composed directly into the two new SQL transactions; deterministic run ids (sha256 of the idempotency key) let the database's primary keys serialize concurrent duplicate dispatches with a one-retry replay in the service.
- Friction or failure: Adding delegate_visuals/delegate_audio to the typed catalog rippled through every flat surface (driver stubs, batteries, eval scenario tool lists, bridge stubs); the PRODUCTION_TOOL_NAMES/DISPATCH_TOOL_NAMES split contained it. The full API suite carries three pre-existing failures (guest-retention x2, discover public-id) — confirmed identical on unmodified origin/main via git stash.
- Suggested improvement: When extending a shared vocabulary, land the surface marker and the split name lists in the same change so "nothing user-visible changes in production" is an assertable invariant.
- Follow-up: PR 8 wires driveLoop domain completion to finalizeDomainTurn (replacing the fake report producer); PR 12 reuses dispatchDomainRun's gateStage/enqueue=false quote mode for creator-direct proposals.

### 2026-07-27T18:10:00Z — API-20260727-PR11
- What helped: Independent implementation review caught four authority/ordering failures that focused happy-path tests missed, including provider spend before source validation and beat audio consuming unrelated script scenes.
- Friction or failure: The local Supabase CLI reported a running stack while its Postgres socket timed out, so the migration and same-lineage integration tests could not execute locally.
- Suggested improvement: Keep every provider-backed revision's source/readiness checks before preflight or spend, and require tests with at least two scenes whenever a supposedly targeted media tool consumes script or plan content.
- Follow-up: PR 12 must derive exact creator-direct Audio targets and prove root/direct successor runs reuse one serialized Audio session; rerun the Supabase-gated revision test when the local database accepts connections.

### 2026-07-29T10:10:00-04:00 — WEB-20260729-ASSET-STUDIO
- What helped: Tracing the web gate separately from the always-mounted creator-direct API kept the production cutover small, and mock-backed Playwright proved the cost proposal does not dispatch before explicit confirmation.
- Friction or failure: The original Asset Studio worksheet recorded only unit/type checks, while the E2E harness starts an unconfigured local worker that emits Supabase errors even when every browser API path is mocked.
- Suggested improvement: Give route-only web E2E specs a web-only server mode, or disable background recovery workers when their API routes are not part of the test.
- Follow-up: Add provider-backed media smoke only with an approved production project and spend budget; retain optional references, follow-ups, dependency attachment, and Use in project as explicit Asset Studio gaps.

### 2026-07-29T11:57:49-04:00 — WEB-20260729-PROJECT-PICKER
- What helped: The approved interaction mock and independent review kept the picker native to Asset Studio while exposing the cache mismatch and stale-proposal race before handoff.
- Friction or failure: The initial custom listbox semantics exceeded the keyboard behavior implemented, and visual inspection found a mobile secondary-action label clipping that automated visibility checks did not expose.
- Suggested improvement: Prefer disclosure plus native button semantics for searchable short lists unless the full ARIA listbox keyboard model is explicitly in scope; include label-overflow checks in responsive form-control reviews.
- Follow-up: Consider a server-side project search parameter if workspaces routinely exceed the currently loaded project pages.

### 2026-07-29T14:30:00-04:00 — GEN-20260729-FULL-MIGRATION
- What helped: Comparing the shipped rerun service, Request Changes route, delegation adapter, and hierarchy registry against the old scopes exposed the exact gap between “graph foundation” and executable selective regeneration.
- Friction or failure: Multiple accepted scope documents had drifted behind `main`, and their partial PR sequences preserved fallbacks or depended on contracts that had already changed.
- Suggested improvement: When a multi-PR architecture lane reaches a cutover, add one authoritative completion roadmap, mark partial predecessors historical, and make deletion criteria part of the same plan.
- Follow-up: Start PR 0 (hierarchy lock) and PR 1 (model-backed graph proposal) in parallel from `docs/scopes/full-selective-regeneration-cutover-prs.md`.
