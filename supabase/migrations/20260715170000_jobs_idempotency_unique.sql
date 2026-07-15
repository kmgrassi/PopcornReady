-- NULL idempotency keys remain unconstrained by PostgreSQL unique semantics.
-- Non-null keys are unique inside the tenant/project/job-type boundary so
-- concurrent retries resolve to one durable job.
with ranked as (
  select
    id,
    row_number() over (
      partition by workspace_id, project_id, type, idempotency_key
      order by created_at asc, id asc
    ) as duplicate_rank
  from public.jobs
  where idempotency_key is not null
)
update public.jobs as jobs
set idempotency_key = null
from ranked
where jobs.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists jobs_tenant_type_idempotency_uidx
  on public.jobs (workspace_id, project_id, type, idempotency_key);

-- Job control fields include privileged recovery execution envelopes. Direct
-- client reads and writes are disabled; creator/operator projections come from
-- the authenticated API, while the service role owns the raw rows.
drop policy if exists jobs_owner on public.jobs;
drop policy if exists jobs_owner_read on public.jobs;
drop policy if exists jobs_public_read on public.jobs;

create or replace function public.update_active_job(
  p_workspace_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_progress_patch jsonb default '{}'::jsonb,
  p_status public.job_status default null,
  p_result jsonb default null,
  p_error jsonb default null,
  p_recovery_lease_owner_id text default null
)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  update public.jobs j
  set
    status = coalesce(p_status, j.status),
    progress =
      (j.progress || coalesce(p_progress_patch, '{}'::jsonb))
      || case when j.progress ? 'startedAt'
           then jsonb_build_object('startedAt', j.progress->'startedAt') else '{}'::jsonb end
      || case when j.progress ? 'lastProgressAt' and not (coalesce(p_progress_patch, '{}'::jsonb) ? 'lastProgressAt')
           then jsonb_build_object('lastProgressAt', j.progress->'lastProgressAt') else '{}'::jsonb end,
    result = case when p_result is not null then p_result else j.result end,
    error = case when p_error is not null then p_error else j.error end,
    updated_at = now()
  where j.id = p_job_id
    and j.workspace_id = p_workspace_id
    and j.project_id = p_project_id
    and j.status in ('queued', 'running')
    and (
      (p_recovery_lease_owner_id is null and not (j.progress ? 'recoveryLease'))
      or j.progress #>> '{recoveryLease,ownerId}' = p_recovery_lease_owner_id
    )
  returning j.*;
$$;

revoke all on function public.update_active_job(uuid, uuid, uuid, jsonb, public.job_status, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.update_active_job(uuid, uuid, uuid, jsonb, public.job_status, jsonb, jsonb, text)
  to service_role;

-- Recovery claims re-check staleness against the database timestamp instead of
-- round-tripping updated_at through JavaScript, which truncates PostgreSQL's
-- microseconds. This keeps the claim atomic without a lossy timestamp CAS.
create or replace function public.claim_job_recovery(
  p_workspace_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_owner_id text,
  p_claimed_at timestamptz,
  p_expires_at timestamptz,
  p_stale_before timestamptz
)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  update public.jobs j
  set
    status = 'running',
    progress = j.progress || jsonb_build_object(
      'heartbeatAt', p_claimed_at,
      'attempt', coalesce((j.progress->>'attempt')::integer, 0) + 1,
      'recoveryLease', jsonb_build_object(
        'ownerId', p_owner_id,
        'claimedAt', p_claimed_at,
        'expiresAt', p_expires_at
      )
    ),
    updated_at = p_claimed_at
  where j.id = p_job_id
    and j.workspace_id = p_workspace_id
    and j.project_id = p_project_id
    and j.status in ('queued', 'running')
    and j.updated_at <= p_stale_before
  returning j.*;
$$;

revoke all on function public.claim_job_recovery(uuid, uuid, uuid, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_job_recovery(uuid, uuid, uuid, text, timestamptz, timestamptz, timestamptz)
  to service_role;
