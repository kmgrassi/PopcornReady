-- Durable, lease-based dispatch queue for orchestrator runs.  The API records
-- work; one of any number of workers claims and drives it.
create type public.orchestrator_dispatch_status as enum ('queued', 'claimed', 'completed');

create table public.orchestrator_dispatches (
  id uuid primary key default gen_random_uuid(),
  orchestrator_run_id uuid not null unique references public.orchestrator_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status public.orchestrator_dispatch_status not null default 'queued',
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orchestrator_dispatches_claim_idx on public.orchestrator_dispatches (status, available_at, lease_expires_at);

alter table public.orchestrator_dispatches enable row level security;

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
  ) select id, orchestrator_run_id, workspace_id, lease_token from claimed;
end;
$$;

create or replace function public.release_orchestrator_dispatch(
  p_dispatch_id uuid, p_lease_token uuid, p_delay_seconds integer, p_completed boolean
)
returns boolean language sql security definer set search_path = public as $$
  update public.orchestrator_dispatches
  set status = case when p_completed then 'completed'::public.orchestrator_dispatch_status else 'queued'::public.orchestrator_dispatch_status end,
      available_at = now() + make_interval(secs => greatest(p_delay_seconds, 0)),
      lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_dispatch_id and lease_token = p_lease_token
  returning true;
$$;
