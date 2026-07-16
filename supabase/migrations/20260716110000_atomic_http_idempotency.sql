-- Cross-instance HTTP idempotency lives in the existing record table. A lease
-- reserves one producer without holding a database transaction open across its
-- external work; replays consume only a completed matching response.
alter table public.idempotency
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists completed_at timestamptz;

create or replace function public.reserve_idempotency_record(
  p_scope text,
  p_key text,
  p_body_hash text,
  p_lease_seconds integer default 60
)
returns table (
  state text,
  status integer,
  response_body jsonb,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.idempotency%rowtype;
  v_lease_token uuid;
  v_lease_expires_at timestamptz;
begin
  if p_scope is null or length(trim(p_scope)) = 0
    or p_key is null or length(trim(p_key)) = 0
    or p_body_hash is null or length(trim(p_body_hash)) = 0 then
    raise exception 'idempotency scope, key, and body hash are required'
      using errcode = '22023';
  end if;

  v_lease_token := gen_random_uuid();

  loop
    select *
      into v_record
      from public.idempotency
     where scope = p_scope
       and key = p_key
     for update;

    if not found then
      begin
        v_lease_expires_at := clock_timestamp()
          + make_interval(secs => greatest(p_lease_seconds, 1));
        insert into public.idempotency (
          scope,
          key,
          body_hash,
          lease_token,
          lease_expires_at
        ) values (
          p_scope,
          p_key,
          p_body_hash,
          v_lease_token,
          v_lease_expires_at
        );
        return query select 'reserved'::text, null::integer, null::jsonb, v_lease_token;
        return;
      exception when unique_violation then
        -- A concurrent insert won. Read and classify its durable state.
      end;
    elsif v_record.body_hash is distinct from p_body_hash then
      return query select 'conflict'::text, null::integer, null::jsonb, null::uuid;
      return;
    elsif v_record.status is not null then
      return query select 'replay'::text, v_record.status, v_record.response_body, null::uuid;
      return;
    elsif v_record.lease_expires_at is null or v_record.lease_expires_at <= clock_timestamp() then
      v_lease_expires_at := clock_timestamp()
        + make_interval(secs => greatest(p_lease_seconds, 1));
      update public.idempotency
         set lease_token = v_lease_token,
             lease_expires_at = v_lease_expires_at
       where scope = p_scope
         and key = p_key;
      return query select 'reserved'::text, null::integer, null::jsonb, v_lease_token;
      return;
    else
      return query select 'pending'::text, null::integer, null::jsonb, null::uuid;
      return;
    end if;
  end loop;
end;
$$;

create or replace function public.complete_idempotency_record(
  p_scope text,
  p_key text,
  p_body_hash text,
  p_lease_token uuid,
  p_status integer,
  p_response_body jsonb
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.idempotency
     set status = p_status,
         response_body = p_response_body,
         completed_at = now(),
         lease_token = null,
         lease_expires_at = null
   where scope = p_scope
     and key = p_key
     and body_hash = p_body_hash
     and lease_token = p_lease_token
     and status is null
  returning true;
$$;

create or replace function public.renew_idempotency_record(
  p_scope text,
  p_key text,
  p_body_hash text,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.idempotency
     set lease_expires_at = clock_timestamp() + make_interval(secs => greatest(p_lease_seconds, 1))
   where scope = p_scope
     and key = p_key
     and body_hash = p_body_hash
     and lease_token = p_lease_token
     and status is null
  returning true;
$$;

create or replace function public.abandon_idempotency_record(
  p_scope text,
  p_key text,
  p_body_hash text,
  p_lease_token uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  delete from public.idempotency
   where scope = p_scope
     and key = p_key
     and body_hash = p_body_hash
     and lease_token = p_lease_token
     and status is null
  returning true;
$$;

revoke all on function public.reserve_idempotency_record(text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_idempotency_record(text, text, text, uuid, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.renew_idempotency_record(text, text, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.abandon_idempotency_record(text, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_idempotency_record(text, text, text, integer)
  to service_role;
grant execute on function public.complete_idempotency_record(text, text, text, uuid, integer, jsonb)
  to service_role;
grant execute on function public.renew_idempotency_record(text, text, text, uuid, integer)
  to service_role;
grant execute on function public.abandon_idempotency_record(text, text, text, uuid)
  to service_role;
