-- Guest retention: anonymous-owned projects expire 30 days after last activity.

alter table public.projects
  add column if not exists last_activity_at timestamptz not null default now();

comment on column public.projects.last_activity_at is
  'Retention heartbeat for guest cleanup. Visits/runs/edits update this timestamp; upgraded accounts are exempt.';

update public.projects
set last_activity_at = greatest(created_at, updated_at)
where last_activity_at is null;

create index if not exists projects_last_activity_idx
  on public.projects (last_activity_at)
  where status <> 'deleted';

create or replace function public.touch_project_row_activity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    new.last_activity_at := now();
  elsif new.last_activity_at is not distinct from old.last_activity_at then
    new.updated_at := now();
    new.last_activity_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.touch_project_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  if tg_op = 'DELETE' then
    v_project_id := old.project_id;
  else
    v_project_id := new.project_id;
  end if;
  if v_project_id is not null then
    update public.projects
    set last_activity_at = now()
    where id = v_project_id
      and status <> 'deleted';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists projects_touch_activity_self on public.projects;
create trigger projects_touch_activity_self
  before insert or update on public.projects
  for each row execute function public.touch_project_row_activity();

drop trigger if exists assets_touch_project_activity on public.assets;
create trigger assets_touch_project_activity
  after insert or update on public.assets
  for each row execute function public.touch_project_activity();

drop trigger if exists actions_touch_project_activity on public.actions;
create trigger actions_touch_project_activity
  after insert or update on public.actions
  for each row execute function public.touch_project_activity();

drop trigger if exists generation_runs_touch_project_activity on public.generation_runs;
create trigger generation_runs_touch_project_activity
  after insert or update on public.generation_runs
  for each row execute function public.touch_project_activity();

drop trigger if exists selections_touch_project_activity on public.selections;
create trigger selections_touch_project_activity
  after insert or update on public.selections
  for each row execute function public.touch_project_activity();

create or replace function public.list_expired_anonymous_projects(
  p_before timestamptz default now() - interval '30 days'
)
returns table (
  project_id uuid,
  workspace_id uuid,
  last_activity_at timestamptz,
  storage_bucket text,
  storage_key text,
  estimated_bytes bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    p.id as project_id,
    p.workspace_id,
    p.last_activity_at,
    a.storage_bucket,
    a.storage_key,
    case
      when a.source ? 'size' and (a.source ->> 'size') ~ '^[0-9]+$'
        then (a.source ->> 'size')::bigint
      when a.source ? 'sizeBytes' and (a.source ->> 'sizeBytes') ~ '^[0-9]+$'
        then (a.source ->> 'sizeBytes')::bigint
      when a.context ? 'sizeBytes' and (a.context ->> 'sizeBytes') ~ '^[0-9]+$'
        then (a.context ->> 'sizeBytes')::bigint
      else 0
    end as estimated_bytes
  from public.projects p
  join public.workspaces w on w.id = p.workspace_id
  join public.users u on u.id = w.owner_id
  join auth.users au on au.id = u.auth_id
  left join public.assets a on a.project_id = p.id
  where p.status <> 'deleted'
    and p.last_activity_at < p_before
    and au.is_anonymous is true;
$$;

revoke all on function public.list_expired_anonymous_projects(timestamptz) from public;
grant execute on function public.list_expired_anonymous_projects(timestamptz) to service_role;

create or replace function public.purge_expired_anonymous_projects(
  p_before timestamptz default now() - interval '30 days'
)
returns table (
  project_id uuid,
  workspace_id uuid,
  deleted_asset_count integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'purge_expired_anonymous_projects requires service_role'
      using errcode = '42501';
  end if;

  return query
  with eligible as (
    select p.id, p.workspace_id
    from public.projects p
    join public.workspaces w on w.id = p.workspace_id
    join public.users u on u.id = w.owner_id
    join auth.users au on au.id = u.auth_id
    where p.status <> 'deleted'
      and p.last_activity_at < p_before
      and au.is_anonymous is true
  ),
  asset_counts as (
    select e.id as project_id, count(a.id)::integer as deleted_asset_count
    from eligible e
    left join public.assets a on a.project_id = e.id
    group by e.id
  ),
  deleted_projects as (
    delete from public.projects p
    using eligible e
    where p.id = e.id
    returning p.id, p.workspace_id
  )
  select
    d.id as project_id,
    d.workspace_id,
    coalesce(c.deleted_asset_count, 0) as deleted_asset_count
  from deleted_projects d
  left join asset_counts c on c.project_id = d.id;
end;
$$;

revoke all on function public.purge_expired_anonymous_projects(timestamptz) from public;
grant execute on function public.purge_expired_anonymous_projects(timestamptz) to service_role;
