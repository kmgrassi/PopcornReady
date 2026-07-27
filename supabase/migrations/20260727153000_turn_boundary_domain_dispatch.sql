-- Specialist-agent orchestration PR 6 — turn-boundary dispatch, reports, and
-- origin-specific completion (docs/scopes/specialist-agent-orchestration-prs.md).
--
-- Composes with (never forks) the PR 4 schema and the PR 5 runtime SQL:
--   * allocate_agent_session_sequence (20260716082800) allocates sequences.
--   * claim_agent_session_run / release_agent_session_run (20260727120000)
--     own the single active-run slot and the durable claim generation.
--   * wake_orchestrator_dispatch / release_orchestrator_dispatch
--     (20260714143000) own the lease-safe dispatch queue rows.
--
-- This migration adds ONLY the transactions PostgREST cannot express:
--   1. orchestrator_runs_wait_reason_shape now admits the 'domain' wait on a
--      ROOT run — the creative director parking on a delegated child. Domain
--      runs still must name their wait; every non-waiting run carries none.
--   2. create_domain_run_dispatch — ONE transaction that reserves the
--      idempotency key, allocates the next session sequence, creates the
--      task-bearing finite run (the root delegation action already exists:
--      it is the engine-reserved invocation action the run's root_action_id
--      points at), persists any required gate, and enqueues the existing
--      dispatch row. A replay returns the same identities.
--   3. finalize_domain_run_turn — ONE idempotent transaction that inserts the
--      immutable domain_report action + ordered action_assets, terminalizes
--      the child, compare-and-sets the guarded session summary, clears active
--      ownership (advancing the durable claim generation so stale provider
--      callbacks are fenced by jobs_fence_session_claim), applies the root
--      delegation action, and wakes the parent dispatch exactly once. A
--      creator-direct completion mutates no parent and wakes nothing.
--   4. claim_orchestrator_dispatches (recreated) — the dispatch claim now
--      locks/reserves the agent_sessions row for session-linked runs: only the
--      earliest eligible CONFIRMED sequence may take the single active slot,
--      runs in one session serialize across both origins, blocked dispatches
--      stay visibly queued, and the active run retains ownership across
--      media-job waits (owner re-claim keeps its generation).

set check_function_bodies = off;

-- ===========================================================================
-- 1. Root runs may park in the 'domain' wait while a delegated child runs.
-- ===========================================================================
alter table public.orchestrator_runs
  drop constraint orchestrator_runs_wait_reason_shape;
alter table public.orchestrator_runs
  add constraint orchestrator_runs_wait_reason_shape check (
    case
      when status <> 'waiting' then wait_reason is null
      when agent_session_id is not null then wait_reason is not null
      else wait_reason is null or wait_reason = 'domain'
    end
  );

-- ===========================================================================
-- 2. Single-transaction dispatch creation.
--    The caller derives p_run_id deterministically from the idempotency key,
--    so a concurrent duplicate aborts on the run PK / idempotency PK and its
--    retry lands in the replay branch, returning the SAME identities.
-- ===========================================================================
create or replace function public.create_domain_run_dispatch(
  p_idempotency_scope text,
  p_idempotency_key text,
  p_request_hash text,
  p_run_id uuid,
  p_project_id uuid,
  p_domain public.agent_domain,
  p_input_summary text,
  p_budget_usd numeric,
  p_task_kind public.domain_task_kind,
  p_task_params jsonb,
  p_origin_kind public.trusted_origin_kind,
  p_parent_run_id uuid,
  p_root_action_id uuid,
  p_origin_actor_id uuid,
  p_origin_request jsonb,
  p_continues_run_id uuid,
  p_pins jsonb,
  p_gate_stage text,
  p_enqueue boolean,
  p_max_children_per_root integer,
  p_max_continuation_chain integer,
  p_max_session_turns integer,
  p_max_blocked_reports_per_requirement integer
)
returns table (
  run_id uuid,
  agent_session_id uuid,
  session_sequence integer,
  created boolean,
  gate_id uuid,
  dispatch_enqueued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.idempotency%rowtype;
  v_existing public.orchestrator_runs%rowtype;
  v_alloc record;
  v_gate_id uuid;
  v_children integer;
  v_chain integer;
  v_blocked_reports integer;
  v_retry_requirement text;
  v_enqueued boolean := false;
begin
  if p_idempotency_scope is null or length(trim(p_idempotency_scope)) = 0
     or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0
     or p_request_hash is null or length(trim(p_request_hash)) = 0 then
    raise exception 'domain dispatch requires idempotency scope, key, and request hash'
      using errcode = '22023';
  end if;

  -- Reserve/replay the idempotency key. The record is completed inside this
  -- same transaction, so a crashed attempt leaves nothing behind and a
  -- concurrent duplicate serializes on the (scope, key) primary key.
  select * into v_record
    from public.idempotency i
   where i.scope = p_idempotency_scope
     and i.key = p_idempotency_key
   for update;
  if found then
    if v_record.body_hash is distinct from p_request_hash then
      raise exception 'domain_dispatch_idempotency_conflict: key % reused with changed input',
        p_idempotency_key using errcode = '23505';
    end if;
    select * into v_existing
      from public.orchestrator_runs r
     where r.id = (v_record.response_body ->> 'runId')::uuid
       and r.project_id = p_project_id;
    if not found then
      raise exception 'domain dispatch idempotency record has no run for key %',
        p_idempotency_key using errcode = 'P0002';
    end if;
    return query select
      v_existing.id,
      v_existing.agent_session_id,
      v_existing.session_sequence,
      false,
      (v_record.response_body ->> 'gateId')::uuid,
      false;
    return;
  end if;

  -- A bounded retry applies only to the exact blocked requirement on a
  -- root-origin continuation. It deliberately runs AFTER idempotency
  -- replay, so an existing successful dispatch can always replay its durable
  -- identity even after later reports exhaust the retry budget.
  if p_origin_kind = 'creative_director' and p_continues_run_id is not null then
    -- Serialize retry admission through the root row, then prove the supplied
    -- continuation belongs to THIS root. Deriving the requirement here keeps
    -- an internal caller from bypassing the guard by omitting a client-side
    -- hint and closes the concurrent admission race.
    perform 1
      from public.orchestrator_runs r
     where r.id = p_parent_run_id and r.project_id = p_project_id
     for update;
    if not found then
      raise exception 'root run % not found for domain continuation', p_parent_run_id
        using errcode = '22023';
    end if;
    select report.params #>> '{outcome,precondition,requirement}'
      into v_retry_requirement
      from public.orchestrator_runs predecessor
      join public.actions report
        on report.orchestrator_run_id = predecessor.id
       and report.tool = 'domain_report'
     where predecessor.id = p_continues_run_id
       and predecessor.parent_run_id = p_parent_run_id
       and predecessor.origin_kind = 'creative_director'
       and report.params -> 'outcome' ->> 'outcome' = 'blocked';
    if v_retry_requirement is not null then
      select count(*) into v_blocked_reports
        from public.orchestrator_runs r
        join public.actions a
          on a.orchestrator_run_id = r.id
         and a.tool = 'domain_report'
       where r.parent_run_id = p_parent_run_id
         and a.params -> 'outcome' ->> 'outcome' = 'blocked'
         and a.params #>> '{outcome,precondition,requirement}' = v_retry_requirement;
      if v_blocked_reports >= greatest(p_max_blocked_reports_per_requirement, 1) then
        raise exception 'domain_requirement_retry_limit: requirement % has % blocked reports in root %',
          v_retry_requirement, v_blocked_reports, p_parent_run_id using errcode = '54000';
      end if;
    end if;
  end if;

  -- Depth is enforced by orchestrator_runs_validate_agent_links; bounded
  -- fan-out and continuation chains are enforced here so two domains cannot
  -- bounce the same unmet requirement (or a root cannot spawn children)
  -- forever.
  if p_origin_kind = 'creative_director' then
    select count(*) into v_children
      from public.orchestrator_runs r
     where r.parent_run_id = p_parent_run_id;
    if v_children >= greatest(p_max_children_per_root, 1) then
      raise exception 'domain_child_run_limit: root run % already has % child runs',
        p_parent_run_id, v_children using errcode = '54000';
    end if;
  end if;

  if p_continues_run_id is not null then
    with recursive chain as (
      select r.id, r.continues_run_id, 1 as depth
        from public.orchestrator_runs r
       where r.id = p_continues_run_id
      union all
      select r2.id, r2.continues_run_id, chain.depth + 1
        from public.orchestrator_runs r2
        join chain on r2.id = chain.continues_run_id
       where chain.depth <= greatest(p_max_continuation_chain, 1)
    )
    select coalesce(max(depth), 0) into v_chain from chain;
    if v_chain >= greatest(p_max_continuation_chain, 1) then
      raise exception 'domain_continuation_limit: run % continuation chain reached %',
        p_continues_run_id, v_chain using errcode = '54000';
    end if;
  end if;

  select * into v_alloc
    from public.allocate_agent_session_sequence(p_project_id, p_domain);
  if v_alloc.allocated_sequence > greatest(p_max_session_turns, 1) then
    -- The whole transaction aborts, so the burned sequence rolls back too.
    raise exception 'domain_session_turn_limit: session % reached sequence %',
      v_alloc.session_id, v_alloc.allocated_sequence using errcode = '54000';
  end if;

  insert into public.orchestrator_runs (
    id, project_id, status, input_summary, budget_usd, spent_usd,
    agent_role, agent_session_id, session_sequence,
    task_kind, task_params, origin_kind,
    parent_run_id, root_action_id, origin_actor_id, origin_request,
    continues_run_id, pins
  ) values (
    p_run_id, p_project_id, 'queued', p_input_summary, p_budget_usd, 0,
    p_domain::text::public.agent_role, v_alloc.session_id, v_alloc.allocated_sequence,
    p_task_kind, p_task_params, p_origin_kind,
    p_parent_run_id, p_root_action_id, p_origin_actor_id, p_origin_request,
    p_continues_run_id, p_pins
  );

  if p_gate_stage is not null and length(trim(p_gate_stage)) > 0 then
    insert into public.orchestrator_run_gates (orchestrator_run_id, stage, status)
    values (p_run_id, p_gate_stage, 'pending')
    returning id into v_gate_id;
  end if;

  -- An unconfirmed quote is created without a dispatch row and therefore can
  -- never occupy the session execution slot.
  if coalesce(p_enqueue, true) then
    perform public.wake_orchestrator_dispatch(p_run_id);
    v_enqueued := true;
  end if;

  insert into public.idempotency (scope, key, body_hash, status, response_body)
  values (
    p_idempotency_scope,
    p_idempotency_key,
    p_request_hash,
    200,
    jsonb_build_object(
      'schemaVersion', 'DomainRunDispatch.v1',
      'runId', p_run_id,
      'sessionId', v_alloc.session_id,
      'sessionSequence', v_alloc.allocated_sequence,
      'gateId', v_gate_id
    )
  );

  return query select
    p_run_id, v_alloc.session_id, v_alloc.allocated_sequence,
    true, v_gate_id, v_enqueued;
end;
$$;

-- ===========================================================================
-- 3. Single-transaction idempotent turn finalization.
-- ===========================================================================
create or replace function public.finalize_domain_run_turn(
  p_project_id uuid,
  p_run_id uuid,
  p_report_action_id uuid,
  p_report jsonb,
  p_output_asset_ids uuid[],
  p_output_roles text[],
  p_expected_claim_generation bigint,
  p_summary jsonb,
  p_summary_through_sequence integer,
  p_expected_summary_version integer
)
returns table (
  report_action_id uuid,
  performed boolean,
  recipient text,
  parent_run_id uuid,
  woke_parent boolean,
  summary_applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.orchestrator_runs%rowtype;
  v_session public.agent_sessions%rowtype;
  v_existing_id uuid;
  v_existing_params jsonb;
  v_rows integer := 0;
  v_performed boolean := false;
  v_woke boolean := false;
  v_summary_applied boolean := false;
  v_delegation_error jsonb;
  v_missing uuid;
  i integer;
begin
  select * into v_run
    from public.orchestrator_runs r
   where r.id = p_run_id and r.project_id = p_project_id
   for update;
  if not found then
    raise exception 'domain run % not found', p_run_id using errcode = 'P0002';
  end if;
  if v_run.agent_session_id is null then
    raise exception 'run % is not a finite domain run', p_run_id
      using errcode = 'check_violation';
  end if;
  if p_report ->> 'schemaVersion' is distinct from 'DomainReport.v1'
     or coalesce(p_report -> 'outcome' ->> 'outcome', '') not in ('done', 'blocked', 'question') then
    raise exception 'invalid domain report payload for run %', p_run_id
      using errcode = '22023';
  end if;

  select * into v_session
    from public.agent_sessions s
   where s.id = v_run.agent_session_id
   for update;

  select a.id, a.params into v_existing_id, v_existing_params
    from public.actions a
   where a.orchestrator_run_id = p_run_id and a.tool = 'domain_report';

  if v_existing_id is not null then
    -- Only the SAME immutable report replays; anything else is a conflict.
    if v_existing_id is distinct from p_report_action_id
       or v_existing_params is distinct from p_report then
      raise exception 'domain_report_replay_mismatch: run % already has report %',
        p_run_id, v_existing_id using errcode = '23505';
    end if;
    if v_run.status in ('succeeded', 'failed', 'canceled', 'timed_out', 'superseded') then
      -- Fully finalized: pure no-op replay — no re-terminalize, no re-wake.
      return query select
        v_existing_id, false, v_run.completion_recipient,
        case when v_run.completion_recipient = 'creative_director'
             then v_run.parent_run_id end,
        false, false;
      return;
    end if;
    -- Crash-heal: the report exists but the terminal transition did not
    -- commit (this cannot happen from THIS function — it is atomic — but a
    -- PR 5 appendDomainReport caller may have crashed before completing).
    -- Fall through and finish the transition under the same fences.
  else
    -- Late/stale reports are fenced: a terminal (canceled/superseded/…) run
    -- accepts no report, and the reporting run must still HOLD the session's
    -- single active-run slot at the expected durable claim generation.
    if v_run.status in ('succeeded', 'failed', 'canceled', 'timed_out', 'superseded') then
      raise exception 'stale_domain_report: run % is already terminal (%)',
        p_run_id, v_run.status using errcode = '55000';
    end if;
    if v_session.active_run_id is distinct from p_run_id then
      raise exception 'stale_session_claim: run % does not hold session % active ownership',
        p_run_id, v_session.id using errcode = '55000';
    end if;
    if p_expected_claim_generation is not null
       and v_session.claim_generation is distinct from p_expected_claim_generation then
      raise exception 'stale_session_claim: run % expected generation % but session % is at %',
        p_run_id, p_expected_claim_generation, v_session.id, v_session.claim_generation
        using errcode = '55000';
    end if;

    if p_output_asset_ids is not null and array_length(p_output_asset_ids, 1) > 0 then
      if p_output_roles is null
         or array_length(p_output_roles, 1) is distinct from array_length(p_output_asset_ids, 1) then
        raise exception 'report output roles must pair with output asset ids'
          using errcode = '22023';
      end if;
      select oid into v_missing
        from unnest(p_output_asset_ids) as oid
        left join public.assets a on a.id = oid and a.project_id = p_project_id
       where a.id is null
       limit 1;
      if v_missing is not null then
        raise exception 'report output asset % does not belong to project %',
          v_missing, p_project_id using errcode = '23503';
      end if;
    end if;

    insert into public.actions (
      id, project_id, orchestrator_run_id, tool, status, params,
      input_asset_ids, output_asset_ids, job_ids
    ) values (
      p_report_action_id, p_project_id, p_run_id, 'domain_report', 'applied',
      p_report, '{}', coalesce(p_output_asset_ids, '{}'), '{}'
    );

    if p_output_asset_ids is not null then
      for i in 1 .. coalesce(array_length(p_output_asset_ids, 1), 0) loop
        insert into public.action_assets (
          project_id, action_id, asset_id, direction, role, ordinal
        ) values (
          p_project_id, p_report_action_id, p_output_asset_ids[i],
          'output', p_output_roles[i], i - 1
        )
        on conflict (action_id, direction, ordinal) do nothing;
      end loop;
    end if;
  end if;

  -- Win-the-transition: exactly one caller performs the terminal update (and
  -- therefore the delegation apply + the single parent wake below).
  update public.orchestrator_runs r
     set status = 'succeeded', completed_at = now(), wait_reason = null,
         updated_at = now()
   where r.id = p_run_id
     and r.status in ('queued', 'running', 'waiting');
  get diagnostics v_rows = row_count;
  v_performed := v_rows > 0;

  -- Guarded summary CAS: an older run can never overwrite newer context.
  if v_performed
     and p_summary is not null
     and v_session.summary_version = p_expected_summary_version
     and p_summary_through_sequence >= v_session.summary_through_sequence
     and p_summary_through_sequence < v_session.next_sequence then
    update public.agent_sessions s
       set summary = p_summary,
           summary_through_sequence = p_summary_through_sequence,
           summary_version = s.summary_version + 1,
           updated_at = now()
     where s.id = v_session.id
       and s.summary_version = p_expected_summary_version;
    get diagnostics v_rows = row_count;
    v_summary_applied := v_rows > 0;
  end if;

  -- Clear active ownership, advancing the durable claim generation so a
  -- reclaimed worker's provider callbacks are fenced (jobs_fence_session_claim).
  update public.agent_sessions s
     set active_run_id = null,
         claim_generation = s.claim_generation + 1,
         updated_at = now()
   where s.id = v_session.id
     and s.active_run_id = p_run_id;

  -- Origin-specific completion: only a root-origin child applies its
  -- delegation action and wakes its parent — exactly once, tied to winning
  -- the terminal transition. Creator-direct completion mutates no parent.
  if v_performed and v_run.origin_kind = 'creative_director' then
    if p_report -> 'outcome' ->> 'outcome' = 'blocked' then
      v_delegation_error := jsonb_build_object(
        'schema', 'ToolError.v1',
        'kind', 'precondition_unmet',
        'message', coalesce(p_report #>> '{outcome,reason}', 'Delegated domain reported a blocked prerequisite.'),
        'recoverable', true,
        'childRunId', p_run_id,
        'unmetRequirements', jsonb_build_array(jsonb_build_object(
          'requirement', p_report #>> '{outcome,precondition,requirement}',
          'because', p_report #>> '{outcome,precondition,because}',
          'satisfyWith', jsonb_build_object(
            'tool', case p_report #>> '{outcome,requiredDomain}'
              when 'audio' then 'delegate_audio'
              when 'visuals' then 'delegate_visuals'
              else 'request_approval'
            end,
            'inputHint', '{}'::jsonb
          )
        )),
        'suggestedNextTools', jsonb_build_array(jsonb_build_object(
          'tool', case p_report #>> '{outcome,requiredDomain}'
            when 'audio' then 'delegate_audio'
            when 'visuals' then 'delegate_visuals'
            else 'request_approval'
          end,
          'inputHint', '{}'::jsonb
        )),
        'domainReport', p_report
      );
    elsif p_report -> 'outcome' ->> 'outcome' = 'question' then
      v_delegation_error := jsonb_build_object(
        'schema', 'ToolError.v1',
        'kind', 'invalid_input',
        'message', coalesce(p_report #>> '{outcome,question}', 'Delegated domain requires a decision.'),
        'recoverable', true,
        'childRunId', p_run_id,
        'domainReport', p_report
      );
    end if;
    update public.actions a
       set status = case when v_delegation_error is null then 'applied'::public.action_status
                         else 'failed'::public.action_status end,
           output_asset_ids = coalesce(p_output_asset_ids, '{}'),
           error = v_delegation_error,
           updated_at = now()
     where a.id = v_run.root_action_id
       and a.status in ('proposed', 'running');
    perform public.wake_orchestrator_dispatch(v_run.parent_run_id);
    v_woke := true;
  end if;

  return query select
    p_report_action_id, v_performed, v_run.completion_recipient,
    case when v_run.completion_recipient = 'creative_director'
         then v_run.parent_run_id end,
    v_woke, v_summary_applied;
end;
$$;

-- ===========================================================================
-- 4. Atomic domain cancellation. A terminal run must never remain the active
--    session owner, and a canceled claim must fence every causal provider job.
-- ===========================================================================
create or replace function public.cancel_domain_run(
  p_project_id uuid,
  p_run_id uuid
)
returns table (canceled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.orchestrator_runs%rowtype;
  v_rows integer := 0;
begin
  select * into v_run
    from public.orchestrator_runs r
   where r.id = p_run_id and r.project_id = p_project_id
   for update;
  if not found then
    raise exception 'domain run % not found', p_run_id using errcode = 'P0002';
  end if;
  if v_run.agent_session_id is null then
    raise exception 'run % is not a finite domain run', p_run_id using errcode = 'check_violation';
  end if;

  -- Lock the session before changing the terminal state, keeping claim
  -- release and provider-job fencing in this same transaction.
  perform 1
    from public.agent_sessions s
   where s.id = v_run.agent_session_id
   for update;

  update public.orchestrator_runs r
     set status = 'canceled', completed_at = now(), wait_reason = null,
         updated_at = now()
   where r.id = p_run_id
     and r.status in ('queued', 'running', 'waiting');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return query select false;
    return;
  end if;

  update public.agent_sessions s
     set active_run_id = null,
         claim_generation = s.claim_generation + 1,
         updated_at = now()
   where s.id = v_run.agent_session_id
     and s.active_run_id = p_run_id;

  -- Cancellation is intentionally not subject to the stale-claim terminal
  -- write fence: this transaction is the authoritative cleanup path.
  update public.jobs j
     set status = 'canceled', updated_at = now()
   where j.project_id = p_project_id
     and j.status in ('queued', 'running')
     and exists (
       select 1
         from public.actions a
        where a.id = j.action_id
          and a.orchestrator_run_id = p_run_id
     );

  return query select true;
end;
$$;

-- ===========================================================================
-- 5. Session-aware dispatch claim. Recreated because the return set gains the
--    session claim columns a worker must stamp onto provider jobs.
-- ===========================================================================
drop function public.claim_orchestrator_dispatches(integer, integer);

create function public.claim_orchestrator_dispatches(
  p_limit integer,
  p_lease_seconds integer
)
returns table (
  dispatch_id uuid,
  orchestrator_run_id uuid,
  workspace_id uuid,
  lease_token uuid,
  agent_session_id uuid,
  session_claim_generation bigint
)
language plpgsql
security definer
set search_path = public
set lock_timeout = '2s'
as $$
declare
  v_candidate record;
  v_run record;
  v_claim record;
  v_session_id uuid;
  v_generation bigint;
  v_claimed integer := 0;
  v_limit integer := greatest(p_limit, 1);
begin
  for v_candidate in
    select d.id, d.orchestrator_run_id, d.workspace_id
      from public.orchestrator_dispatches d
     where (d.status = 'queued' and d.available_at <= now())
        or (d.status = 'claimed' and d.lease_expires_at <= now())
     order by d.available_at asc, d.created_at asc
       for update skip locked
     -- Headroom: some candidates may be session-blocked and stay queued.
     limit v_limit * 4
  loop
    exit when v_claimed >= v_limit;
    v_session_id := null;
    v_generation := null;

    select r.id, r.project_id, r.agent_session_id as session_id,
           r.session_sequence, r.status
      into v_run
      from public.orchestrator_runs r
     where r.id = v_candidate.orchestrator_run_id;

    if v_run.session_id is not null then
      -- An unconfirmed run (pending/reached gate — e.g. an unapproved quote)
      -- never occupies the session slot; it stays visibly queued.
      if exists (
        select 1 from public.orchestrator_run_gates g
         where g.orchestrator_run_id = v_run.id
           and g.status in ('pending', 'reached')
      ) then
        update public.orchestrator_dispatches d
           set available_at = now() + interval '10 seconds', updated_at = now()
         where d.id = v_candidate.id and d.status = 'queued';
        continue;
      end if;

      -- Only the earliest eligible confirmed sequence in the session may run.
      if exists (
        select 1 from public.orchestrator_runs r2
         where r2.agent_session_id = v_run.session_id
           and r2.status in ('queued', 'running', 'waiting')
           and r2.session_sequence < v_run.session_sequence
           and not exists (
             select 1 from public.orchestrator_run_gates g2
              where g2.orchestrator_run_id = r2.id
                and g2.status in ('pending', 'reached')
           )
      ) then
        update public.orchestrator_dispatches d
           set available_at = now() + interval '5 seconds', updated_at = now()
         where d.id = v_candidate.id and d.status = 'queued';
        continue;
      end if;

      -- One active finite run per session across both origins, via the
      -- canonical claim (terminal-first; owner re-claim keeps its generation,
      -- so an active run retains ownership across media-job waits).
      select * into v_claim
        from public.claim_agent_session_run(v_run.project_id, v_run.session_id, v_run.id);
      if v_claim.state = 'held' then
        update public.orchestrator_dispatches d
           set available_at = now() + interval '5 seconds', updated_at = now()
         where d.id = v_candidate.id and d.status = 'queued';
        continue;
      elsif v_claim.state = 'terminal' then
        -- Nothing left to drive: retire the dispatch row.
        update public.orchestrator_dispatches d
           set status = 'completed', lease_token = null, lease_expires_at = null,
               pending_wake_at = null, updated_at = now()
         where d.id = v_candidate.id;
        continue;
      end if;
      v_session_id := v_run.session_id;
      v_generation := v_claim.claim_generation;
    end if;

    return query
      update public.orchestrator_dispatches d
         set status = 'claimed', lease_token = gen_random_uuid(),
             lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
             attempts = d.attempts + 1, updated_at = now()
       where d.id = v_candidate.id
      returning d.id, d.orchestrator_run_id, d.workspace_id, d.lease_token,
                v_session_id, v_generation;
    v_claimed := v_claimed + 1;
  end loop;
end;
$$;

revoke all on function public.create_domain_run_dispatch(
  text, text, text, uuid, uuid, public.agent_domain, text, numeric,
  public.domain_task_kind, jsonb, public.trusted_origin_kind,
  uuid, uuid, uuid, jsonb, uuid, jsonb, text, boolean, integer, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.finalize_domain_run_turn(
  uuid, uuid, uuid, jsonb, uuid[], text[], bigint, jsonb, integer, integer
) from public, anon, authenticated;
revoke all on function public.claim_orchestrator_dispatches(integer, integer)
  from public, anon, authenticated;
revoke all on function public.cancel_domain_run(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_domain_run_dispatch(
  text, text, text, uuid, uuid, public.agent_domain, text, numeric,
  public.domain_task_kind, jsonb, public.trusted_origin_kind,
  uuid, uuid, uuid, jsonb, uuid, jsonb, text, boolean, integer, integer, integer, integer
) to service_role;
grant execute on function public.finalize_domain_run_turn(
  uuid, uuid, uuid, jsonb, uuid[], text[], bigint, jsonb, integer, integer
) to service_role;
grant execute on function public.claim_orchestrator_dispatches(integer, integer)
  to service_role;
grant execute on function public.cancel_domain_run(uuid, uuid)
  to service_role;
