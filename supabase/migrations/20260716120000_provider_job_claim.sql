-- Provider execution is a distinct ownership boundary from worker recovery.
-- A job may be recovered for diagnostics, but only one claimant may cross the
-- non-idempotent provider-call boundary for a queued job.
alter table public.jobs
  add column if not exists provider_claim_token uuid,
  add column if not exists provider_claimed_at timestamptz;

create or replace function public.claim_provider_job_execution(
  p_workspace_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_stale_before timestamptz
)
returns table (state text, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
  v_claim_token uuid;
begin
  select * into v_job
    from public.jobs
   where id = p_job_id
     and workspace_id = p_workspace_id
     and project_id = p_project_id
   for update;

  if not found then
    raise exception 'job not found' using errcode = 'P0002';
  end if;

  if v_job.status in ('succeeded', 'failed', 'canceled') then
    return query select 'terminal'::text, null::uuid;
    return;
  end if;
  if v_job.status = 'running'
    and v_job.provider_claimed_at is not null
    and v_job.provider_claim_token is not null
    and v_job.provider_claimed_at <= p_stale_before then
    update public.jobs
       set status = 'failed',
           error = jsonb_build_object(
             'code', 'provider_claim_reconciliation_required',
             'message', 'Provider work stopped reporting progress and was not replayed automatically.'
           ),
           updated_at = clock_timestamp()
     where id = p_job_id;
    if v_job.action_id is not null then
      update public.actions
         set status = 'failed',
             error = jsonb_build_object('schema_version', 'action_error.v1')
               || jsonb_build_object(
                 'code', 'provider_claim_reconciliation_required',
                 'message', 'Provider work stopped reporting progress and was not replayed automatically.'
               )
       where id = v_job.action_id;
    end if;
    return query select 'terminal'::text, null::uuid;
    return;
  end if;
  if v_job.status = 'running' then
    return query select 'held'::text, null::uuid;
    return;
  end if;

  v_claim_token := gen_random_uuid();
  update public.jobs
     set status = 'running',
         provider_claim_token = v_claim_token,
         provider_claimed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = p_job_id;
  return query select 'claimed'::text, v_claim_token;
end;
$$;

create or replace function public.complete_provider_job_execution(
  p_workspace_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_claim_token uuid,
  p_status public.job_status,
  p_progress jsonb default '{}'::jsonb,
  p_result jsonb default null,
  p_error jsonb default null,
  p_action_output_asset_ids uuid[] default null
)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  if p_status not in ('succeeded', 'failed', 'canceled') then
    raise exception 'provider completion must be terminal' using errcode = '22023';
  end if;

  update public.jobs j
     set status = p_status,
         progress = j.progress || coalesce(p_progress, '{}'::jsonb),
         result = case when p_result is not null then p_result else j.result end,
         error = case when p_error is not null then p_error else j.error end,
         updated_at = clock_timestamp()
   where j.id = p_job_id
     and j.workspace_id = p_workspace_id
     and j.project_id = p_project_id
     and j.status = 'running'
     and j.provider_claim_token = p_claim_token
  returning j.* into v_job;

  if not found then
    return;
  end if;

  if v_job.action_id is not null then
    update public.actions a
       set status = case
             when p_status = 'succeeded' then 'applied'::public.action_status
             else 'failed'::public.action_status
           end,
           output_asset_ids = case
             when p_status = 'succeeded' and p_action_output_asset_ids is not null
               then p_action_output_asset_ids
             else a.output_asset_ids
           end,
           error = case
             when p_status = 'succeeded' then a.error
             when p_error is not null then jsonb_build_object('schema_version', 'action_error.v1') || p_error
             else a.error
           end
     where a.id = v_job.action_id;
  end if;

  return next v_job;
end;
$$;

create or replace function public.renew_provider_job_execution(
  p_workspace_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_renewed boolean;
begin
  update public.jobs j
     set provider_claimed_at = clock_timestamp(),
         progress = coalesce(j.progress, '{}'::jsonb)
           || jsonb_build_object('lastProgressAt', clock_timestamp()),
         updated_at = clock_timestamp()
   where j.id = p_job_id
     and j.workspace_id = p_workspace_id
     and j.project_id = p_project_id
     and j.status = 'running'
     and j.provider_claim_token = p_claim_token
  returning true into v_renewed;
  return coalesce(v_renewed, false);
end;
$$;

revoke all on function public.claim_provider_job_execution(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_provider_job_execution(uuid, uuid, uuid, uuid, public.job_status, jsonb, jsonb, jsonb, uuid[])
  from public, anon, authenticated;
revoke all on function public.renew_provider_job_execution(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_provider_job_execution(uuid, uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.complete_provider_job_execution(uuid, uuid, uuid, uuid, public.job_status, jsonb, jsonb, jsonb, uuid[])
  to service_role;
grant execute on function public.renew_provider_job_execution(uuid, uuid, uuid, uuid)
  to service_role;
