-- Selective-regeneration PR 7A rolling-deploy bridge.
--
-- New application code no longer knows about root_execution_profile, while
-- the column, constraints, RPC signature, policies, and grants remain intact
-- until the separately deployed PR 7B schema retirement. The trigger lets old
-- and new binaries overlap without ever stamping a specialist child as root.

create or replace function public.fill_creative_director_root_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.agent_role = 'creative_director'
     and new.root_execution_profile is null then
    new.root_execution_profile := 'creative_director';
  end if;
  return new;
end;
$$;

drop trigger if exists orchestrator_runs_fill_root_profile
  on public.orchestrator_runs;
create trigger orchestrator_runs_fill_root_profile
before insert on public.orchestrator_runs
for each row execute function public.fill_creative_director_root_profile();

-- Replay the PR 0 retirement fence so a database restored from the rolling
-- window cannot expose active flat/null work to the role-only application.
do $$
declare
  v_root record;
begin
  for v_root in
    select id, project_id
      from public.orchestrator_runs
     where agent_role = 'creative_director'
       and root_execution_profile is distinct from 'creative_director'
       and status in ('queued', 'running', 'waiting')
  loop
    perform public.cancel_orchestrator_run_family(v_root.project_id, v_root.id);
  end loop;
end;
$$;

with recursive legacy_family(id) as (
  select r.id
    from public.orchestrator_runs r
   where r.agent_role = 'creative_director'
     and r.root_execution_profile is distinct from 'creative_director'
  union
  select child.id
    from public.orchestrator_runs child
    join legacy_family parent
      on child.parent_run_id = parent.id or child.continues_run_id = parent.id
)
update public.orchestrator_dispatches d
   set status = 'completed',
       lease_token = null,
       lease_expires_at = null,
       pending_wake_at = null,
       updated_at = now()
 where d.orchestrator_run_id in (select id from legacy_family)
   and d.status is distinct from 'completed';

-- Role-only application routing no longer has the profile available to reject
-- terminal legacy roots before a continuation handler starts mutating state.
-- Close the two remaining continuation surfaces while the profile still exists:
-- reached review gates and insufficient-credit retries. Preserve the original
-- run/action errors as readable history; changing the run to canceled makes the
-- retry route reject before it can supersede an action.
update public.orchestrator_run_gates g
   set status = 'rejected',
       decided_at = coalesce(g.decided_at, now()),
       updated_at = now()
  from public.orchestrator_runs r
 where r.id = g.orchestrator_run_id
   and r.agent_role = 'creative_director'
   and r.root_execution_profile is distinct from 'creative_director'
   and r.status in ('succeeded', 'failed', 'canceled', 'timed_out', 'superseded')
   and g.status = 'reached';

update public.orchestrator_runs r
   set status = 'canceled',
       wait_reason = null,
       updated_at = now()
 where r.agent_role = 'creative_director'
   and r.root_execution_profile is distinct from 'creative_director'
   and r.status = 'failed'
   and (
     r.error ->> 'kind' = 'insufficient_credits'
     or exists (
       select 1
         from public.actions a
        where a.id = (
          select latest.id
            from public.actions latest
           where latest.orchestrator_run_id = r.id
             and latest.status = 'failed'
             and latest.superseded_at is null
           order by latest.created_at desc, latest.id desc
           limit 1
        )
          and a.error ->> 'kind' = 'insufficient_credits'
     )
   );
