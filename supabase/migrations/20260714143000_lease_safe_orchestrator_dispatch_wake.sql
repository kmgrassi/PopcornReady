-- Async job completion or user approval may wake a dispatch while its current
-- worker still holds the lease. Preserve that wake without replacing the
-- active worker's lease; release will re-queue the row when it sees the marker.
alter table public.orchestrator_dispatches
  add column if not exists pending_wake_at timestamptz;

drop function if exists public.wake_orchestrator_dispatch(uuid, uuid);

create or replace function public.wake_orchestrator_dispatch(
  p_orchestrator_run_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_workspace_id uuid;
  v_woke boolean;
begin
  select p.workspace_id
    into v_workspace_id
  from public.orchestrator_runs r
  join public.projects p on p.id = r.project_id
  where r.id = p_orchestrator_run_id;

  if v_workspace_id is null then
    raise exception 'orchestrator run % has no project workspace', p_orchestrator_run_id
      using errcode = '23503';
  end if;

  insert into public.orchestrator_dispatches (
    orchestrator_run_id, workspace_id, status, available_at, lease_token, lease_expires_at
  ) values (
    p_orchestrator_run_id, v_workspace_id, 'queued', now(), null, null
  )
  on conflict (orchestrator_run_id) do update
  set status = case
        when public.orchestrator_dispatches.status = 'claimed'
          then public.orchestrator_dispatches.status
        else 'queued'::public.orchestrator_dispatch_status
      end,
      available_at = case
        when public.orchestrator_dispatches.status = 'claimed'
          then public.orchestrator_dispatches.available_at
        else now()
      end,
      lease_token = case
        when public.orchestrator_dispatches.status = 'claimed'
          then public.orchestrator_dispatches.lease_token
        else null
      end,
      lease_expires_at = case
        when public.orchestrator_dispatches.status = 'claimed'
          then public.orchestrator_dispatches.lease_expires_at
        else null
      end,
      pending_wake_at = case
        when public.orchestrator_dispatches.status = 'claimed' then now()
        else null
      end,
      updated_at = now()
  where public.orchestrator_dispatches.workspace_id = excluded.workspace_id
  returning true into v_woke;

  if not coalesce(v_woke, false) then
    raise exception 'dispatch workspace does not match run project workspace for run %',
      p_orchestrator_run_id using errcode = '23514';
  end if;
end;
$$;

create or replace function public.release_orchestrator_dispatch(
  p_dispatch_id uuid, p_lease_token uuid, p_delay_seconds integer, p_completed boolean
)
returns boolean language sql security definer set search_path = public as $$
  update public.orchestrator_dispatches
  set status = case
        when p_completed and pending_wake_at is null
          then 'completed'::public.orchestrator_dispatch_status
        else 'queued'::public.orchestrator_dispatch_status
      end,
      available_at = case
        when pending_wake_at is not null then pending_wake_at
        else now() + make_interval(secs => greatest(p_delay_seconds, 0))
      end,
      lease_token = null,
      lease_expires_at = null,
      pending_wake_at = null,
      updated_at = now()
  where id = p_dispatch_id and lease_token = p_lease_token
  returning true;
$$;

revoke all on function public.wake_orchestrator_dispatch(uuid) from public, anon, authenticated;
revoke all on function public.claim_orchestrator_dispatches(integer, integer)
  from public, anon, authenticated;
revoke all on function public.release_orchestrator_dispatch(uuid, uuid, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.wake_orchestrator_dispatch(uuid) to service_role;
grant execute on function public.claim_orchestrator_dispatches(integer, integer) to service_role;
grant execute on function public.release_orchestrator_dispatch(uuid, uuid, integer, boolean)
  to service_role;
