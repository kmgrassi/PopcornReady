-- Claim-fenced terminal cleanup for an engine-owned finite domain turn.
-- A reclaimed worker must never fail a newer owner through the generic run API.
create or replace function public.fail_domain_run_turn(
  p_project_id uuid,
  p_run_id uuid,
  p_error jsonb,
  p_expected_claim_generation bigint
)
returns table (failed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.orchestrator_runs%rowtype;
  v_session public.agent_sessions%rowtype;
  v_rows integer := 0;
begin
  select * into v_run
    from public.orchestrator_runs r
   where r.id = p_run_id and r.project_id = p_project_id
   for update;
  if not found then
    raise exception 'domain run % not found', p_run_id using errcode = 'P0002';
  end if;
  if v_run.agent_session_id is null then
    raise exception 'run % is not a finite domain run', p_run_id using errcode = 'check_violation';
  end if;

  select * into v_session
    from public.agent_sessions s
   where s.id = v_run.agent_session_id
   for update;

  if v_run.status in ('succeeded', 'failed', 'canceled', 'timed_out', 'superseded') then
    return query select false;
    return;
  end if;
  if p_expected_claim_generation is null
     or v_session.active_run_id is distinct from p_run_id
     or v_session.claim_generation is distinct from p_expected_claim_generation then
    raise exception 'stale_domain_failure: run % no longer owns session claim', p_run_id
      using errcode = '55000';
  end if;

  update public.orchestrator_runs r
     set status = 'failed', completed_at = now(), wait_reason = null,
         error = p_error, updated_at = now()
   where r.id = p_run_id and r.status in ('queued', 'running', 'waiting');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return query select false;
    return;
  end if;

  update public.agent_sessions s
     set active_run_id = null,
         claim_generation = s.claim_generation + 1,
         updated_at = now()
   where s.id = v_session.id and s.active_run_id = p_run_id;

  update public.jobs j
     set status = 'canceled', updated_at = now()
   where j.project_id = p_project_id and j.status in ('queued', 'running')
     and exists (
       select 1 from public.actions a
        where a.id = j.action_id and a.orchestrator_run_id = p_run_id
     );

  if v_run.origin_kind = 'creative_director' then
    update public.actions a
       set status = 'failed', error = p_error, updated_at = now()
     where a.id = v_run.root_action_id and a.status in ('proposed', 'running');
    perform public.wake_orchestrator_dispatch(v_run.parent_run_id);
  end if;

  return query select true;
end;
$$;

revoke all on function public.fail_domain_run_turn(uuid, uuid, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.fail_domain_run_turn(uuid, uuid, jsonb, bigint)
  to service_role;
