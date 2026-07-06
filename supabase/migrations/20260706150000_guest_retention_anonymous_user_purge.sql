-- Guest retention: after an anonymous-owned project is purged, delete the owning
-- anonymous auth user when nothing else remains. Caps Supabase MAU count and
-- auth.users bloat from guests who never sign up.
--
-- Two service_role-only helpers, called by the API purge job:
--   * claim_purgeable_anonymous_users — resolves purged workspaces to owners that
--     are still anonymous (auth.users.is_anonymous, no email) and own zero
--     remaining projects. The API then calls supabase.auth.admin.deleteUser for
--     each returned auth_id with the service-role client.
--   * purge_anonymous_user_rows — public.users.auth_id is ON DELETE SET NULL, so
--     deleting the auth user strands the public.users row. This removes the
--     stranded row plus the guest's now-empty workspaces (children cascade), and
--     only fires once the auth identity is verifiably gone.

create or replace function public.claim_purgeable_anonymous_users(
  p_workspace_ids uuid[]
)
returns table (
  user_id uuid,
  auth_id uuid,
  email text,
  is_anonymous boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'claim_purgeable_anonymous_users requires service_role'
      using errcode = '42501';
  end if;

  return query
  select distinct
    u.id as user_id,
    u.auth_id,
    au.email::text as email,
    au.is_anonymous
  from public.workspaces w
  join public.users u on u.id = w.owner_id
  join auth.users au on au.id = u.auth_id
  where w.id = any(p_workspace_ids)
    -- Claimed (non-anonymous) accounts are never candidates.
    and au.is_anonymous is true
    and coalesce(au.email::text, '') = ''
    -- The guest must own nothing else: zero projects across every workspace
    -- they own (a project retained for storage-delete retry still blocks).
    and not exists (
      select 1
      from public.projects p
      join public.workspaces ow on ow.id = p.workspace_id
      where ow.owner_id = u.id
    );
end;
$$;

revoke all on function public.claim_purgeable_anonymous_users(uuid[]) from public;
grant execute on function public.claim_purgeable_anonymous_users(uuid[]) to service_role;

create or replace function public.purge_anonymous_user_rows(
  p_user_ids uuid[]
)
returns table (
  user_id uuid
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'purge_anonymous_user_rows requires service_role'
      using errcode = '42501';
  end if;

  return query
  with deletable as (
    select u.id
    from public.users u
    where u.id = any(p_user_ids)
      -- The auth identity must already be gone (deleteUser set-nulls auth_id);
      -- never remove a row that still resolves to a live auth user.
      and not exists (select 1 from auth.users au where au.id = u.auth_id)
      -- Pre-created invited users (email set, auth pending) are not guests.
      and coalesce(u.email, '') = ''
      and not exists (
        select 1
        from public.projects p
        join public.workspaces ow on ow.id = p.workspace_id
        where ow.owner_id = u.id
      )
  ),
  deleted_workspaces as (
    delete from public.workspaces w
    using deletable d
    where w.owner_id = d.id
      and not exists (select 1 from public.projects p where p.workspace_id = w.id)
    returning w.id
  ),
  deleted_users as (
    delete from public.users u
    using deletable d
    where u.id = d.id
    returning u.id
  )
  select du.id as user_id
  from deleted_users du;
end;
$$;

revoke all on function public.purge_anonymous_user_rows(uuid[]) from public;
grant execute on function public.purge_anonymous_user_rows(uuid[]) to service_role;
