-- Qualify returned fields: PL/pgSQL output variables otherwise shadow the CTE
-- columns when PostgREST invokes the function.
create or replace function public.claim_orchestrator_dispatches(
  p_limit integer,
  p_lease_seconds integer
)
returns table (dispatch_id uuid, orchestrator_run_id uuid, workspace_id uuid, lease_token uuid)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidates as (
    select d.id from public.orchestrator_dispatches d
    where (d.status = 'queued' and d.available_at <= now())
       or (d.status = 'claimed' and d.lease_expires_at <= now())
    order by d.available_at asc, d.created_at asc
    for update skip locked
    limit greatest(p_limit, 1)
  ), claimed as (
    update public.orchestrator_dispatches d
    set status = 'claimed', lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
        attempts = d.attempts + 1, updated_at = now()
    from candidates c where d.id = c.id
    returning d.id, d.orchestrator_run_id, d.workspace_id, d.lease_token
  )
  select c.id as dispatch_id, c.orchestrator_run_id, c.workspace_id, c.lease_token
  from claimed c;
end;
$$;
