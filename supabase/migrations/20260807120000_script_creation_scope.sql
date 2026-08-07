begin;

alter table public.orchestrator_runs
  add column creation_scope text not null default 'full_video';

alter table public.orchestrator_runs
  add constraint orchestrator_runs_creation_scope_check
  check (creation_scope in ('full_video', 'script'));

create or replace function public.guard_orchestrator_run_creation_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.creation_scope is distinct from old.creation_scope then
    raise exception 'orchestrator run creation scope is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger orchestrator_runs_guard_creation_scope
  before update of creation_scope on public.orchestrator_runs
  for each row execute function public.guard_orchestrator_run_creation_scope();

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
  p_creation_scope text default 'full_video'
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
  if p_creation_scope not in ('full_video', 'script') then
    raise exception 'invalid orchestrator run creation scope';
  end if;

  select p.workspace_id into v_workspace_id
    from public.projects p where p.id = p_project_id;
  if v_workspace_id is null then
    raise exception 'project not found: %', p_project_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text, 0));

  select count(*)::integer into v_run_count
    from public.orchestrator_runs run
    join public.projects project on project.id = run.project_id
      where project.workspace_id = v_workspace_id
        and run.created_at >= p_window_start;
  if v_run_count >= p_limit then
    run_id := null;
    quota_exceeded := true;
    return next;
    return;
  end if;

  insert into public.orchestrator_runs (
    schema_version, project_id, status, input_summary, budget_usd, spent_usd,
    deploy_id, git_sha, creation_scope
  ) values (
    'orchestrator_run.v1', p_project_id, 'queued', p_input_summary,
    p_budget_usd, 0, p_deploy_id, p_git_sha, p_creation_scope
  ) returning id into run_id;
  quota_exceeded := false;
  return next;
end;
$$;

notify pgrst, 'reload schema';

commit;
