-- Repair creator-direct gate decisions after the pgcrypto extension moved out
-- of the SECURITY DEFINER functions' fixed public-only search path.

create or replace function public.consume_creator_direct_proposal_gate(
  p_gate_id uuid,
  p_project_id uuid,
  p_actor_id uuid,
  p_request_digest text,
  p_approved_max_usd double precision,
  p_approval_token text,
  p_idempotency_key text
)
returns table (run_id uuid, consumed boolean, dispatch_enqueued boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate public.orchestrator_run_gates%rowtype;
  v_run public.orchestrator_runs%rowtype;
  v_hash text;
  v_existing public.idempotency%rowtype;
begin
  if p_approval_token is null or length(p_approval_token) < 16
     or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'creator-direct confirmation requires token and idempotency key'
      using errcode = '22023';
  end if;
  v_hash := encode(extensions.digest(p_approval_token, 'sha256'), 'hex');

  select * into v_gate
    from public.orchestrator_run_gates g
   where g.id = p_gate_id
   for update;
  if not found or v_gate.gate_kind <> 'creator_direct_proposal'
     or v_gate.project_id is distinct from p_project_id
     or v_gate.actor_id is distinct from p_actor_id
     or v_gate.request_digest is distinct from p_request_digest
     or v_gate.approved_max_usd is distinct from p_approved_max_usd
     or v_gate.approval_token_hash is distinct from v_hash
     or v_gate.expires_at <= now() then
    raise exception 'creator_direct_confirmation_invalid'
      using errcode = 'check_violation';
  end if;

  select * into v_existing
    from public.idempotency
   where scope = 'creator-direct-confirm:' || p_project_id::text
     and key = p_idempotency_key
   for update;
  if found then
    if v_existing.body_hash is distinct from encode(extensions.digest(
         coalesce(p_gate_id::text, '') || ':' || p_actor_id::text || ':' ||
         p_request_digest || ':' || p_approved_max_usd::text,
         'sha256'
       ), 'hex') then
      raise exception 'creator_direct_confirmation_idempotency_conflict'
        using errcode = '23505';
    end if;
    return query
      select (v_existing.response_body ->> 'runId')::uuid, false, false;
    return;
  end if;

  if v_gate.token_consumed_at is not null
     or v_gate.status not in ('pending', 'reached') then
    raise exception 'creator_direct_confirmation_already_consumed'
      using errcode = '55000';
  end if;

  select * into v_run
    from public.orchestrator_runs r
   where r.id = v_gate.orchestrator_run_id
     and r.project_id = p_project_id
   for update;
  if not found or v_run.origin_kind <> 'creator_direct'
     or v_run.status <> 'queued' then
    raise exception 'creator_direct_gate_run_not_queued'
      using errcode = 'check_violation';
  end if;

  perform public.reserve_orchestrator_run_budget(
    p_project_id,
    v_run.id,
    v_gate.subject_proposal_action_id,
    null,
    'creator-direct-gate:' || v_gate.id::text,
    v_gate.approved_max_usd,
    'run_ceiling'
  );

  update public.orchestrator_run_gates
     set status = 'approved',
         token_consumed_at = now(),
         decided_at = now(),
         updated_at = now()
   where id = p_gate_id
     and token_consumed_at is null
     and status in ('pending', 'reached');
  if not found then
    raise exception 'creator_direct_confirmation_lost_race'
      using errcode = '55000';
  end if;

  perform public.wake_orchestrator_dispatch(v_run.id);
  insert into public.idempotency(scope, key, body_hash, status, response_body)
  values (
    'creator-direct-confirm:' || p_project_id::text,
    p_idempotency_key,
    encode(extensions.digest(
      p_gate_id::text || ':' || p_actor_id::text || ':' ||
      p_request_digest || ':' || p_approved_max_usd::text,
      'sha256'
    ), 'hex'),
    200,
    jsonb_build_object(
      'schemaVersion', 'CreatorDirectConfirmation.v1',
      'runId', v_run.id
    )
  );
  return query select v_run.id, true, true;
end;
$$;

create or replace function public.reject_creator_direct_proposal_gate(
  p_gate_id uuid,
  p_project_id uuid,
  p_actor_id uuid,
  p_request_digest text,
  p_approval_token text
)
returns table (run_id uuid, rejected boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate public.orchestrator_run_gates%rowtype;
  v_hash text;
begin
  v_hash := encode(extensions.digest(p_approval_token, 'sha256'), 'hex');
  select * into v_gate
    from public.orchestrator_run_gates g
   where g.id = p_gate_id
   for update;
  if not found or v_gate.gate_kind <> 'creator_direct_proposal'
     or v_gate.project_id is distinct from p_project_id
     or v_gate.actor_id is distinct from p_actor_id
     or v_gate.request_digest is distinct from p_request_digest
     or v_gate.approval_token_hash is distinct from v_hash
     or v_gate.expires_at <= now() then
    raise exception 'creator_direct_rejection_invalid'
      using errcode = 'check_violation';
  end if;
  if v_gate.token_consumed_at is not null then
    return query select v_gate.orchestrator_run_id, false;
    return;
  end if;
  update public.orchestrator_run_gates
     set status = 'rejected',
         token_consumed_at = now(),
         decided_at = now(),
         updated_at = now()
   where id = v_gate.id
     and token_consumed_at is null;
  update public.orchestrator_runs
     set status = 'canceled',
         completed_at = now(),
         wait_reason = null,
         updated_at = now()
   where id = v_gate.orchestrator_run_id
     and status in ('queued', 'running', 'waiting');
  return query select v_gate.orchestrator_run_id, true;
end;
$$;

revoke all on function public.consume_creator_direct_proposal_gate(
  uuid, uuid, uuid, text, double precision, text, text
) from public, anon, authenticated;
revoke all on function public.reject_creator_direct_proposal_gate(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.consume_creator_direct_proposal_gate(
  uuid, uuid, uuid, text, double precision, text, text
) to service_role;
grant execute on function public.reject_creator_direct_proposal_gate(
  uuid, uuid, uuid, text, text
) to service_role;
