# Feedback: WEB-20260807-DASHBOARD-PERCEIVED-PERFORMANCE

<!-- agent-summary: Perceived performance depends on acknowledging intent before the network settles. -->
<!-- agent-summary: TanStack cache identity must include every auth boundary that affects visible data. -->
<!-- agent-summary: Persisted query seeds need short TTLs, runtime validation, and explicit field allowlists. -->
<!-- agent-summary: Successful fetches alone may renew a persisted server-state snapshot. -->
<!-- agent-summary: Background refresh errors should retain useful content and expose an in-place retry. -->
<!-- agent-summary: Status timestamps must describe projection freshness without overstating creative progress. -->
<!-- agent-summary: This feedback ships with worksheet WEB-20260807-DASHBOARD-PERCEIVED-PERFORMANCE. -->

## Lesson

The most damaging latency state is not a long request by itself; it is a long
request with no acknowledgment. A saved-draft row can remain the stable visual
anchor while its detail loads: keep focus, change the secondary copy to
“Opening draft…”, fence duplicate resume/delete actions, and make failure an
explicit retry rather than leaving the row inert. Request identity must also
include navigation intent so a late response cannot reclaim a route the creator
already left.

Server-state persistence needs the same rigor as the API boundary. A dashboard
snapshot is useful only after resolving the exact actor and workspace, and its
TanStack key must carry both identities too; fixing storage isolation without
fixing the in-memory key still permits an auth-boundary flash. The snapshot is a
versioned allowlisted DTO with a short tab-scoped lifetime, excludes signed
delivery URLs, fails closed on malformed/future/oversized data, and renews only
inside a successful authoritative fetch.

Stale-while-refresh presentation should preserve the user's reading and focus.
Routine polling remains quiet, a failed Home refresh adds one nonblocking retry
notice, and retry activation acknowledges itself immediately without allowing
repeat requests. `updatedAt` is labeled “Status updated” because orchestration
or recovery bookkeeping may move that timestamp even when no new creative work
is visible.

## Follow-up

- Local Supabase `/me` resolution still gates access to the actor/workspace
  snapshot and can take roughly 15 seconds under the observed database
  contention. Improving that bootstrap requires a separate authenticated
  identity/performance investigation; this pass deliberately does not persist
  `/me` or weaken the identity boundary.
- The existing recovery-enabled local worker continues to produce upstream and
  statement timeouts. Keep that backend issue separate from the UI fallback so
  retained content does not hide operational health work.
- When merging the dedicated Script creation flow, preserve the dashboard and
  draft-opening E2E documentation but replace the superseded fourth-choice
  Script description with the new `/create/script` behavior. Auto-merged query
  keys remain compatible because the dashboard key is actor/workspace scoped
  while the Script blueprint key is project scoped.
