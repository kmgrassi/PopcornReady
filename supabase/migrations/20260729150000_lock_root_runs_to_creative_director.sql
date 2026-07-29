-- Selective-regeneration roadmap PR 0: flat/null roots are readable history,
-- never executable work. This migration is intentionally replay-safe.

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

-- Preserve the RPC signature until the profile column is removed in roadmap
-- PR 7, but make its only accepted/default value server-owned hierarchy.
create or replace function public.create_orchestrator_run_with_anonymous_quota(
  p_project_id uuid,
  p_input_summary text,
  p_budget_usd double precision,
  p_window_start timestamptz,
  p_limit integer,
  p_deploy_id text default null,
  p_git_sha text default null,
  p_root_execution_profile text default 'creative_director'
)
returns table (run_id uuid, quota_exceeded boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_run_count integer;
begin
  if p_limit < 1 then
    raise exception 'anonymous run quota limit must be positive';
  end if;
  if p_root_execution_profile is distinct from 'creative_director' then
    raise exception 'creative_director root execution profile required';
  end if;

  select p.workspace_id into v_workspace_id from public.projects p where p.id = p_project_id;
  if v_workspace_id is null then
    raise exception 'project not found: %', p_project_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text, 0));

  select count(*)::integer into v_run_count
  from public.orchestrator_runs r
  join public.projects p on p.id = r.project_id
  where p.workspace_id = v_workspace_id and r.created_at >= p_window_start;
  if v_run_count >= p_limit then
    run_id := null;
    quota_exceeded := true;
    return next;
    return;
  end if;

  insert into public.orchestrator_runs (
    schema_version, project_id, status, input_summary, budget_usd, spent_usd,
    deploy_id, git_sha, root_execution_profile
  ) values (
    'orchestrator_run.v1', p_project_id, 'queued', p_input_summary, p_budget_usd, 0,
    p_deploy_id, p_git_sha, 'creative_director'
  ) returning id into run_id;
  quota_exceeded := false;
  return next;
end;
$$;
