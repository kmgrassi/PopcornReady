-- Async job completion or user approval may wake a dispatch while its current
-- worker still holds the lease. Preserve that wake without replacing the
-- active worker's lease; release will re-queue the row when it sees the marker.
alter table public.orchestrator_dispatches
  add column if not exists pending_wake_at timestamptz;

create or replace function public.wake_orchestrator_dispatch(
  p_orchestrator_run_id uuid,
  p_workspace_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.orchestrator_dispatches (
    orchestrator_run_id, workspace_id, status, available_at, lease_token, lease_expires_at
  ) values (
    p_orchestrator_run_id, p_workspace_id, 'queued', now(), null, null
  )
  on conflict (orchestrator_run_id) do update
  set workspace_id = excluded.workspace_id,
      status = case
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
  ;
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
