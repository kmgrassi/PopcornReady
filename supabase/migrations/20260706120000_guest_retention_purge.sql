-- Guest retention: anonymous-owned projects expire 30 days after last activity.

alter table public.projects
  add column if not exists last_activity_at timestamptz not null default now();

alter table public.projects
  add column if not exists guest_retention_purge_claimed_at timestamptz;

comment on column public.projects.last_activity_at is
  'Retention heartbeat for guest cleanup. Visits/runs/edits update this timestamp; upgraded accounts are exempt.';

update public.projects
set last_activity_at = greatest(created_at, updated_at)
where last_activity_at is null;

create index if not exists projects_last_activity_idx
  on public.projects (last_activity_at)
  where status <> 'deleted';

create index if not exists projects_guest_retention_claim_idx
  on public.projects (guest_retention_purge_claimed_at)
  where guest_retention_purge_claimed_at is not null;

create or replace function public.touch_project_row_activity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    new.last_activity_at := now();
  elsif new.guest_retention_purge_claimed_at is distinct from old.guest_retention_purge_claimed_at then
    return new;
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

drop trigger if exists orchestrator_runs_touch_project_activity on public.orchestrator_runs;
create trigger orchestrator_runs_touch_project_activity
  after insert or update on public.orchestrator_runs
  for each row execute function public.touch_project_activity();

drop trigger if exists selections_touch_project_activity on public.selections;
create trigger selections_touch_project_activity
  after insert or update on public.selections
  for each row execute function public.touch_project_activity();

create or replace function public.claim_expired_anonymous_projects(
  p_before timestamptz default now() - interval '30 days',
  p_limit integer default 100
)
returns table (
  project_id uuid,
  workspace_id uuid,
  last_activity_at timestamptz,
  storage_bucket text,
  storage_key text,
  estimated_bytes bigint,
  deleted_asset_count integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'claim_expired_anonymous_projects requires service_role'
      using errcode = '42501';
  end if;

  return query
  with candidates as (
    select p.id
    from public.projects p
    join public.workspaces w on w.id = p.workspace_id
    join public.users u on u.id = w.owner_id
    join auth.users au on au.id = u.auth_id
    where p.status <> 'deleted'
      and p.guest_retention_purge_claimed_at is null
      and p.last_activity_at < p_before
      and au.is_anonymous is true
    order by p.last_activity_at asc
    limit greatest(coalesce(p_limit, 100), 1)
    for update of p skip locked
  ),
  newly_claimed as (
    update public.projects p
    set
      status = 'deleted',
      guest_retention_purge_claimed_at = now()
    from candidates c
    where p.id = c.id
    returning p.id
  ),
  claimed as (
    select p.id, p.workspace_id, p.last_activity_at
    from public.projects p
    where p.guest_retention_purge_claimed_at is not null
      and p.status = 'deleted'
      and (
        p.id in (select newly_claimed.id from newly_claimed)
        or p.last_activity_at < p_before
      )
    order by p.guest_retention_purge_claimed_at asc
    limit greatest(coalesce(p_limit, 100), 1)
  ),
  asset_counts as (
    select c.id as project_id, count(a.id)::integer as deleted_asset_count
    from claimed c
    left join public.assets a on a.project_id = c.id
    group by c.id
  )
  select
    c.id as project_id,
    c.workspace_id,
    c.last_activity_at,
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
    end as estimated_bytes,
    coalesce(ac.deleted_asset_count, 0) as deleted_asset_count
  from claimed c
  left join public.assets a on a.project_id = c.id
  left join asset_counts ac on ac.project_id = c.id;
end;
$$;

revoke all on function public.claim_expired_anonymous_projects(timestamptz, integer) from public;
grant execute on function public.claim_expired_anonymous_projects(timestamptz, integer) to service_role;

create or replace function public.purge_expired_anonymous_projects(
  p_project_ids uuid[]
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
  with claimed as (
    select p.id, p.workspace_id
    from public.projects p
    where p.id = any(p_project_ids)
      and p.status = 'deleted'
      and p.guest_retention_purge_claimed_at is not null
  ),
  asset_counts as (
    select c.id as project_id, count(a.id)::integer as deleted_asset_count
    from claimed c
    left join public.assets a on a.project_id = c.id
    group by c.id
  ),
  deleted_projects as (
    delete from public.projects p
    using claimed c
    where p.id = c.id
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

revoke all on function public.purge_expired_anonymous_projects(uuid[]) from public;
grant execute on function public.purge_expired_anonymous_projects(uuid[]) to service_role;
