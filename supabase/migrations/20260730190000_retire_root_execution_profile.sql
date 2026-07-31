-- Selective-regeneration PR 7B: destructive root-profile retirement.
--
-- DEPLOYMENT PRECONDITION: every application instance must run PR 7A or newer.
-- Older binaries read and write root_execution_profile and cannot overlap this
-- migration. The migration holds the profile fence until historical flat/null
-- roots are structurally non-resumable, then removes the compatibility schema.

begin;

lock table public.orchestrator_runs in access exclusive mode;

create temporary table pr7b_legacy_roots (
  id uuid primary key,
  project_id uuid not null
) on commit drop;

insert into pr7b_legacy_roots (id, project_id)
select id, project_id
  from public.orchestrator_runs
 where agent_role = 'creative_director'
   and root_execution_profile is distinct from 'creative_director';

create temporary table pr7b_legacy_family (
  id uuid primary key,
  project_id uuid not null
) on commit drop;

insert into pr7b_legacy_family (id, project_id)
with recursive family(id, project_id) as (
  select id, project_id from pr7b_legacy_roots
  union
  select child.id, child.project_id
    from public.orchestrator_runs child
    join family parent
      on child.parent_run_id = parent.id
      or child.continues_run_id = parent.id
)
select id, project_id from family;

-- Run the canonical causal cleanup for every historical root, including a
-- terminal root that may still own active descendants, jobs, claims, or budget.
do $$
declare
  v_root record;
begin
  for v_root in select id, project_id from pr7b_legacy_roots order by id
  loop
    perform public.cancel_orchestrator_run_family(v_root.project_id, v_root.id);
  end loop;
end;
$$;

-- A reached storyboard-after gate can reopen a succeeded run, and a
-- creator-direct token can wake a root. Close every unresolved gate in the
-- historical family before its identifying profile is removed.
update public.orchestrator_run_gates gate
   set status = 'rejected',
       decided_at = coalesce(gate.decided_at, now()),
       token_consumed_at = case
         when gate.approval_token_hash is not null
           then coalesce(gate.token_consumed_at, now())
         else gate.token_consumed_at
       end,
       updated_at = now()
 where gate.orchestrator_run_id in (select id from pr7b_legacy_family)
   and gate.status in ('pending', 'reached');

-- Fence callbacks and durable rerun work before retiring the family root.
update public.rerun_execution_callbacks callback
   set status = 'canceled',
       completed_at = coalesce(callback.completed_at, now())
 where callback.execution_reservation_id in (
   select execution.id
     from public.rerun_execution_reservations execution
     join pr7b_legacy_roots root on root.id = execution.root_run_id
 )
   and callback.status = 'pending';

update public.rerun_execution_work_items work
   set status = 'canceled',
       error = coalesce(
         work.error,
         jsonb_build_object(
           'schema_version', 'rerun_work_error.v1',
           'kind', 'legacy_root_retired'
         )
       ),
       updated_at = now()
 where work.execution_reservation_id in (
   select execution.id
     from public.rerun_execution_reservations execution
     join pr7b_legacy_roots root on root.id = execution.root_run_id
 )
   and work.status in ('reserved', 'running', 'blocked');

update public.rerun_execution_reservations execution
   set status = 'canceled',
       lease_token = null,
       lease_expires_at = null,
       updated_at = now()
 where execution.root_run_id in (select id from pr7b_legacy_roots)
   and execution.status in ('reserved', 'running', 'waiting');

update public.orchestrator_dispatches dispatch
   set status = 'completed',
       lease_token = null,
       lease_expires_at = null,
       pending_wake_at = null,
       updated_at = now()
 where dispatch.orchestrator_run_id in (select id from pr7b_legacy_family)
   and dispatch.status is distinct from 'completed';

-- Failed roots are retry candidates and succeeded roots can be reopened by an
-- after-storyboard gate. Supersession plus the permanent immutable guard below
-- makes both histories structurally terminal after profile metadata disappears.
update public.orchestrator_runs run
   set status = 'superseded',
       superseded_at = coalesce(run.superseded_at, now()),
       wait_reason = null,
       completed_at = coalesce(run.completed_at, now()),
       updated_at = now()
 where run.id in (select id from pr7b_legacy_roots)
   and run.status in ('succeeded', 'failed', 'canceled', 'timed_out');

-- Fail closed while root_execution_profile and its nonterminal constraint still
-- exist. Each message includes the exact rows that require operator attention.
do $$
declare
  v_ids uuid[];
begin
  select array_agg(run.id order by run.id) into v_ids
    from public.orchestrator_runs run
   where run.id in (select id from pr7b_legacy_family)
     and run.status in ('queued', 'running', 'waiting');
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B active legacy family runs remain: %', v_ids;
  end if;

  select array_agg(root.id order by root.id) into v_ids
    from public.orchestrator_runs root
   where root.id in (select id from pr7b_legacy_roots)
     and root.status is distinct from 'superseded';
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B legacy roots are not superseded: %', v_ids;
  end if;

  select array_agg(gate.id order by gate.id) into v_ids
    from public.orchestrator_run_gates gate
   where gate.orchestrator_run_id in (select id from pr7b_legacy_family)
     and gate.status in ('pending', 'reached');
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B unresolved legacy family gates remain: %', v_ids;
  end if;

  select array_agg(dispatch.id order by dispatch.id) into v_ids
    from public.orchestrator_dispatches dispatch
   where dispatch.orchestrator_run_id in (select id from pr7b_legacy_family)
     and dispatch.status is distinct from 'completed';
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B live legacy family dispatches remain: %', v_ids;
  end if;

  select array_agg(job.id order by job.id) into v_ids
    from public.jobs job
    join public.actions action on action.id = job.action_id
   where action.orchestrator_run_id in (select id from pr7b_legacy_family)
     and job.status in ('queued', 'running');
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B live legacy family jobs remain: %', v_ids;
  end if;

  select array_agg(session.id order by session.id) into v_ids
    from public.agent_sessions session
   where session.active_run_id in (select id from pr7b_legacy_family);
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B legacy family session claims remain: %', v_ids;
  end if;

  select array_agg(reservation.id order by reservation.id) into v_ids
    from public.orchestrator_budget_reservations reservation
   where (
     reservation.orchestrator_run_id in (select id from pr7b_legacy_family)
     or reservation.root_run_id in (select id from pr7b_legacy_roots)
   )
     and reservation.status = 'reserved';
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B active legacy family budget reservations remain: %', v_ids;
  end if;

  select array_agg(execution.id order by execution.id) into v_ids
    from public.rerun_execution_reservations execution
   where execution.root_run_id in (select id from pr7b_legacy_roots)
     and execution.status in ('reserved', 'running', 'waiting');
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B active legacy rerun executions remain: %', v_ids;
  end if;

  select array_agg(work.id order by work.id) into v_ids
    from public.rerun_execution_work_items work
    join public.rerun_execution_reservations execution
      on execution.id = work.execution_reservation_id
   where execution.root_run_id in (select id from pr7b_legacy_roots)
     and work.status in ('reserved', 'running', 'blocked');
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B active legacy rerun work items remain: %', v_ids;
  end if;

  select array_agg(callback.id order by callback.id) into v_ids
    from public.rerun_execution_callbacks callback
    join public.rerun_execution_reservations execution
      on execution.id = callback.execution_reservation_id
   where execution.root_run_id in (select id from pr7b_legacy_roots)
     and callback.status = 'pending';
  if coalesce(cardinality(v_ids), 0) > 0 then
    raise exception 'PR7B pending legacy rerun callbacks remain: %', v_ids;
  end if;
end;
$$;

-- Preserve every assignment-identity fence, remove only the retired profile
-- comparison, and make supersession irreversible at the database boundary.
create or replace function public.orchestrator_runs_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.project_id is distinct from old.project_id
     or new.agent_role is distinct from old.agent_role
     or new.agent_session_id is distinct from old.agent_session_id
     or new.session_sequence is distinct from old.session_sequence
     or new.task_kind is distinct from old.task_kind
     or new.task_params is distinct from old.task_params
     or new.origin_kind is distinct from old.origin_kind
     or new.parent_run_id is distinct from old.parent_run_id
     or new.root_action_id is distinct from old.root_action_id
     or new.origin_actor_id is distinct from old.origin_actor_id
     or new.origin_request is distinct from old.origin_request
     or new.continues_run_id is distinct from old.continues_run_id
     or (old.pins is not null and new.pins is distinct from old.pins)
     or (
       old.status = 'superseded'
       and new.status is distinct from 'superseded'
     )
  then
    raise exception 'orchestrator run assignment identity is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Restore the pre-profile anonymous RPC shape used by the PR 7A application.
drop function public.create_orchestrator_run_with_anonymous_quota(
  uuid, text, double precision, timestamptz, integer, text, text, text
);

create function public.create_orchestrator_run_with_anonymous_quota(
  p_project_id uuid,
  p_input_summary text,
  p_budget_usd double precision,
  p_window_start timestamptz,
  p_limit integer,
  p_deploy_id text default null,
  p_git_sha text default null
)
returns table (run_id uuid, quota_exceeded boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_run_count integer;
begin
  if p_limit < 1 then
    raise exception 'anonymous run quota limit must be positive';
  end if;

  select p.workspace_id into v_workspace_id
    from public.projects p where p.id = p_project_id;
  if v_workspace_id is null then
    raise exception 'project not found: %', p_project_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text, 0));

  select count(*)::integer into v_run_count
    from public.orchestrator_runs run
    join public.projects project on project.id = run.project_id
   where project.workspace_id = v_workspace_id
     and run.created_at >= p_window_start;
  if v_run_count >= p_limit then
    run_id := null;
    quota_exceeded := true;
    return next;
    return;
  end if;

  insert into public.orchestrator_runs (
    schema_version, project_id, status, input_summary, budget_usd, spent_usd,
    deploy_id, git_sha
  ) values (
    'orchestrator_run.v1', p_project_id, 'queued', p_input_summary,
    p_budget_usd, 0, p_deploy_id, p_git_sha
  ) returning id into run_id;
  quota_exceeded := false;
  return next;
end;
$$;

-- Preserve the service-role compatibility RPC and its ACL, but remove its only
-- profile reads/writes. Production lifecycle execution uses typed transactions.
create or replace function public.reserve_rerun_proposal_execution(
  p_project_id uuid,
  p_proposal_action_id uuid,
  p_approval_action_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_approved_max_cost_usd double precision,
  p_approval_fingerprint text
)
returns table (
  reservation_id uuid,
  budget_reservation_id uuid,
  root_run_id uuid,
  status public.rerun_execution_status,
  lease_generation integer,
  execution_result_action_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.actions%rowtype;
  v_existing public.rerun_execution_reservations%rowtype;
  v_root_id uuid;
  v_budget_id uuid;
  v_owns_materialized_root boolean := false;
begin
  if length(trim(coalesce(p_approval_fingerprint, ''))) = 0 then
    raise exception 'approval fingerprint is required' using errcode = '22023';
  end if;
  select * into v_proposal from public.actions
   where id = p_proposal_action_id and project_id = p_project_id for update;
  if not found or v_proposal.tool <> 'rerun_proposal'
     or v_proposal.proposal ->> 'schemaVersion' <> 'RerunProposal.v2'
     or v_proposal.proposal ->> 'outcome' <> 'revision' then
    raise exception 'rerun proposal not found' using errcode = 'P0002';
  end if;
  select * into v_existing from public.rerun_execution_reservations
   where project_id = p_project_id and idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_existing.proposal_action_id is distinct from p_proposal_action_id
       or v_existing.request_fingerprint is distinct from p_request_fingerprint
       or v_existing.approved_max_cost_usd is distinct from p_approved_max_cost_usd
       or v_existing.approval_action_id is distinct from p_approval_action_id
       or not exists (
         select 1 from public.actions approval
          where approval.id = v_existing.approval_action_id
            and approval.params ->> 'approvalFingerprint' = p_approval_fingerprint
            and (approval.params ->> 'approvedMaxCostUsd')::double precision
              is not distinct from p_approved_max_cost_usd
       ) then
      raise exception 'rerun_execution_replay_mismatch' using errcode = '23505';
    end if;
    return query select v_existing.id, v_existing.budget_reservation_id,
      v_existing.root_run_id, v_existing.status, v_existing.lease_generation,
      v_existing.execution_result_action_id, true;
    return;
  end if;
  select * into v_existing from public.rerun_execution_reservations
   where proposal_action_id = p_proposal_action_id for update;
  if found then
    raise exception 'rerun_execution_idempotency_conflict'
      using errcode = '23505';
  end if;
  if v_proposal.status <> 'approved' then
    raise exception 'proposal is not executable from status %', v_proposal.status
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.actions action
     where action.id = p_approval_action_id
       and action.project_id = p_project_id
       and action.tool = 'rerun_proposal_approval'
       and action.status = 'applied'
       and action.params ->> 'schemaVersion' = 'RerunProposalApproval.v1'
       and action.params ->> 'proposalActionId' = p_proposal_action_id::text
       and (action.params ->> 'approvedMaxCostUsd')::double precision
         is not distinct from p_approved_max_cost_usd
       and action.params ->> 'approvalFingerprint' = p_approval_fingerprint
       and length(trim(coalesce(action.params ->> 'actorId', ''))) > 0
  ) then
    raise exception 'proposal approval action not found' using errcode = 'P0002';
  end if;
  if p_approved_max_cost_usd is distinct from
       (v_proposal.proposal #>> '{estimate,maxCostUsd}')::double precision then
    raise exception 'execution ceiling differs from immutable proposal approval'
      using errcode = 'check_violation';
  end if;
  begin
    perform public.assert_rerun_proposal_pins_fresh(
      p_project_id, p_proposal_action_id
    );
  exception when sqlstate '55000' then
    update public.actions
       set status = 'failed',
           error = jsonb_build_object(
             'schema_version', 'action_error.v1',
             'kind', 'stale_proposal',
             'message', sqlerrm
           )
     where id = p_proposal_action_id;
    reservation_id := null;
    budget_reservation_id := null;
    root_run_id := null;
    status := 'failed';
    lease_generation := 0;
    execution_result_action_id := null;
    replayed := false;
    return next;
    return;
  end;

  if v_proposal.orchestrator_run_id is null then
    insert into public.orchestrator_runs (
      schema_version, project_id, status, input_summary, budget_usd,
      spent_usd, agent_role
    ) values (
      'orchestrator_run.v1', p_project_id, 'queued',
      'Approved selective regeneration: ' ||
        left(coalesce(v_proposal.proposal ->> 'userIntent', ''), 1000),
      p_approved_max_cost_usd, 0, 'creative_director'
    ) returning id into v_root_id;
    v_owns_materialized_root := true;
  else
    select run.id into v_root_id
      from public.orchestrator_runs run
     where run.id = v_proposal.orchestrator_run_id
       and run.project_id = p_project_id
       and run.agent_role = 'creative_director'
       and run.status in ('queued', 'running', 'waiting')
     for update;
    if not found then
      raise exception 'authorized proposal execution root not found'
        using errcode = 'P0002';
    end if;
  end if;

  insert into public.orchestrator_budget_reservations (
    project_id, orchestrator_run_id, root_run_id, action_id,
    reservation_key, reservation_scope, estimated_usd, proposal_action_id
  ) values (
    p_project_id, v_root_id, v_root_id, p_proposal_action_id,
    'rerun-proposal:' || p_proposal_action_id::text,
    'proposal_ceiling', p_approved_max_cost_usd, p_proposal_action_id
  ) returning id into v_budget_id;

  insert into public.rerun_execution_reservations (
    proposal_action_id, project_id, root_run_id, approval_action_id,
    budget_reservation_id, idempotency_key, request_fingerprint,
    approved_max_cost_usd, owns_materialized_root
  ) values (
    p_proposal_action_id, p_project_id, v_root_id, p_approval_action_id,
    v_budget_id, p_idempotency_key, p_request_fingerprint,
    p_approved_max_cost_usd, v_owns_materialized_root
  ) returning id into reservation_id;
  if v_owns_materialized_root then
    update public.orchestrator_runs
       set status = 'running', started_at = coalesce(started_at, now())
     where id = v_root_id;
  end if;
  update public.actions set status = 'running' where id = p_proposal_action_id;
  budget_reservation_id := v_budget_id;
  status := 'reserved';
  root_run_id := v_root_id;
  lease_generation := 0;
  execution_result_action_id := null;
  replayed := false;
  return next;
end;
$$;

-- Remove profile-bearing RLS and exact column grants before the column drop.
drop policy if exists actions_popcorn_api_rerun_select on public.actions;
create policy actions_popcorn_api_rerun_select
  on public.actions for select to popcorn_api
  using (
    tool in (
      'rerun_proposal', 'rerun_proposal_approval', 'rerun_work_item_dispatch',
      'rerun_reconciliation', 'rerun_execution', 'domain_report'
    )
    or (
      tool <> 'domain_report'
      and status in ('running', 'applied')
      and exists (
        select 1
          from public.orchestrator_runs child
          join public.rerun_execution_reservations execution
            on execution.project_id = child.project_id
           and execution.root_run_id = child.parent_run_id
          join public.rerun_execution_work_items work
            on work.execution_reservation_id = execution.id
           and work.project_id = execution.project_id
           and work.dispatch_action_id = child.root_action_id
         where child.id = actions.orchestrator_run_id
           and child.project_id = actions.project_id
           and child.agent_role in ('visuals', 'audio')
           and execution.id::text =
             child.task_params #>>
               '{approvalContext,executionReservationId}'
           and execution.proposal_action_id::text =
             child.task_params #>>
               '{approvalContext,proposalActionId}'
      )
    )
  );

drop policy if exists orchestrator_runs_popcorn_api_rerun_select
  on public.orchestrator_runs;
drop policy if exists orchestrator_runs_popcorn_api_rerun_insert
  on public.orchestrator_runs;
drop policy if exists orchestrator_runs_popcorn_api_rerun_update
  on public.orchestrator_runs;

create policy orchestrator_runs_popcorn_api_rerun_select
  on public.orchestrator_runs for select to popcorn_api
  using (agent_role = 'creative_director');
create policy orchestrator_runs_popcorn_api_rerun_insert
  on public.orchestrator_runs for insert to popcorn_api
  with check (agent_role = 'creative_director');
create policy orchestrator_runs_popcorn_api_rerun_update
  on public.orchestrator_runs for update to popcorn_api
  using (agent_role = 'creative_director')
  with check (agent_role = 'creative_director');

revoke all on table public.orchestrator_runs from popcorn_api;
grant select (
  id, project_id, parent_run_id, root_action_id, task_params, status,
  agent_role, budget_usd, spent_usd, origin_kind
) on table public.orchestrator_runs to popcorn_api;
grant insert (
  schema_version, project_id, status, input_summary, budget_usd, spent_usd,
  agent_role
) on table public.orchestrator_runs to popcorn_api;
grant update (
  status, started_at, completed_at, error, updated_at
) on table public.orchestrator_runs to popcorn_api;

drop trigger if exists orchestrator_runs_fill_root_profile
  on public.orchestrator_runs;
drop function if exists public.fill_creative_director_root_profile();

alter table public.orchestrator_runs
  drop constraint if exists orchestrator_runs_nonterminal_root_profile_check,
  drop constraint if exists orchestrator_runs_domain_root_execution_profile_check,
  drop constraint if exists orchestrator_runs_root_execution_profile_check;

alter table public.orchestrator_runs
  drop column root_execution_profile;

-- The migration intentionally avoids CASCADE. These checks make accidental
-- compatibility leftovers visible before PostgREST refreshes its schema cache.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orchestrator_runs'
       and column_name = 'root_execution_profile'
  ) then
    raise exception 'PR7B root_execution_profile column still exists';
  end if;
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.orchestrator_runs'::regclass
       and conname in (
         'orchestrator_runs_nonterminal_root_profile_check',
         'orchestrator_runs_domain_root_execution_profile_check',
         'orchestrator_runs_root_execution_profile_check'
       )
  ) then
    raise exception 'PR7B profile constraint still exists';
  end if;
  if to_regprocedure(
    'public.fill_creative_director_root_profile()'
  ) is not null then
    raise exception 'PR7B profile fill function still exists';
  end if;
  if to_regprocedure(
    'public.create_orchestrator_run_with_anonymous_quota(uuid,text,double precision,timestamp with time zone,integer,text,text,text)'
  ) is not null then
    raise exception 'PR7B eight-argument anonymous quota RPC still exists';
  end if;
  if to_regprocedure(
    'public.create_orchestrator_run_with_anonymous_quota(uuid,text,double precision,timestamp with time zone,integer,text,text)'
  ) is null then
    raise exception 'PR7B seven-argument anonymous quota RPC is missing';
  end if;
  if position(
    'root_execution_profile' in pg_get_functiondef(
      'public.reserve_rerun_proposal_execution(uuid,uuid,uuid,text,text,double precision,text)'::regprocedure
    )
  ) > 0 then
    raise exception 'PR7B rerun reservation RPC still references the profile';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and (
         coalesce(qual, '') like '%root_execution_profile%'
         or coalesce(with_check, '') like '%root_execution_profile%'
       )
  ) then
    raise exception 'PR7B public policy still references the profile';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
