-- Specialist-agent orchestration PR 9 — budget, confirmation, cancellation,
-- and recovery controls for finite runs.
--
-- This migration deliberately extends existing durable records instead of
-- creating an assignment cost ledger:
--   * actions/jobs identify the billable operation,
--   * model_call_costs and credit_transactions remain the cost/charge records,
--   * orchestrator_budget_reservations is only a short-lived admission and
--     settlement control row, keyed by those existing identities.
--
-- All mutations are service-role-only, transactional, and replay-safe.

-- ---------------------------------------------------------------------------
-- A. Budget admission and one-time settlement
-- ---------------------------------------------------------------------------

create type public.orchestrator_budget_reservation_status as enum (
  'reserved', 'settled', 'released', 'canceled'
);

create table public.orchestrator_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  orchestrator_run_id uuid not null references public.orchestrator_runs(id) on delete cascade,
  root_run_id uuid not null references public.orchestrator_runs(id) on delete cascade,
  action_id uuid references public.actions(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  reservation_key text not null,
  reservation_scope text not null default 'operation'
    check (reservation_scope in ('operation', 'run_ceiling')),
  estimated_usd double precision not null check (estimated_usd >= 0),
  actual_usd double precision check (actual_usd is null or actual_usd >= 0),
  billing_user_id uuid references public.users(id) on delete set null,
  billable_usd double precision not null default 0 check (billable_usd >= 0),
  status public.orchestrator_budget_reservation_status not null default 'reserved',
  settled_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, reservation_key),
  unique (action_id, job_id)
);

create unique index orchestrator_budget_reservations_run_ceiling_uidx
  on public.orchestrator_budget_reservations(orchestrator_run_id)
  where reservation_scope = 'run_ceiling' and status = 'reserved';

create index orchestrator_budget_reservations_family_idx
  on public.orchestrator_budget_reservations(root_run_id, status);
create index orchestrator_budget_reservations_run_idx
  on public.orchestrator_budget_reservations(orchestrator_run_id, status);

alter table public.orchestrator_budget_reservations enable row level security;
revoke all on public.orchestrator_budget_reservations from public, anon, authenticated;

-- Keep replayable provider/model cost writes on their canonical sidecar. This
-- key is intentionally independent from the reservation key: a provider can
-- report multiple measured cost rows for the same reserved operation.
alter table public.model_call_costs
  add column idempotency_key text;
alter table public.model_call_costs
  add constraint model_call_costs_idempotency_uidx unique (idempotency_key);

-- The root-family read model derives totals; it never copies charges onto a
-- parent run. `spent_usd` stays own-run spend, while reservation rows represent
-- only admitted work that has not settled yet.
create or replace view public.orchestrator_run_family_budget_projection
with (security_invoker = true)
as
with recursive ancestry as (
  select r.id as run_id, r.parent_run_id, r.continues_run_id, r.id as root_run_id,
         r.project_id, r.spent_usd, 0 as depth
    from public.orchestrator_runs r
  union all
  select f.run_id, parent.parent_run_id, parent.continues_run_id, parent.id as root_run_id,
         f.project_id, f.spent_usd, f.depth + 1
    from ancestry f
    join public.orchestrator_runs parent
      on parent.id = coalesce(f.parent_run_id, f.continues_run_id)
   where f.parent_run_id is not null or f.continues_run_id is not null
), family_runs as (
  select distinct on (run_id) run_id, root_run_id, project_id, spent_usd
    from ancestry
   order by run_id, depth desc
), reserved as (
  select root_run_id,
         sum(estimated_usd) filter (where status = 'reserved') as reserved_usd,
         sum(actual_usd) filter (where status = 'settled') as settled_usd
   from public.orchestrator_budget_reservations
   group by root_run_id
), costs as (
  select f.root_run_id, sum(m.cost_usd) as model_cost_usd
    from family_runs f
    join public.model_call_costs m on m.run_id = f.run_id
   group by f.root_run_id
)
select f.root_run_id,
       f.project_id,
       sum(f.spent_usd) as own_run_spend_usd,
       coalesce(costs.model_cost_usd, 0) as model_cost_usd,
       coalesce(reserved.reserved_usd, 0) as reserved_usd,
       coalesce(reserved.settled_usd, 0) as settled_usd,
       sum(f.spent_usd) + coalesce(reserved.reserved_usd, 0) as committed_usd
  from family_runs f
  left join reserved on reserved.root_run_id = f.root_run_id
  left join costs on costs.root_run_id = f.root_run_id
 group by f.root_run_id, f.project_id, costs.model_cost_usd, reserved.reserved_usd, reserved.settled_usd;

create or replace function public.reserve_orchestrator_run_budget(
  p_project_id uuid,
  p_run_id uuid,
  p_action_id uuid,
  p_job_id uuid,
  p_reservation_key text,
  p_estimated_usd double precision,
  p_reservation_scope text default 'operation'
)
returns table (
  reservation_id uuid,
  root_run_id uuid,
  reserved_usd double precision,
  replayed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.orchestrator_runs%rowtype;
  v_root public.orchestrator_runs%rowtype;
  v_existing public.orchestrator_budget_reservations%rowtype;
  v_committed double precision;
  v_family_usage double precision;
  v_family_ceiling double precision;
  v_root_id uuid;
  v_family_increment double precision;
begin
  if p_estimated_usd is null or p_estimated_usd < 0
     or p_reservation_key is null or length(trim(p_reservation_key)) = 0 then
    raise exception 'budget reservation requires a non-negative estimate and stable key'
      using errcode = '22023';
  end if;
  if p_reservation_scope not in ('operation', 'run_ceiling') then
    raise exception 'unsupported budget reservation scope %', p_reservation_scope using errcode = '22023';
  end if;

  select * into v_existing
    from public.orchestrator_budget_reservations b
   where b.project_id = p_project_id and b.reservation_key = p_reservation_key
   for update;
  if found then
    if v_existing.orchestrator_run_id is distinct from p_run_id
       or v_existing.action_id is distinct from p_action_id
       or v_existing.job_id is distinct from p_job_id
       or v_existing.estimated_usd is distinct from p_estimated_usd then
      raise exception 'budget_reservation_replay_mismatch for key %', p_reservation_key
        using errcode = '23505';
    end if;
    return query select v_existing.id, v_existing.root_run_id, v_existing.estimated_usd, true;
    return;
  end if;

  select * into v_run
    from public.orchestrator_runs r
   where r.id = p_run_id and r.project_id = p_project_id
   for update;
  if not found then
    raise exception 'orchestrator run % not found in project %', p_run_id, p_project_id
      using errcode = 'P0002';
  end if;
  if v_run.status not in ('queued', 'running', 'waiting') then
    raise exception 'cannot reserve budget for terminal run %', p_run_id
      using errcode = '55000';
  end if;

  with recursive ancestry as (
    select r.id, r.parent_run_id, r.continues_run_id, 0 as depth
      from public.orchestrator_runs r where r.id = v_run.id
    union all
    select parent.id, parent.parent_run_id, parent.continues_run_id, a.depth + 1
      from ancestry a join public.orchestrator_runs parent
        on parent.id = coalesce(a.parent_run_id, a.continues_run_id)
     where a.parent_run_id is not null or a.continues_run_id is not null
  )
  select id into v_root_id from ancestry order by depth desc limit 1;
  -- Serialize all sibling admissions through the root lock. The hierarchy is
  -- intentionally two levels deep, so this is the one family ceiling.
  select * into v_root
    from public.orchestrator_runs r
   where r.id = v_root_id and r.project_id = p_project_id
   for update;
  if not found then
    raise exception 'root run % not found for budget reservation', v_root_id
      using errcode = 'P0002';
  end if;
  if v_run.budget_usd is not null and (
       p_reservation_scope = 'run_ceiling' and p_estimated_usd > v_run.budget_usd
       or p_reservation_scope = 'operation' and v_run.spent_usd + p_estimated_usd + coalesce((
         select sum(b.estimated_usd) from public.orchestrator_budget_reservations b
          where b.orchestrator_run_id = v_run.id
            and b.reservation_scope = 'operation' and b.status = 'reserved'
       ), 0) > v_run.budget_usd
     ) then
    raise exception 'finite run budget exhausted for run %', v_run.id
      using errcode = 'check_violation';
  end if;

  with recursive family(id) as (
    select v_root_id
    union
    select r.id from public.orchestrator_runs r join family f
      on r.parent_run_id = f.id or r.continues_run_id = f.id
     where r.project_id = p_project_id
  )
  select coalesce(sum(r.spent_usd + coalesce(operation.estimated_usd, 0)), 0),
         max(ceiling.estimated_usd)
    into v_family_usage, v_family_ceiling
    from public.orchestrator_runs r
    left join lateral (
      select b.estimated_usd from public.orchestrator_budget_reservations b
       where b.orchestrator_run_id = r.id and b.reservation_scope = 'run_ceiling'
         and b.status = 'reserved'
    ) ceiling on true
    left join lateral (
      select sum(b.estimated_usd) as estimated_usd from public.orchestrator_budget_reservations b
       where b.orchestrator_run_id = r.id and b.reservation_scope = 'operation'
         and b.status = 'reserved'
    ) operation on true
   where r.id in (select id from family);
  v_committed := greatest(v_family_usage, coalesce(v_family_ceiling, 0));
  v_family_increment := p_estimated_usd;
  if p_reservation_scope = 'operation' and v_family_ceiling is not null then
    -- A creator-direct ceiling follows the whole continuation family, not just
    -- the run that originally consumed the proposal token. Its operations share
    -- one approved cap and must not reserve it a second time on successors.
    if v_family_usage + p_estimated_usd > v_family_ceiling then
      raise exception 'continuation family budget exhausted: % + % exceeds %',
        v_family_usage, p_estimated_usd, v_family_ceiling using errcode = 'check_violation';
    end if;
    v_family_increment := 0;
  end if;
  if v_root.budget_usd is not null and v_committed + v_family_increment > v_root.budget_usd then
    raise exception 'root_family_budget_exhausted: % + % exceeds %',
      v_committed, p_estimated_usd, v_root.budget_usd using errcode = 'check_violation';
  end if;

  insert into public.orchestrator_budget_reservations (
    project_id, orchestrator_run_id, root_run_id, action_id, job_id,
    reservation_key, reservation_scope, estimated_usd
  ) values (
    p_project_id, p_run_id, v_root_id, p_action_id, p_job_id,
    p_reservation_key, p_reservation_scope, p_estimated_usd
  ) returning id into reservation_id;
  root_run_id := v_root_id;
  reserved_usd := p_estimated_usd;
  replayed := false;
  return next;
end;
$$;

create or replace function public.record_orchestrator_budget_billing(
  p_project_id uuid,
  p_reservation_key text,
  p_billing_user_id uuid,
  p_billable_usd double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_billing_user_id is null or p_billable_usd is null or p_billable_usd < 0 then
    raise exception 'budget billing attribution requires user and non-negative cost' using errcode = '22023';
  end if;
  update public.orchestrator_budget_reservations
     set billing_user_id = p_billing_user_id,
         billable_usd = p_billable_usd,
         updated_at = now()
   where project_id = p_project_id
     and reservation_key = p_reservation_key
     and status = 'reserved';
  if not found then
    raise exception 'active budget reservation % not found', p_reservation_key using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.settle_orchestrator_run_budget(
  p_project_id uuid,
  p_reservation_key text,
  p_actual_usd double precision,
  p_billing_user_id uuid default null,
  p_billable_usd double precision default 0
)
returns table (settled boolean, run_id uuid, actual_usd double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.orchestrator_budget_reservations%rowtype;
begin
  if p_actual_usd is null or p_actual_usd < 0 or p_billable_usd is null or p_billable_usd < 0 then
    raise exception 'budget settlement requires a non-negative actual cost' using errcode = '22023';
  end if;
  select * into v_reservation
    from public.orchestrator_budget_reservations b
   where b.project_id = p_project_id and b.reservation_key = p_reservation_key
   for update;
  if not found then
    raise exception 'budget reservation % not found', p_reservation_key using errcode = 'P0002';
  end if;
  if v_reservation.status = 'settled' then
    if v_reservation.actual_usd is distinct from p_actual_usd then
      raise exception 'budget_settlement_replay_mismatch for key %', p_reservation_key using errcode = '23505';
    end if;
    return query select false, v_reservation.orchestrator_run_id, v_reservation.actual_usd;
    return;
  end if;
  if v_reservation.status <> 'reserved' then
    raise exception 'cannot settle % reservation %', v_reservation.status, p_reservation_key using errcode = '55000';
  end if;
  if p_actual_usd > v_reservation.estimated_usd then
    raise exception 'budget settlement exceeds reserved maximum for key %', p_reservation_key
      using errcode = 'check_violation';
  end if;
  update public.orchestrator_budget_reservations
     set status = 'settled', actual_usd = p_actual_usd, settled_at = now(), updated_at = now()
   where id = v_reservation.id;
  update public.orchestrator_runs
     set spent_usd = spent_usd + p_actual_usd, updated_at = now()
   where id = v_reservation.orchestrator_run_id;
  if p_billing_user_id is not null and p_billable_usd > 0 then
    -- Credit movement stays in the existing, balance-guarded ledger. Its
    -- operation key is also the settlement key, so a retry cannot double debit.
    perform public.apply_credit_transaction(
      p_billing_user_id,
      -ceil(p_billable_usd * 2 * 100)::integer,
      'generation_debit'::public.credit_reason,
      v_reservation.orchestrator_run_id,
      v_reservation.action_id,
      p_billable_usd,
      'budget-settlement-credit:' || p_reservation_key,
      jsonb_build_object('schemaVersion', 'BudgetSettlementCredit.v1', 'reservationKey', p_reservation_key)
    );
  end if;
  return query select true, v_reservation.orchestrator_run_id, p_actual_usd;
end;
$$;

create or replace function public.release_orchestrator_run_budget(
  p_project_id uuid,
  p_reservation_key text,
  p_reason text
)
returns table (released boolean, run_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.orchestrator_budget_reservations%rowtype;
begin
  select * into v_reservation
    from public.orchestrator_budget_reservations b
   where b.project_id = p_project_id and b.reservation_key = p_reservation_key
   for update;
  if not found then
    raise exception 'budget reservation % not found', p_reservation_key using errcode = 'P0002';
  end if;
  if v_reservation.status = 'reserved' then
    update public.orchestrator_budget_reservations
       set status = 'released', released_at = now(), updated_at = now()
     where id = v_reservation.id;
    return query select true, v_reservation.orchestrator_run_id;
    return;
  end if;
  return query select false, v_reservation.orchestrator_run_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- B. Creator-direct proposal confirmation. The raw token is never stored.
-- ---------------------------------------------------------------------------

alter table public.orchestrator_run_gates
  add column gate_kind text,
  add column project_id uuid references public.projects(id) on delete cascade,
  add column subject_proposal_action_id uuid references public.actions(id) on delete set null,
  add column actor_id uuid references public.users(id) on delete set null,
  add column request_digest text,
  add column approved_max_usd double precision,
  add column expires_at timestamptz,
  add column approval_token_hash text,
  add column token_consumed_at timestamptz;

alter table public.orchestrator_run_gates
  add constraint orchestrator_run_gates_creator_direct_shape check (
    gate_kind is distinct from 'creator_direct_proposal' or (
      project_id is not null and subject_proposal_action_id is not null and actor_id is not null
      and request_digest is not null and approved_max_usd is not null and approved_max_usd >= 0
      and expires_at is not null and approval_token_hash is not null
    )
  );
create unique index orchestrator_run_gates_creator_direct_token_uidx
  on public.orchestrator_run_gates(approval_token_hash)
  where gate_kind = 'creator_direct_proposal';

create or replace function public.create_creator_direct_proposal_gate(
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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.orchestrator_runs%rowtype;
begin
  select * into v_run from public.orchestrator_runs r
   where r.id = p_run_id and r.project_id = p_project_id for update;
  if not found or v_run.origin_kind <> 'creator_direct' then
    raise exception 'creator-direct proposal gate requires a creator-direct finite run'
      using errcode = 'check_violation';
  end if;
  if p_approved_max_usd is null or p_approved_max_usd < 0
     or p_request_digest is null or length(trim(p_request_digest)) = 0
     or p_approval_token_hash is null or length(trim(p_approval_token_hash)) = 0
     or p_expires_at is null or p_expires_at <= now() then
    raise exception 'creator-direct proposal gate requires complete unexpired confirmation metadata'
      using errcode = '22023';
  end if;
  insert into public.orchestrator_run_gates (
    orchestrator_run_id, stage, status, gate_kind, project_id,
    subject_proposal_action_id, actor_id, request_digest, approved_max_usd,
    expires_at, approval_token_hash
  ) values (
    p_run_id, 'creator_direct_confirmation', 'reached', 'creator_direct_proposal', p_project_id,
    p_proposal_action_id, p_actor_id, p_request_digest, p_approved_max_usd,
    p_expires_at, p_approval_token_hash
  )
  on conflict (orchestrator_run_id, stage) do update
    set status = excluded.status, gate_kind = excluded.gate_kind,
        project_id = excluded.project_id, subject_proposal_action_id = excluded.subject_proposal_action_id,
        actor_id = excluded.actor_id, request_digest = excluded.request_digest,
        approved_max_usd = excluded.approved_max_usd, expires_at = excluded.expires_at,
        approval_token_hash = excluded.approval_token_hash,
        decided_at = null, decided_by_action_id = null, updated_at = now()
    where public.orchestrator_run_gates.token_consumed_at is null
  returning id into gate_id;
  if gate_id is null then
    raise exception 'creator-direct proposal gate was already consumed; create a successor run'
      using errcode = '55000';
  end if;
  return next;
end;
$$;

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
    raise exception 'creator-direct confirmation requires token and idempotency key' using errcode = '22023';
  end if;
  v_hash := encode(digest(p_approval_token, 'sha256'), 'hex');

  select * into v_gate from public.orchestrator_run_gates g where g.id = p_gate_id for update;
  if not found or v_gate.gate_kind <> 'creator_direct_proposal'
     or v_gate.project_id is distinct from p_project_id or v_gate.actor_id is distinct from p_actor_id
     or v_gate.request_digest is distinct from p_request_digest
     or v_gate.approved_max_usd is distinct from p_approved_max_usd
     or v_gate.approval_token_hash is distinct from v_hash
     or v_gate.expires_at <= now() then
    raise exception 'creator_direct_confirmation_invalid' using errcode = 'check_violation';
  end if;
  -- Authorize the replay against the durable gate before consulting the
  -- idempotency response: an idempotency key is never a bearer credential.
  select * into v_existing from public.idempotency
   where scope = 'creator-direct-confirm:' || p_project_id::text and key = p_idempotency_key
   for update;
  if found then
    if v_existing.body_hash is distinct from encode(digest(
         coalesce(p_gate_id::text, '') || ':' || p_actor_id::text || ':' || p_request_digest || ':' || p_approved_max_usd::text,
         'sha256'), 'hex') then
      raise exception 'creator_direct_confirmation_idempotency_conflict' using errcode = '23505';
    end if;
    return query select (v_existing.response_body ->> 'runId')::uuid, false, false;
    return;
  end if;
  if v_gate.token_consumed_at is not null or v_gate.status not in ('pending', 'reached') then
    raise exception 'creator_direct_confirmation_already_consumed' using errcode = '55000';
  end if;
  select * into v_run from public.orchestrator_runs r
   where r.id = v_gate.orchestrator_run_id and r.project_id = p_project_id for update;
  if not found or v_run.origin_kind <> 'creator_direct' then
    raise exception 'creator_direct_gate_run_mismatch' using errcode = 'check_violation';
  end if;

  perform public.reserve_orchestrator_run_budget(
    p_project_id, v_run.id, v_gate.subject_proposal_action_id, null,
    'creator-direct-gate:' || v_gate.id::text, v_gate.approved_max_usd, 'run_ceiling'
  );

  update public.orchestrator_run_gates
     set status = 'approved', token_consumed_at = now(), decided_at = now(), updated_at = now()
   where id = p_gate_id and token_consumed_at is null and status in ('pending', 'reached');
  if not found then raise exception 'creator_direct_confirmation_lost_race' using errcode = '55000'; end if;
  perform public.wake_orchestrator_dispatch(v_run.id);
  insert into public.idempotency(scope, key, body_hash, status, response_body)
  values (
    'creator-direct-confirm:' || p_project_id::text, p_idempotency_key,
    encode(digest(p_gate_id::text || ':' || p_actor_id::text || ':' || p_request_digest || ':' || p_approved_max_usd::text, 'sha256'), 'hex'),
    200, jsonb_build_object('schemaVersion', 'CreatorDirectConfirmation.v1', 'runId', v_run.id)
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
  v_hash := encode(digest(p_approval_token, 'sha256'), 'hex');
  select * into v_gate from public.orchestrator_run_gates g where g.id = p_gate_id for update;
  if not found or v_gate.gate_kind <> 'creator_direct_proposal'
     or v_gate.project_id is distinct from p_project_id or v_gate.actor_id is distinct from p_actor_id
     or v_gate.request_digest is distinct from p_request_digest
     or v_gate.approval_token_hash is distinct from v_hash or v_gate.expires_at <= now() then
    raise exception 'creator_direct_rejection_invalid' using errcode = 'check_violation';
  end if;
  if v_gate.token_consumed_at is not null then
    return query select v_gate.orchestrator_run_id, false;
    return;
  end if;
  update public.orchestrator_run_gates
     set status = 'rejected', token_consumed_at = now(), decided_at = now(), updated_at = now()
   where id = v_gate.id and token_consumed_at is null;
  update public.orchestrator_runs
     set status = 'canceled', completed_at = now(), wait_reason = null, updated_at = now()
   where id = v_gate.orchestrator_run_id and status in ('queued', 'running', 'waiting');
  return query select v_gate.orchestrator_run_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Causal cancellation and recovery projection
-- ---------------------------------------------------------------------------

create or replace function public.cancel_orchestrator_run_family(
  p_project_id uuid,
  p_run_id uuid
)
returns table (canceled_run_ids uuid[], canceled_job_ids uuid[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.orchestrator_runs%rowtype;
begin
  select * into v_run from public.orchestrator_runs r
   where r.id = p_run_id and r.project_id = p_project_id for update;
  if not found then raise exception 'orchestrator run % not found', p_run_id using errcode = 'P0002'; end if;
  return query
  with recursive causal(id) as (
    select v_run.id
    union
    select r.id from public.orchestrator_runs r join causal c
      on r.parent_run_id = c.id or r.continues_run_id = c.id
     where r.project_id = p_project_id
  ), canceled_runs as (
    update public.orchestrator_runs r
       set status = 'canceled', wait_reason = null, completed_at = now(), updated_at = now()
     where r.id in (select id from causal)
       and r.status in ('queued', 'running', 'waiting')
     returning r.id
  ), canceled_jobs as (
    update public.jobs j set status = 'canceled', updated_at = now()
     where j.project_id = p_project_id and j.status in ('queued', 'running')
       and exists (
         select 1 from public.actions a
          where a.id = j.action_id and a.orchestrator_run_id in (select id from causal)
     )
     returning j.id
  ), released_session_claims as (
    update public.agent_sessions s
       set active_run_id = null, claim_generation = s.claim_generation + 1, updated_at = now()
     where s.active_run_id in (select id from causal)
  ), released as (
    update public.orchestrator_budget_reservations b
       set status = 'canceled', released_at = now(), updated_at = now()
     where b.project_id = p_project_id and b.orchestrator_run_id in (select id from causal)
       and b.status = 'reserved'
  )
  select coalesce((select array_agg(id) from canceled_runs), '{}'::uuid[]),
         coalesce((select array_agg(id) from canceled_jobs), '{}'::uuid[]);
end;
$$;

create or replace view public.orchestrator_runtime_recovery_projection
with (security_invoker = true)
as
select r.id as run_id, r.project_id,
       case
         when r.wait_reason = 'domain' and not exists (
           select 1 from public.actions a
            where a.orchestrator_run_id = r.id and a.tool like 'delegate_%'
              and a.status = 'running'
         ) then 'unacknowledged_domain_wait'
         when r.agent_session_id is not null and s.active_run_id = r.id
              and r.status in ('failed', 'canceled', 'timed_out', 'superseded') then 'stale_session_claim'
         else null
       end as recovery_reason
  from public.orchestrator_runs r
  left join public.agent_sessions s on s.id = r.agent_session_id
 where r.status in ('queued', 'running', 'waiting', 'failed', 'canceled', 'timed_out', 'superseded');

create or replace function public.recover_orchestrator_runtime_controls()
returns table (released_claims integer, parent_wakes integer, domain_wait_wakes integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent record;
  v_wait record;
  v_reservation record;
  v_delegation_error jsonb;
  v_rows integer;
begin
  -- A terminal finite run cannot keep the permanent session serialized. The
  -- generation bump fences any provider callback that survived a worker crash.
  with released as (
    update public.agent_sessions s
       set active_run_id = null, claim_generation = s.claim_generation + 1, updated_at = now()
      from public.orchestrator_runs r
     where s.active_run_id = r.id
       and r.status in ('succeeded', 'failed', 'canceled', 'timed_out', 'superseded')
     returning s.id
  )
  select count(*) into released_claims from released;

  -- Recover accounting independently of the process that launched provider
  -- work. A terminal job with a durable cost row settles exactly once; a
  -- terminal job that never recorded a cost frees its admission headroom.
  for v_reservation in
    select b.project_id, b.reservation_key, b.estimated_usd,
           b.billing_user_id, b.billable_usd,
           m.cost_usd as recorded_cost_usd
      from public.orchestrator_budget_reservations b
      join public.jobs j on j.id = b.job_id
      left join public.model_call_costs m on m.idempotency_key = b.reservation_key
     where b.status = 'reserved' and j.status in ('succeeded', 'failed', 'canceled')
  loop
    if v_reservation.recorded_cost_usd is not null then
      perform public.settle_orchestrator_run_budget(
        v_reservation.project_id,
        v_reservation.reservation_key,
        least(v_reservation.recorded_cost_usd, v_reservation.estimated_usd),
        v_reservation.billing_user_id,
        v_reservation.billable_usd
      );
    else
      perform public.release_orchestrator_run_budget(
        v_reservation.project_id,
        v_reservation.reservation_key,
        'terminal_job_without_recorded_cost'
      );
    end if;
  end loop;

  parent_wakes := 0;
  for v_parent in
    select child.parent_run_id as run_id,
           child.id as child_run_id,
           child.root_action_id,
           report.params as report,
           report.output_asset_ids
      from public.orchestrator_runs child
      join public.actions report
        on report.orchestrator_run_id = child.id and report.tool = 'domain_report'
      join public.actions delegation
        on delegation.id = child.root_action_id
       and delegation.status in ('proposed', 'running')
     where child.parent_run_id is not null
       and child.origin_kind = 'creative_director'
       and child.status in ('succeeded', 'failed', 'canceled', 'timed_out', 'superseded')
  loop
    -- A report without its delegation projection is a durable crash-repair
    -- state. Win the action CAS before waking: a later recovery pass must not
    -- requeue a parent whose child report has already been acknowledged.
    v_delegation_error := null;
    if v_parent.report -> 'outcome' ->> 'outcome' = 'blocked' then
      v_delegation_error := jsonb_build_object(
        'schema', 'ToolError.v1',
        'kind', 'precondition_unmet',
        'message', coalesce(v_parent.report #>> '{outcome,reason}', 'Delegated domain reported a blocked prerequisite.'),
        'recoverable', true,
        'childRunId', v_parent.child_run_id,
        'unmetRequirements', jsonb_build_array(jsonb_build_object(
          'requirement', v_parent.report #>> '{outcome,precondition,requirement}',
          'because', v_parent.report #>> '{outcome,precondition,because}',
          'satisfyWith', jsonb_build_object(
            'tool', case v_parent.report #>> '{outcome,requiredDomain}'
              when 'audio' then 'delegate_audio'
              when 'visuals' then 'delegate_visuals'
              else 'request_approval'
            end,
            'inputHint', '{}'::jsonb
          )
        )),
        'suggestedNextTools', jsonb_build_array(jsonb_build_object(
          'tool', case v_parent.report #>> '{outcome,requiredDomain}'
            when 'audio' then 'delegate_audio'
            when 'visuals' then 'delegate_visuals'
            else 'request_approval'
          end,
          'inputHint', '{}'::jsonb
        )),
        'domainReport', v_parent.report
      );
    elsif v_parent.report -> 'outcome' ->> 'outcome' = 'question' then
      v_delegation_error := jsonb_build_object(
        'schema', 'ToolError.v1',
        'kind', 'invalid_input',
        'message', coalesce(v_parent.report #>> '{outcome,question}', 'Delegated domain requires a decision.'),
        'recoverable', true,
        'childRunId', v_parent.child_run_id,
        'domainReport', v_parent.report
      );
    end if;
    update public.actions delegation
       set status = case when v_delegation_error is null then 'applied'::public.action_status
                         else 'failed'::public.action_status end,
           output_asset_ids = coalesce(v_parent.output_asset_ids, '{}'),
           error = v_delegation_error,
           updated_at = now()
     where delegation.id = v_parent.root_action_id
       and delegation.status in ('proposed', 'running');
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      perform public.wake_orchestrator_dispatch(v_parent.run_id);
      parent_wakes := parent_wakes + 1;
    end if;
  end loop;

  domain_wait_wakes := 0;
  for v_wait in
    select run_id from public.orchestrator_runtime_recovery_projection
     where recovery_reason = 'unacknowledged_domain_wait'
  loop
    perform public.wake_orchestrator_dispatch(v_wait.run_id);
    domain_wait_wakes := domain_wait_wakes + 1;
  end loop;
  return next;
end;
$$;

revoke all on function public.reserve_orchestrator_run_budget(uuid, uuid, uuid, uuid, text, double precision, text) from public, anon, authenticated;
revoke all on function public.record_orchestrator_budget_billing(uuid, text, uuid, double precision) from public, anon, authenticated;
revoke all on function public.settle_orchestrator_run_budget(uuid, text, double precision, uuid, double precision) from public, anon, authenticated;
revoke all on function public.release_orchestrator_run_budget(uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_creator_direct_proposal_gate(uuid, uuid, uuid, uuid, text, double precision, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_creator_direct_proposal_gate(uuid, uuid, uuid, text, double precision, text, text) from public, anon, authenticated;
revoke all on function public.reject_creator_direct_proposal_gate(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.cancel_orchestrator_run_family(uuid, uuid) from public, anon, authenticated;
revoke all on function public.recover_orchestrator_runtime_controls() from public, anon, authenticated;
grant execute on function public.reserve_orchestrator_run_budget(uuid, uuid, uuid, uuid, text, double precision, text) to service_role;
grant execute on function public.record_orchestrator_budget_billing(uuid, text, uuid, double precision) to service_role;
grant execute on function public.settle_orchestrator_run_budget(uuid, text, double precision, uuid, double precision) to service_role;
grant execute on function public.release_orchestrator_run_budget(uuid, text, text) to service_role;
grant execute on function public.create_creator_direct_proposal_gate(uuid, uuid, uuid, uuid, text, double precision, text, timestamptz) to service_role;
grant execute on function public.consume_creator_direct_proposal_gate(uuid, uuid, uuid, text, double precision, text, text) to service_role;
grant execute on function public.reject_creator_direct_proposal_gate(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.cancel_orchestrator_run_family(uuid, uuid) to service_role;
grant execute on function public.recover_orchestrator_runtime_controls() to service_role;
