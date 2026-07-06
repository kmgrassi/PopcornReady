-- Anonymous device recovery: random browser-held secret, server-held hash.
-- This is not phone fingerprinting. It only lets a fresh anonymous session
-- reclaim the previous anonymous workspace when local Supabase auth storage was
-- lost but app localStorage still has the recovery secret.

create table if not exists public.anonymous_device_recovery_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique check (length(token_hash) = 64),
  user_id      uuid not null references public.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists anonymous_device_recovery_tokens_user_idx
  on public.anonymous_device_recovery_tokens (user_id)
  where revoked_at is null;

alter table public.anonymous_device_recovery_tokens enable row level security;

-- No client-side RLS policies. The API manages these rows through service_role
-- after resolving the caller to public.users.id.

create or replace function public.recover_anonymous_workspace(
  p_token_hash text,
  p_current_user_id uuid
)
returns table (
  recovered boolean,
  source_user_id uuid,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_source_user_id uuid;
  v_source_workspace_id uuid;
  v_current_workspace_id uuid;
  v_current_workspace_project_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'recover_anonymous_workspace requires service_role'
      using errcode = '42501';
  end if;

  select t.user_id into v_source_user_id
  from public.anonymous_device_recovery_tokens t
  join public.users u on u.id = t.user_id
  join auth.users au on au.id = u.auth_id
  where t.token_hash = p_token_hash
    and t.revoked_at is null
    and au.is_anonymous is true
  limit 1;

  if v_source_user_id is null then
    return query select false, null::uuid, null::uuid;
    return;
  end if;

  select w.id into v_source_workspace_id
  from public.workspaces w
  where w.owner_id = v_source_user_id
  limit 1;

  update public.anonymous_device_recovery_tokens
  set last_used_at = now()
  where token_hash = p_token_hash;

  if v_source_workspace_id is null then
    update public.anonymous_device_recovery_tokens
    set user_id = p_current_user_id
    where token_hash = p_token_hash;

    return query select true, v_source_user_id, null::uuid;
    return;
  end if;

  if v_source_user_id = p_current_user_id then
    return query select true, v_source_user_id, v_source_workspace_id;
    return;
  end if;

  select w.id into v_current_workspace_id
  from public.workspaces w
  where w.owner_id = p_current_user_id
  limit 1;

  if v_current_workspace_id is not null and v_current_workspace_id is distinct from v_source_workspace_id then
    select count(*)::integer into v_current_workspace_project_count
    from public.projects p
    where p.workspace_id = v_current_workspace_id
      and p.status <> 'deleted';

    if coalesce(v_current_workspace_project_count, 0) > 0 then
      raise exception 'current anonymous workspace is not empty'
        using errcode = '23505';
    end if;

    delete from public.workspaces
    where id = v_current_workspace_id;
  end if;

  update public.workspaces
  set owner_id = p_current_user_id
  where id = v_source_workspace_id;

  delete from public.workspace_members wm
  where wm.workspace_id = v_source_workspace_id
    and wm.user_id in (v_source_user_id, p_current_user_id);

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_source_workspace_id, p_current_user_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';

  update public.anonymous_device_recovery_tokens
  set user_id = p_current_user_id
  where user_id = v_source_user_id
    and revoked_at is null;

  return query select true, v_source_user_id, v_source_workspace_id;
end;
$$;

revoke all on function public.recover_anonymous_workspace(text, uuid) from public;
grant execute on function public.recover_anonymous_workspace(text, uuid) to service_role;
