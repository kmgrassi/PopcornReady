-- Creator-direct proposal repairs: preserve immutable assignment identities and
-- reject a stale confirmation after cancellation before reserving budget.

create or replace function public.create_creator_direct_proposal_gate_with_id(
  p_gate_id uuid,
  p_project_id uuid,
  p_run_id uuid,
  p_proposal_action_id uuid,
  p_actor_id uuid,
  p_request_digest text,
  p_approved_max_usd double precision,
  p_approval_token_hash text,
  p_expires_at timestamptz
)
returns table (gate_id uuid)
language plpgsql security definer set search_path = public
as $$
begin
  if p_gate_id is null then raise exception 'creator-direct proposal gate requires an id' using errcode = '22023'; end if;
  perform public.create_creator_direct_proposal_gate(
    p_project_id, p_run_id, p_proposal_action_id, p_actor_id, p_request_digest,
    p_approved_max_usd, p_approval_token_hash, p_expires_at
  );
  update public.orchestrator_run_gates
     set id = p_gate_id
   where orchestrator_run_id = p_run_id and stage = 'creator_direct_confirmation'
     and id <> p_gate_id;
  if not found then
    if not exists (select 1 from public.orchestrator_run_gates where id = p_gate_id) then
      raise exception 'creator-direct proposal gate identity could not be assigned' using errcode = '55000';
    end if;
  end if;
  return query select p_gate_id;
end;
$$;

create or replace function public.consume_creator_direct_proposal_gate(
  p_gate_id uuid, p_project_id uuid, p_actor_id uuid, p_request_digest text,
  p_approved_max_usd double precision, p_approval_token text, p_idempotency_key text
)
returns table (run_id uuid, consumed boolean, dispatch_enqueued boolean)
language plpgsql security definer set search_path = public
as $$
declare v_gate public.orchestrator_run_gates%rowtype; v_run public.orchestrator_runs%rowtype;
  v_hash text; v_existing public.idempotency%rowtype;
begin
  if p_approval_token is null or length(p_approval_token) < 16 or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'creator-direct confirmation requires token and idempotency key' using errcode = '22023';
  end if;
  v_hash := encode(digest(p_approval_token, 'sha256'), 'hex');
  select * into v_gate from public.orchestrator_run_gates g where g.id = p_gate_id for update;
  if not found or v_gate.gate_kind <> 'creator_direct_proposal' or v_gate.project_id is distinct from p_project_id or v_gate.actor_id is distinct from p_actor_id or v_gate.request_digest is distinct from p_request_digest or v_gate.approved_max_usd is distinct from p_approved_max_usd or v_gate.approval_token_hash is distinct from v_hash or v_gate.expires_at <= now() then
    raise exception 'creator_direct_confirmation_invalid' using errcode = 'check_violation';
  end if;
  select * into v_existing from public.idempotency where scope = 'creator-direct-confirm:' || p_project_id::text and key = p_idempotency_key for update;
  if found then
    if v_existing.body_hash is distinct from encode(digest(coalesce(p_gate_id::text, '') || ':' || p_actor_id::text || ':' || p_request_digest || ':' || p_approved_max_usd::text, 'sha256'), 'hex') then raise exception 'creator_direct_confirmation_idempotency_conflict' using errcode = '23505'; end if;
    return query select (v_existing.response_body ->> 'runId')::uuid, false, false; return;
  end if;
  if v_gate.token_consumed_at is not null or v_gate.status not in ('pending', 'reached') then raise exception 'creator_direct_confirmation_already_consumed' using errcode = '55000'; end if;
  select * into v_run from public.orchestrator_runs r where r.id = v_gate.orchestrator_run_id and r.project_id = p_project_id for update;
  if not found or v_run.origin_kind <> 'creator_direct' or v_run.status <> 'queued' then raise exception 'creator_direct_gate_run_not_queued' using errcode = 'check_violation'; end if;
  perform public.reserve_orchestrator_run_budget(p_project_id, v_run.id, v_gate.subject_proposal_action_id, null, 'creator-direct-gate:' || v_gate.id::text, v_gate.approved_max_usd, 'run_ceiling');
  update public.orchestrator_run_gates set status = 'approved', token_consumed_at = now(), decided_at = now(), updated_at = now() where id = p_gate_id and token_consumed_at is null and status in ('pending', 'reached');
  if not found then raise exception 'creator_direct_confirmation_lost_race' using errcode = '55000'; end if;
  perform public.wake_orchestrator_dispatch(v_run.id);
  insert into public.idempotency(scope, key, body_hash, status, response_body) values ('creator-direct-confirm:' || p_project_id::text, p_idempotency_key, encode(digest(p_gate_id::text || ':' || p_actor_id::text || ':' || p_request_digest || ':' || p_approved_max_usd::text, 'sha256'), 'hex'), 200, jsonb_build_object('schemaVersion', 'CreatorDirectConfirmation.v1', 'runId', v_run.id));
  return query select v_run.id, true, true;
end;
$$;

revoke all on function public.create_creator_direct_proposal_gate_with_id(uuid, uuid, uuid, uuid, uuid, text, double precision, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_creator_direct_proposal_gate_with_id(uuid, uuid, uuid, uuid, uuid, text, double precision, text, timestamptz) to service_role;
