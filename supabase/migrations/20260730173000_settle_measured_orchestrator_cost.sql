-- Once provider work has returned, its measured cost is an accounting fact.
-- Admission still fences work against the estimate before dispatch, but
-- settlement must not strand a reservation merely because the estimate was
-- low. The caller may terminalize the work after this durable settlement.

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
  update public.orchestrator_budget_reservations
     set status = 'settled', actual_usd = p_actual_usd, settled_at = now(), updated_at = now()
   where id = v_reservation.id;
  update public.orchestrator_runs
     set spent_usd = spent_usd + p_actual_usd, updated_at = now()
   where id = v_reservation.orchestrator_run_id;
  if p_billing_user_id is not null and p_billable_usd > 0 then
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

comment on function public.settle_orchestrator_run_budget(
  uuid, text, double precision, uuid, double precision
) is
  'Settles measured provider cost exactly once; estimates govern admission, not post-spend accounting.';

-- Proposal-origin domain turns use the rerun work dispatch as their
-- root_action_id. Domain finalization may finish and record its callback, but
-- only fenced completeWork may apply that dispatch after validating output,
-- budget, child-run, and callback causation.
create or replace function public.preserve_active_rerun_work_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.tool = 'rerun_work_item_dispatch'
     and old.status in ('proposed', 'running')
     and new.status in ('applied', 'failed')
     and exists (
       select 1
         from public.rerun_execution_work_items work
        where work.dispatch_action_id = old.id
          and work.status in ('reserved', 'running')
     ) then
    new.status := old.status;
    new.output_asset_ids := old.output_asset_ids;
    new.error := old.error;
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_active_rerun_work_dispatch
  on public.actions;
create trigger preserve_active_rerun_work_dispatch
before update of status, output_asset_ids, error on public.actions
for each row execute function public.preserve_active_rerun_work_dispatch();

comment on function public.preserve_active_rerun_work_dispatch() is
  'Keeps proposal rerun dispatches pending while a domain rerun callback is still subject to fenced work completion.';
