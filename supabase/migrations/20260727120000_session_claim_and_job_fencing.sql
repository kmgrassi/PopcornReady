-- Specialist-agent orchestration PR 5 — session claim transitions and durable
-- session-generation job fencing (docs/scopes/specialist-agent-orchestration-prs.md).
--
-- PR 4 (20260716082800) created `agent_sessions` with the single
-- active-ownership slot and the monotonic `claim_generation`, plus
-- `jobs.session_claim_generation`. This migration adds the ONLY runtime SQL
-- those columns need that PostgREST cannot express atomically:
--
--   1. claim_agent_session_run / release_agent_session_run — active-ownership
--      transitions that increment the durable claim generation in the same
--      statement that changes ownership.
--   2. jobs_fence_session_claim — a finalization fence: a provider job
--      launched under a session claim generation is rejected at terminal
--      write time if the session's claim generation has advanced (a stale,
--      reclaimed worker cannot commit late). This composes with the
--      provider-claim token fence from 20260716120000 (which serializes WHO
--      may cross the provider boundary); this trigger guards WHEN the result
--      may still be applied. It fires on every finalization path — direct
--      store updates and complete_provider_job_execution alike — without
--      replacing that function.
--
-- PR 6 extends claiming to earliest-eligible-sequence selection under the
-- dispatch lease; this migration deliberately keeps the claim narrow
-- (claim/release a specific run) so that extension is additive.

set check_function_bodies = off;

-- ===========================================================================
-- 1. Atomic session-claim transitions. Locking the session row serializes
--    concurrent claimants; the generation increments exactly when ownership
--    changes, never on an idempotent re-claim by the current owner.
-- ===========================================================================
create or replace function public.claim_agent_session_run(
  p_project_id uuid,
  p_session_id uuid,
  p_run_id uuid
)
returns table (state text, claim_generation bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.agent_sessions%rowtype;
  v_run_session uuid;
  v_run_status public.orchestrator_run_status;
  v_generation bigint;
begin
  select * into v_session
    from public.agent_sessions s
   where s.id = p_session_id
     and s.project_id = p_project_id
   for update;
  if not found then
    raise exception 'agent session not found' using errcode = 'P0002';
  end if;

  select r.agent_session_id, r.status into v_run_session, v_run_status
    from public.orchestrator_runs r
   where r.id = p_run_id
     and r.project_id = p_project_id;
  if not found or v_run_session is distinct from p_session_id then
    raise exception 'run % does not belong to session %', p_run_id, p_session_id
      using errcode = '23514';
  end if;

  -- Idempotent re-claim by the current owner: same generation, no increment.
  if v_session.active_run_id = p_run_id then
    return query select 'claimed'::text, v_session.claim_generation;
    return;
  end if;
  if v_session.active_run_id is not null then
    return query select 'held'::text, null::bigint;
    return;
  end if;
  if v_run_status in ('succeeded', 'failed', 'canceled', 'timed_out', 'superseded') then
    return query select 'terminal'::text, null::bigint;
    return;
  end if;

  update public.agent_sessions s
     set active_run_id = p_run_id,
         claim_generation = s.claim_generation + 1,
         updated_at = now()
   where s.id = p_session_id
  returning s.claim_generation into v_generation;
  return query select 'claimed'::text, v_generation;
end;
$$;

create or replace function public.release_agent_session_run(
  p_project_id uuid,
  p_session_id uuid,
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released boolean;
begin
  update public.agent_sessions s
     set active_run_id = null,
         claim_generation = s.claim_generation + 1,
         updated_at = now()
   where s.id = p_session_id
     and s.project_id = p_project_id
     and s.active_run_id = p_run_id
  returning true into v_released;
  return coalesce(v_released, false);
end;
$$;

revoke all on function public.claim_agent_session_run(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.release_agent_session_run(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_agent_session_run(uuid, uuid, uuid)
  to service_role;
grant execute on function public.release_agent_session_run(uuid, uuid, uuid)
  to service_role;

-- ===========================================================================
-- 2. Stale-claim finalization fence. The job's recorded generation is
--    immutable once launched; a terminal write (succeeded/failed) is rejected
--    when the owning session's durable claim generation has advanced.
--    `canceled` stays unfenced so the new claim owner can clean up stale
--    jobs. The current generation is derived through the canonical
--    provenance chain (jobs.action_id -> actions.orchestrator_run_id ->
--    orchestrator_runs.agent_session_id) — no redundant session column is
--    stamped onto jobs or actions.
-- ===========================================================================
create or replace function public.jobs_fence_session_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current bigint;
begin
  if new.session_claim_generation is distinct from old.session_claim_generation then
    raise exception 'jobs.session_claim_generation is immutable once launched'
      using errcode = 'check_violation';
  end if;

  if old.status in ('queued', 'running')
     and new.status in ('succeeded', 'failed')
     and new.status is distinct from old.status then
    select s.claim_generation into v_current
      from public.actions a
      join public.orchestrator_runs r on r.id = a.orchestrator_run_id
      join public.agent_sessions s on s.id = r.agent_session_id
     where a.id = coalesce(new.action_id, old.action_id);
    if v_current is not null
       and v_current is distinct from old.session_claim_generation then
      raise exception
        'stale_session_claim: job % was launched under session claim generation % but the session is now at %',
        old.id, old.session_claim_generation, v_current
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

create trigger jobs_fence_session_claim
  before update on public.jobs
  for each row
  when (old.session_claim_generation is not null)
  execute function public.jobs_fence_session_claim();
