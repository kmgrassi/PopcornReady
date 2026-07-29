-- PR 18: a root run's model-visible surface must not change while it is
-- parked. New roots pin the selected profile; older rows remain NULL and are
-- deliberately treated as legacy flat roots by the API.

alter table public.orchestrator_runs
  add column root_execution_profile text;

alter table public.orchestrator_runs
  add constraint orchestrator_runs_root_execution_profile_check check (
    root_execution_profile is null
    or root_execution_profile in ('flat', 'creative_director')
  ),
  add constraint orchestrator_runs_domain_root_execution_profile_check check (
    agent_role = 'creative_director' or root_execution_profile is null
  );

create or replace function public.orchestrator_runs_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.project_id is distinct from old.project_id
     or new.agent_role is distinct from old.agent_role
     or new.agent_session_id is distinct from old.agent_session_id
     or new.session_sequence is distinct from old.session_sequence
     or new.task_kind is distinct from old.task_kind
     or new.task_params is distinct from old.task_params
     or new.origin_kind is distinct from old.origin_kind
     or new.parent_run_id is distinct from old.parent_run_id
     or new.root_action_id is distinct from old.root_action_id
     or new.origin_actor_id is distinct from old.origin_actor_id
     or new.origin_request is distinct from old.origin_request
     or new.continues_run_id is distinct from old.continues_run_id
     or (old.pins is not null and new.pins is distinct from old.pins)
     or (old.root_execution_profile is not null
         and new.root_execution_profile is distinct from old.root_execution_profile)
     or (old.root_execution_profile is null
         and new.root_execution_profile is not null
         and old.started_at is not null)
  then
    raise exception 'orchestrator run assignment identity is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Anonymous quota admission must pin the same profile in its one transaction.
-- Replace rather than overload the RPC so PostgREST has one unambiguous name.
drop function public.create_orchestrator_run_with_anonymous_quota(
  uuid, text, double precision, timestamptz, integer, text, text
);

create function public.create_orchestrator_run_with_anonymous_quota(
  p_project_id uuid,
  p_input_summary text,
  p_budget_usd double precision,
  p_window_start timestamptz,
  p_limit integer,
  p_deploy_id text default null,
  p_git_sha text default null,
  p_root_execution_profile text default 'flat'
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
  if p_root_execution_profile is null
     or p_root_execution_profile not in ('flat', 'creative_director') then
    raise exception 'invalid root execution profile';
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
    p_deploy_id, p_git_sha, p_root_execution_profile
  ) returning id into run_id;
  quota_exceeded := false;
  return next;
end;
$$;
