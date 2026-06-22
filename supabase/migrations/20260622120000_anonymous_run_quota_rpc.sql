-- Atomically enforce the anonymous generation quota at run creation time.
-- The advisory transaction lock is scoped to the project's workspace so
-- concurrent anonymous starts cannot both observe the same pre-insert count.

create or replace function public.create_orchestrator_run_with_anonymous_quota(
  p_project_id uuid,
  p_input_summary text,
  p_budget_usd double precision,
  p_window_start timestamptz,
  p_limit integer,
  p_deploy_id text default null,
  p_git_sha text default null
)
returns table (
  run_id uuid,
  quota_exceeded boolean
)
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

  select p.workspace_id
    into v_workspace_id
  from public.projects p
  where p.id = p_project_id;

  if v_workspace_id is null then
    raise exception 'project not found: %', p_project_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text, 0));

  select count(*)::integer
    into v_run_count
  from public.orchestrator_runs r
  join public.projects p on p.id = r.project_id
  where p.workspace_id = v_workspace_id
    and r.created_at >= p_window_start;

  if v_run_count >= p_limit then
    run_id := null;
    quota_exceeded := true;
    return next;
    return;
  end if;

  insert into public.orchestrator_runs (
    schema_version,
    project_id,
    status,
    input_summary,
    budget_usd,
    spent_usd,
    deploy_id,
    git_sha
  )
  values (
    'orchestrator_run.v1',
    p_project_id,
    'queued',
    p_input_summary,
    p_budget_usd,
    0,
    p_deploy_id,
    p_git_sha
  )
  returning id into run_id;

  quota_exceeded := false;
  return next;
end;
$$;
