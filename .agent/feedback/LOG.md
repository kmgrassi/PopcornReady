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
