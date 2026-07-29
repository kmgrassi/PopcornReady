# Creative-director rollout and soak

<!-- agent-summary: PR 18 keeps creative-director routing opt-in until Gate-0 evidence clears the default-on cutover. -->
<!-- agent-summary: Each root run pins flat or creative_director so a rollback cannot alter in-flight behavior. -->
<!-- agent-summary: POPCORN_CREATIVE_DIRECTOR_FLAT_FALLBACK and its UTC expiry are the only temporary emergency fallback. -->
<!-- agent-summary: Asset Studio is production-default and remains operationally separate from root hierarchy routing. -->
<!-- agent-summary: The Creative Systems on-call owns rollback, evidence capture, and the PR 19 cleanup recommendation. -->
<!-- agent-summary: A seven-day soak requires decision, child-run, contention, cost, and export thresholds to remain green. -->
<!-- agent-summary: Record Gate-0 paired-eval reports and the final cleanup decision before removing the flat surface. -->

## Operating rule

New root runs persist their selected execution profile; existing null-profile
rows remain flat. The hierarchy remains disabled by default until Gate-0
evidence is recorded as cleared. This makes profile selection auditable and
ensures an emergency fallback changes only roots created while it is active.
Visuals and Audio execution remains available to drain existing root work and
to serve the production-default Asset Studio independently of the root hierarchy
rollout.

After Gate 0 clears, activate hierarchy routing with
`POPCORN_CREATIVE_DIRECTOR_HIERARCHY=1`. To use the emergency flat fallback,
the Creative Systems on-call must set all three variables and record the
incident/change ticket:

```sh
POPCORN_CREATIVE_DIRECTOR_HIERARCHY=1
POPCORN_CREATIVE_DIRECTOR_FLAT_FALLBACK=1
POPCORN_CREATIVE_DIRECTOR_FLAT_FALLBACK_UNTIL=2026-08-04T18:00:00Z
```

The expiry must be an exact, calendar-valid UTC timestamp and in the future.
Missing, invalid, or expired values leave the hierarchy enabled. Remove the
fallback variables after recovery; do not extend the expiry without a new
incident record and an explicit owner.

`GET /api/v1/health` reports the active default and fallback expiry. Worker
events named `orchestrator_worker.rollout` attribute claimed root runs to their
persisted profile; domain runs retain their own role and session attribution.

## Soak plan

The seven-day production soak starts only after Gate-0’s paired real-model
reports are recorded on two separate days and the proposed regression threshold
is marked agreed. The Creative Systems on-call owns the dashboard, paging, and
rollback; the release manager records the final decision in the PR 18 evidence
section.

During the soak, evaluate daily and at the end of the window:

| Signal | Threshold | Action when breached |
| --- | --- | --- |
| Root decision errors or premature completion | No more than flat baseline +2 percentage points; no family loses more than 5 points | Activate expiring fallback and page Creative Systems |
| Child finite-run terminal failures / blind retries | No additional repeated-failed-call samples; no untriaged terminal-failure spike | Pause new hierarchy roots and investigate before extending fallback |
| Duplicate billable actions/jobs | 0 | Activate fallback immediately and reconcile affected projects |
| Cross-origin session claim/contention failures | 0 stale claim mutations; all queued work visibly serializes | Pause affected projects and investigate fencing |
| Estimated model/provider cost and export failure rate | At or below flat baseline +5%; no unexplained export regression | Activate fallback if creator impact persists |

Run the provider-neutral export, Request Changes (visual/audio/pacing), and
root-versus-creator-direct contention smoke before starting the clock. Never
send a duplicate live billable request merely to compare paths.

## Monitoring queries

Use these read-only queries in the production Supabase SQL console, scoped to
the soak window. Join with application logs for model decision/error details.

```sql
select root_execution_profile, status, count(*)
from orchestrator_runs
where agent_role = 'creative_director' and created_at >= :soak_start
group by 1, 2 order by 1, 2;

select parent.root_execution_profile, child.agent_role, child.status, count(*)
from orchestrator_runs child
join orchestrator_runs parent on parent.id = child.parent_run_id
where child.origin_kind = 'creative_director' and child.created_at >= :soak_start
group by 1, 2, 3 order by 1, 2, 3;

select agent_session_id, count(*) as queued_or_active_runs
from orchestrator_runs
where agent_session_id is not null
  and status in ('queued', 'running', 'waiting')
group by 1 having count(*) > 1;
```

## Evidence and cleanup decision

Record the two Gate-0 JSON reports, start/end UTC, daily dashboard snapshots,
smoke results, any fallback incident, and a final **retain/remove fallback**
decision in the PR 18 worksheet. PR 19 may remove the flat surface only after
the seven-day soak holds and the release manager signs that record.
