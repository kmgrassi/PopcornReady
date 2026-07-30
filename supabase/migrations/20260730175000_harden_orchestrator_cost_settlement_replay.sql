-- A settled reservation is an immutable accounting fact. Persist the complete
-- billing tuple at settlement and reject retries that attempt to change any
-- member of that tuple.

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
set search_path = pg_catalog, public
as $$
declare
  v_reservation public.orchestrator_budget_reservations%rowtype;
begin
  if p_actual_usd is null
     or p_actual_usd < 0
     or p_billable_usd is null
     or p_billable_usd < 0
     or (p_billable_usd > 0 and p_billing_user_id is null) then
    raise exception 'budget settlement requires non-negative costs and a billing user for billable cost'
      using errcode = '22023';
  end if;

  select * into v_reservation
    from public.orchestrator_budget_reservations b
   where b.project_id = p_project_id and b.reservation_key = p_reservation_key
   for update;
  if not found then
    raise exception 'budget reservation % not found', p_reservation_key using errcode = 'P0002';
  end if;

  if v_reservation.status = 'settled' then
    if v_reservation.actual_usd is distinct from p_actual_usd
       or v_reservation.billing_user_id is distinct from p_billing_user_id
       or v_reservation.billable_usd is distinct from p_billable_usd then
      raise exception 'budget_settlement_replay_mismatch for key %', p_reservation_key
        using errcode = '23505';
    end if;
    return query select false, v_reservation.orchestrator_run_id, v_reservation.actual_usd;
    return;
  end if;

  if v_reservation.status <> 'reserved' then
    raise exception 'cannot settle % reservation %', v_reservation.status, p_reservation_key
      using errcode = '55000';
  end if;

  if (v_reservation.billing_user_id is not null
      and v_reservation.billing_user_id is distinct from p_billing_user_id)
     or (v_reservation.billable_usd > 0
         and v_reservation.billable_usd is distinct from p_billable_usd) then
    raise exception 'budget_settlement_billing_mismatch for key %', p_reservation_key
      using errcode = '23505';
  end if;

  update public.orchestrator_budget_reservations
     set status = 'settled',
         actual_usd = p_actual_usd,
         billing_user_id = p_billing_user_id,
         billable_usd = p_billable_usd,
         settled_at = now(),
         updated_at = now()
   where id = v_reservation.id;

  update public.orchestrator_runs
     set spent_usd = spent_usd + p_actual_usd, updated_at = now()
   where id = v_reservation.orchestrator_run_id;

  if p_billable_usd > 0 then
    perform public.apply_credit_transaction(
      p_billing_user_id,
      -ceil(p_billable_usd * 2 * 100)::integer,
      'generation_debit'::public.credit_reason,
      v_reservation.orchestrator_run_id,
      v_reservation.action_id,
      p_billable_usd,
      'budget-settlement-credit:' || p_reservation_key,
      jsonb_build_object(
        'schemaVersion', 'BudgetSettlementCredit.v1',
        'reservationKey', p_reservation_key
      )
    );
  end if;

  return query select true, v_reservation.orchestrator_run_id, p_actual_usd;
end;
$$;

comment on function public.settle_orchestrator_run_budget(
  uuid, text, double precision, uuid, double precision
) is
  'Settles the immutable measured-cost and billing tuple exactly once; exact retries are no-ops and divergent retries fail.';
