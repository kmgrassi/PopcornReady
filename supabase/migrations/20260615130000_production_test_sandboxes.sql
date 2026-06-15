-- Production E2E test sandboxes.
--
-- Lets production host isolated, labeled test workspaces/projects for deploy
-- smoke tests without relying on name-prefix conventions or customer data.
-- The live run model is orchestrator_runs; generation_runs was retired by the
-- previous migration and must not be restored.

set check_function_bodies = off;

create type public.workspace_purpose as enum ('user', 'internal_test', 'fixture');

alter table public.workspaces
  add column purpose public.workspace_purpose not null default 'user',
  add column expires_at timestamptz;

create index workspaces_purpose_expires_at_idx
  on public.workspaces (purpose, expires_at)
  where purpose <> 'user';

comment on column public.workspaces.purpose is
  'Classifies customer workspaces separately from internal production-test and fixture workspaces.';
comment on column public.workspaces.expires_at is
  'Optional cleanup deadline for non-customer workspaces.';

-- Deploy/build metadata for production smoke tests and post-deploy debugging.
alter table public.orchestrator_runs
  add column deploy_id text,
  add column git_sha text;

create index orchestrator_runs_deploy_id_idx
  on public.orchestrator_runs (deploy_id)
  where deploy_id is not null;
create index orchestrator_runs_git_sha_idx
  on public.orchestrator_runs (git_sha)
  where git_sha is not null;

alter table public.jobs
  add column deploy_id text,
  add column git_sha text;

create index jobs_deploy_id_idx
  on public.jobs (deploy_id)
  where deploy_id is not null;
create index jobs_git_sha_idx
  on public.jobs (git_sha)
  where git_sha is not null;

alter table public.eval_runs
  add column deploy_id text;

create index eval_runs_deploy_id_idx
  on public.eval_runs (deploy_id)
  where deploy_id is not null;

-- A sandbox owns exactly one test workspace and one initial test project. More
-- projects can exist under the workspace, but the initial project is the
-- canonical E2E entry point for deploy smoke tests.
create table public.test_sandboxes (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  project_id     uuid not null references public.projects (id) on delete cascade,
  created_by     uuid references public.users (id) on delete set null,
  purpose        text not null check (btrim(purpose) <> ''),
  git_sha        text,
  deploy_id      text,
  feature_set    text[] not null default '{}',
  status         text not null default 'active'
                 check (status in ('active', 'completed', 'failed', 'expired')),
  expires_at     timestamptz not null default (now() + interval '24 hours'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id),
  unique (project_id)
);

create index test_sandboxes_status_expires_at_idx
  on public.test_sandboxes (status, expires_at);
create index test_sandboxes_deploy_id_idx
  on public.test_sandboxes (deploy_id)
  where deploy_id is not null;
create index test_sandboxes_git_sha_idx
  on public.test_sandboxes (git_sha)
  where git_sha is not null;

create trigger test_sandboxes_set_updated_at
  before update on public.test_sandboxes
  for each row execute function public.set_updated_at();

create or replace function public.validate_test_sandbox_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_purpose public.workspace_purpose;
  v_project_workspace_id uuid;
begin
  select w.purpose into v_workspace_purpose
  from public.workspaces w
  where w.id = new.workspace_id;

  if v_workspace_purpose is null then
    raise exception 'test sandbox workspace does not exist (%)', new.workspace_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_workspace_purpose <> 'internal_test' then
    raise exception 'test sandbox workspace % must have purpose internal_test', new.workspace_id
      using errcode = 'check_violation';
  end if;

  select p.workspace_id into v_project_workspace_id
  from public.projects p
  where p.id = new.project_id;

  if v_project_workspace_id is null then
    raise exception 'test sandbox project does not exist (%)', new.project_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_project_workspace_id is distinct from new.workspace_id then
    raise exception 'test sandbox project workspace % does not match sandbox workspace %',
      v_project_workspace_id, new.workspace_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger test_sandboxes_validate_refs
  before insert or update of workspace_id, project_id on public.test_sandboxes
  for each row execute function public.validate_test_sandbox_refs();

alter table public.test_sandboxes enable row level security;

-- Service-role only: production smoke harnesses and cleanup jobs can manage
-- sandboxes without exposing internal fixtures to normal app users.
create or replace function public.delete_test_sandbox(p_sandbox_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'delete_test_sandbox requires service_role'
      using errcode = 'insufficient_privilege';
  end if;

  select ts.workspace_id into v_workspace_id
  from public.test_sandboxes ts
  join public.workspaces w on w.id = ts.workspace_id
  where ts.id = p_sandbox_id
    and w.purpose = 'internal_test';

  if v_workspace_id is null then
    return false;
  end if;

  delete from public.workspaces
  where id = v_workspace_id
    and purpose = 'internal_test';

  return found;
end;
$$;

create or replace function public.delete_expired_test_sandboxes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'delete_expired_test_sandboxes requires service_role'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.workspaces w
  using public.test_sandboxes ts
  where ts.workspace_id = w.id
    and w.purpose = 'internal_test'
    and ts.expires_at <= now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_test_sandbox(uuid) from public;
revoke all on function public.delete_expired_test_sandboxes() from public;
grant execute on function public.delete_test_sandbox(uuid) to service_role;
grant execute on function public.delete_expired_test_sandboxes() to service_role;

comment on table public.test_sandboxes is
  'Service-role-managed production E2E test sandboxes with isolated workspace/project roots.';
