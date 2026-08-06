# Production Read Observations — July and August 2026

<!-- agent-summary: This file preserves dated read-only production observations as historical evidence. -->
<!-- agent-summary: It is not living route coverage and does not authorize production mutation. -->
<!-- agent-summary: The August 1 pass inspected selected creator and owner/admin routes without form submission. -->
<!-- agent-summary: The July 14 pass verified specialist foundations and selected deployed read surfaces. -->
<!-- agent-summary: Neither pass had the cross-service release contract introduced by production-browser PR 1. -->
<!-- agent-summary: Limits and known gaps remain attached to the observation that produced them. -->
<!-- agent-summary: Current coverage truth lives in the E2E inventory and typed application route registry. -->

## Production UX audit — 2026-08-01

This is point-in-time manual evidence, not automated E2E coverage or a current
production contract. A signed-in owner/admin session inspected `/dashboard`,
`/library/projects`, one existing `/projects/:projectId` overview, `/settings`,
`/create`, and `/projects/new` at desktop width. Only the existing project
overview was also checked at 390-by-844 mobile dimensions.

The pass submitted no forms or mutation controls, started no generation, and
changed no settings, uploads, approvals, or provider configuration. The final
inspected route had no captured console warnings or errors. The owner/admin
identity means role-gated provider smoke testing and secondary links were visible;
that observation is not evidence that ordinary creators see those controls.

Limits and remaining gaps:

- The pass did not capture a deployed commit, health response, or other immutable
  release identity, so it cannot be tied to a specific Netlify/Railway release.
- The console observation covered only the final inspected tab state, not every
  route's complete console and network history.
- Only one authenticated route received the mobile-width check.
- No global no-write assertion was available. Login, token refresh, signed-URL
  minting, and route activity may write even during a read-oriented pass.
- No detector overlay was injected, and the release-gated production harness
  was not implemented at the time of the observation.

## Specialist-foundation verification — 2026-07-14

This section is point-in-time evidence, not the current production coverage
contract. The detailed production-safe pass after GitHub PRs 782, 783, and 784
merged ran on their merge snapshot
`08feca51cdadd302f6e5590a222b2ce9e1157d3b`. After `main` advanced, health,
landing, and authenticated dashboard smoke were refreshed on deployed head
`eb2245d670422db56faa0fdb0fe8034d28779a8a`, which contains that specialist
snapshot. The browser covered the landing, login, signup, not-found, dashboard,
Library projects, Activity, project-creation entry, and an existing failed-run
detail surface. No mutation control or billable action was submitted; loading
the existing run did perform the route's normal project-activity recording.

Observed results:

- `/api/v1/health` returned `200`, `status: "ok"`, `authMode: "supabase"`, and
  current deployed commit `eb2245d670422db56faa0fdb0fe8034d28779a8a` through
  the production browser context.
- `/api/v1/dev/tool-tests` did not expose batteries. A signed-out read fell
  through to the production auth guard with `403 Missing credentials`; the
  dev-only harness never returned `200`.
- Public and authenticated read surfaces rendered without console warnings or
  unexpected 4xx/5xx responses. Login and signup submissions stayed disabled
  while their required fields were empty, and the unknown route rendered the
  Vite not-found placeholder.
- The existing failed run retained its status, 50% progress, readable failure,
  completed storyboard assets and familiar stage labels. The historical restart
  controls described by that deployment are now deleted; current coverage
  asserts Request Changes proposal behavior instead. A 390-by-844 mobile
  emulation showed no document-level horizontal overflow on the dashboard or
  run-detail route.
- Contract type checks, the catalog/registry/recovery/projection suite (27/27),
  async-resume unit suite (34/34 with the database integration case skipped in
  the default environment), and the separately enabled local-Supabase dispatch
  integration test (1/1) passed.
- The hosted `Apply Supabase migrations` workflow succeeded for PR 783's merge
  commit `30601df2`, including the lease-safe dispatch-wake migration.
- Current-head Railway verification and Web E2E workflows succeeded for
  `eb2245d6` after the branch advanced.

Limits and remaining gaps:

- PR 782 intentionally has no runtime or UI path. Its origin, recipient,
  identifier, task, report, and state guarantees are compile-time contracts.
- Historical PR 784 evidence: that PR kept the flat production registry active,
  so its then-dormant role registries could not yet be claimed as production
  specialist-agent behavior. The later hierarchy cutover activated role-owned
  registries, and PR 7A deleted the flat production registry.
- No already-running production job completed during the safe observation
  window. PR 783's exact live completion race was therefore verified by unit and
  local-Supabase concurrency tests, not by starting billable production work.
- Add a focused worker-completion test proving `edit-video-asset-job.ts` wakes
  the durable orchestrator dispatch. The other changed async worker families
  already assert their enqueue/resume handoff directly.
- The full API suite was red on that snapshot for three unrelated baseline
  failures: two guest-retention tests referenced stale pre-renumbering migration
  filenames, and the public-project UUID-shape assertion failed. Those tests and
  source files were outside PRs 782-784; the affected specialist suites passed.

PR 7B root-profile retirement coverage recorded later:

- A migration contract test verifies legacy-family classification, causal
  cancellation, unresolved-gate closure, succeeded/failed root supersession,
  active rerun work/callback assertions, exact grants and role-only policies,
  profile-free routine replacement, no-`CASCADE` drop, and PostgREST reload.
- The required local database matrix includes both a clean 95-migration replay
  and a seeded PR 7A (`20260730180000`) upgrade. It proves migrated legacy
  storyboard and credit-retry fixtures cannot reopen while valid hierarchy
  approval/retry controls still work.
- The upgrade smoke also exercises direct superseded-row rejection, the
  seven-argument anonymous quota RPC, the profile-free reservation RPC,
  creator-direct readiness, health, and the five retired route families.
- That database migration did not add a browser-visible route or control, so a
  new Playwright case was not required.
