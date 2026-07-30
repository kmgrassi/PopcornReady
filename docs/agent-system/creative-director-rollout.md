# Creative-director rollout and observation

<!-- agent-summary: Creative-director routing is mandatory for every executable root run. -->
<!-- agent-summary: Every new root uses the creative_director role; environment variables cannot select flat ownership. -->
<!-- agent-summary: Flat and null-profile roots remain readable terminal history but cannot execute. -->
<!-- agent-summary: Asset Studio remains operationally separate from root hierarchy routing. -->
<!-- agent-summary: Project-scoped Request Changes enters the durable proposal lifecycle. -->
<!-- agent-summary: Application routing is role-based and no longer reads or writes a root profile. -->
<!-- agent-summary: PR 7B removes the temporary database-only compatibility profile after PR 7A rollout. -->

## Operating rule

New and anonymous root creation always uses the `creative_director` agent role.
Environment variables cannot change root ownership. Application code no longer
reads or writes `root_execution_profile`; the PR 7A database trigger fills it
only for omitted Creative Director root inserts while older binaries overlap.
Nonterminal flat/null history is canceled rather than rewritten, and terminal
history remains readable.

Project-scoped Request Changes uses the proposal lifecycle to resolve targets,
approve cost and blast radius, execute bounded child work, and reconcile
outputs. The removed revision and stage-restart routes cannot revive legacy
roots. Visuals and Audio sessions retain their serialized creator-direct and
root-origin behavior.

`GET /api/v1/health` reports liveness and creator-direct database readiness; it
no longer exposes the retired hierarchy rollout or fallback window. Worker and
domain events use durable role, run, action, and session causation rather than
the compatibility profile.

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

## PR 7A transitional monitoring queries

Use these read-only queries only while the PR 7A compatibility column exists,
scoped to the cutover window. Join with application logs for model
decision/error details. PR 7B must remove or rewrite these queries when it drops
the column.

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
