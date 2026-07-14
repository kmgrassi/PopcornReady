-- Async job completion may wake a dispatch while its current worker is still
-- parking the run. Never replace that worker's lease: only queued/completed
-- rows may be made immediately available again.
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
      status = 'queued',
      available_at = now(),
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where public.orchestrator_dispatches.status <> 'claimed';
end;
$$;
