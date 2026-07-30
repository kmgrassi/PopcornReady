# Creative-director rollout and observation

<!-- agent-summary: Creative-director routing is mandatory for every executable root run. -->
<!-- agent-summary: Every new root pins creative_director; environment variables cannot select flat ownership. -->
<!-- agent-summary: Flat and null-profile roots remain readable terminal history but cannot resume. -->
<!-- agent-summary: Asset Studio remains operationally separate from root hierarchy routing. -->
<!-- agent-summary: Project-scoped Request Changes starts a fresh hierarchy root when history is legacy. -->
<!-- agent-summary: Run-scoped gate, retry, revision, recovery, and resume paths reject legacy roots. -->
<!-- agent-summary: PR 7 removes the retained historical profile column and flat registry implementation. -->

## Operating rule

New and anonymous root creation always persists `creative_director`.
Environment variables cannot change root ownership. The profile remains
immutable: nonterminal flat/null test history is canceled by migration rather
than rewritten, and terminal history remains readable.

Project-scoped Request Changes may preserve creator intent by creating a fresh
hierarchy root. Run-scoped gate decisions, credit retries, board revisions,
recovery, and explicit resume reject legacy roots because their gates and
actions cannot be transplanted safely. Visuals and Audio sessions retain their
existing serialized creator-direct and root-origin behavior.

`GET /api/v1/health` reports liveness and creator-direct database readiness; it
no longer exposes the retired hierarchy rollout or fallback window. Worker
events attribute claimed hierarchy roots to their persisted profile and
explicitly log refused legacy dispatches; domain runs retain their own
role/session attribution.

## Cutover observation

The Creative Systems on-call owns observation and incident response. Testing
must use controlled projects, avoid duplicate billable actions, and preserve
project data for diagnosis.

During production testing, evaluate:

| Signal | Threshold | Action when breached |
| --- | --- | --- |
| Root decision errors or premature completion | No more than the recorded flat baseline +2 percentage points; no family loses more than 5 points | Pause new production roots and page Creative Systems |
| Child finite-run terminal failures / blind retries | No additional repeated-failed-call samples; no untriaged terminal-failure spike | Pause new production roots and investigate |
| Duplicate billable actions/jobs | 0 | Pause new production roots immediately and reconcile affected projects |
| Cross-origin session claim/contention failures | 0 stale claim mutations; all queued work visibly serializes | Pause affected projects and investigate fencing |
| Estimated model/provider cost and export failure rate | At or below the recorded flat baseline +5%; no unexplained export regression | Pause new production roots if creator impact persists |

Run the provider-neutral export, Request Changes (visual/audio/pacing), and
root-versus-creator-direct contention smoke during cutover observation. Never
send a duplicate live billable request merely to compare paths.

## Monitoring queries

Use these read-only queries in the production Supabase SQL console, scoped to
the cutover window. Join with application logs for model decision/error details.

```sql
select root_execution_profile, status, count(*)
from orchestrator_runs
where agent_role = 'creative_director' and created_at >= :cutover_start
group by 1, 2 order by 1, 2;

select parent.root_execution_profile, child.agent_role, child.status, count(*)
from orchestrator_runs child
join orchestrator_runs parent on parent.id = child.parent_run_id
where child.origin_kind = 'creative_director' and child.created_at >= :cutover_start
group by 1, 2, 3 order by 1, 2, 3;

select agent_session_id, count(*) as queued_or_active_runs
from orchestrator_runs
where agent_session_id is not null
  and status in ('queued', 'running', 'waiting')
group by 1 having count(*) > 1;
```

## Evidence and final cleanup

Record the cutover start UTC, production test results, dashboard snapshots, and
any incident. The health metadata, historical flat registry, and application
profile type are removed in PR 7A. Its temporary root-aware insert trigger
supports the rolling deploy; PR 7B removes that trigger and the retained profile
column only after every production caller ignores it.
