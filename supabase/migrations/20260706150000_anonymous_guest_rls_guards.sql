-- Anonymous sign-ins are being enabled for the landing guest flow. Anonymous
-- sessions receive the `authenticated` Postgres role, so every
-- `to authenticated` policy now also covers guests.
--
-- Ownership-scoped policies (current_app_user_id() / is_workspace_member /
-- owns_*) stay guest-inclusive on purpose: guests own their workspace,
-- projects, runs, and assets, and the anonymous run quota + credit ledger
-- meter their generation. What guests must NOT reach are the outward-facing
-- and collaboration surfaces:
--
--   * publishing / editing entries in the shared public catalog
--   * liking catalog entries (public signal, and guest rows get purged)
--   * workspace membership management and invites (collaboration requires a
--     permanent account; invites carry emails + secret tokens)
--   * redeeming a workspace invite (guests can self-edit public.users.email,
--     so the RPC's email match alone does not stop an anonymous session
--     holding a leaked token)
--
-- Guarded via the JWT is_anonymous claim. Additive only — recreates the
-- affected policies with the extra conjunct; no applied migration is changed.

-- ---------------------------------------------------------------------------
-- Helper: true when the current session is a Supabase anonymous sign-in.
-- ---------------------------------------------------------------------------
create or replace function public.is_anonymous_session()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
$$;

comment on function public.is_anonymous_session() is
  'True when the current session belongs to a Supabase anonymous sign-in '
  '(JWT is_anonymous claim). Used in RLS policies to keep guest sessions out '
  'of outward-facing writes (catalog publishing, likes, membership, invites).';

revoke all on function public.is_anonymous_session() from public;
grant execute on function public.is_anonymous_session() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Workspace membership management: permanent accounts only. The owner's own
-- membership row is written by the SECURITY DEFINER on_workspace_created
-- trigger, so guest workspace creation keeps working.
-- ---------------------------------------------------------------------------
drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members
  for insert to authenticated
  with check (
    public.is_workspace_admin(workspace_id)
    and not public.is_anonymous_session()
  );

drop policy if exists workspace_members_update on public.workspace_members;
create policy workspace_members_update on public.workspace_members
  for update to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    and not public.is_anonymous_session()
  )
  with check (
    public.is_workspace_admin(workspace_id)
    and not public.is_anonymous_session()
  );

drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    and not public.is_anonymous_session()
  );

-- ---------------------------------------------------------------------------
-- Workspace invites: permanent accounts only (emails + secret tokens).
-- ---------------------------------------------------------------------------
drop policy if exists workspace_invites_insert on public.workspace_invites;
create policy workspace_invites_insert on public.workspace_invites
  for insert to authenticated
  with check (
    public.is_workspace_admin(workspace_id)
    and not public.is_anonymous_session()
  );

drop policy if exists workspace_invites_update on public.workspace_invites;
create policy workspace_invites_update on public.workspace_invites
  for update to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    and not public.is_anonymous_session()
  )
  with check (
    public.is_workspace_admin(workspace_id)
    and not public.is_anonymous_session()
  );

drop policy if exists workspace_invites_delete on public.workspace_invites;
create policy workspace_invites_delete on public.workspace_invites
  for delete to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    and not public.is_anonymous_session()
  );

-- ---------------------------------------------------------------------------
-- Shared public catalog: guests may read (the read policy already includes
-- anon), but publishing/editing/deleting entries requires a permanent
-- account. Server-side/system publishing uses service_role and bypasses RLS.
-- ---------------------------------------------------------------------------
drop policy if exists catalog_entries_owner_insert on public.catalog_entries;
create policy catalog_entries_owner_insert on public.catalog_entries
  for insert to authenticated
  with check (
    publisher_user_id = public.current_app_user_id()
    and not public.is_anonymous_session()
  );

drop policy if exists catalog_entries_owner_update on public.catalog_entries;
create policy catalog_entries_owner_update on public.catalog_entries
  for update to authenticated
  using (
    publisher_user_id = public.current_app_user_id()
    and not public.is_anonymous_session()
  )
  with check (
    publisher_user_id = public.current_app_user_id()
    and not public.is_anonymous_session()
  );

drop policy if exists catalog_entries_owner_delete on public.catalog_entries;
create policy catalog_entries_owner_delete on public.catalog_entries
  for delete to authenticated
  using (
    publisher_user_id = public.current_app_user_id()
    and not public.is_anonymous_session()
  );

-- ---------------------------------------------------------------------------
-- Catalog likes: public engagement signal — throwaway anonymous accounts
-- would inflate counts and then be purged. Reads/deletes of own likes stay
-- as-is (a guest can never create one once inserts are guarded).
-- ---------------------------------------------------------------------------
drop policy if exists catalog_entry_likes_owner_insert on public.catalog_entry_likes;
create policy catalog_entry_likes_owner_insert on public.catalog_entry_likes
  for insert to authenticated
  with check (
    user_id = public.current_app_user_id()
    and not public.is_anonymous_session()
    and exists (
      select 1
      from public.catalog_entries e
      where e.id = catalog_entry_id
        and e.status = 'published'
    )
  );

-- ---------------------------------------------------------------------------
-- accept_workspace_invite: block anonymous sessions explicitly. The existing
-- email match is not sufficient once anonymous sign-ins exist, because
-- users_update_own lets a session edit its own public.users.email — an
-- anonymous session holding a leaked/forwarded invite token could set the
-- invitee's email on itself and join the workspace. Body otherwise identical
-- to 20260603000000_init_schema.sql.
-- ---------------------------------------------------------------------------
create or replace function public.accept_workspace_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := public.current_app_user_id();
  v_invite       public.workspace_invites%rowtype;
  v_caller_email text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if public.is_anonymous_session() then
    raise exception 'workspace invites require a permanent account'
      using errcode = '42501';
  end if;

  select * into v_invite
  from public.workspace_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if v_invite.status = 'accepted' and v_invite.accepted_by = v_user_id then
    return v_invite.workspace_id;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'invite is % (not pending)', v_invite.status using errcode = '22023';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'invite has expired' using errcode = '22023';
  end if;

  select email into v_caller_email from public.users where id = v_user_id;
  if v_caller_email is null
     or lower(btrim(v_caller_email)) is distinct from lower(btrim(v_invite.email)) then
    raise exception 'invite is addressed to a different email'
      using errcode = '42501';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (v_invite.workspace_id, v_user_id, v_invite.role, v_invite.invited_by)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
    set status      = 'accepted',
        accepted_by = v_user_id,
        accepted_at = now()
    where id = v_invite.id;

  return v_invite.workspace_id;
end;
$$;
