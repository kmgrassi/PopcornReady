-- Selective regeneration PR 2: durable proposal lifecycle, admission, and
-- token-fenced execution. Provider adapters remain unregistered until PR 5.

create type public.rerun_execution_status as enum (
  'reserved', 'running', 'waiting', 'completed', 'failed', 'canceled'
);

create type public.rerun_work_item_status as enum (
  'reserved', 'running', 'blocked', 'completed', 'failed', 'canceled'
);

-- Extend the one canonical admission ledger with proposal-scoped parent
-- ceilings. Child operation reservations added by later adapter PRs name this
-- parent instead of introducing a second cost authority.
alter table public.orchestrator_budget_reservations
  drop constraint if exists orchestrator_budget_reservations_reservation_scope_check;
alter table public.orchestrator_budget_reservations
  add constraint orchestrator_budget_reservations_reservation_scope_check
  check (reservation_scope in ('operation', 'run_ceiling', 'proposal_ceiling'));
alter table public.orchestrator_budget_reservations
  add column proposal_action_id uuid references public.actions(id) on delete set null,
  add column parent_reservation_id uuid
    references public.orchestrator_budget_reservations(id) on delete restrict;
create unique index orchestrator_budget_reservations_active_proposal_uidx
  on public.orchestrator_budget_reservations(proposal_action_id)
  where reservation_scope = 'proposal_ceiling' and status = 'reserved';

create or replace function public.guard_orchestrator_budget_admission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_root public.orchestrator_runs%rowtype;
  v_spent double precision;
  v_unparented_operations double precision;
  v_run_ceiling double precision;
  v_proposal_ceilings double precision;
  v_parent public.orchestrator_budget_reservations%rowtype;
  v_parent_operations double precision;
begin
  select * into v_root from public.orchestrator_runs
   where id = new.root_run_id and project_id = new.project_id for update;
  if not found then raise exception 'budget root not found' using errcode = 'P0002'; end if;

  if new.reservation_scope = 'proposal_ceiling' then
    if new.proposal_action_id is null or new.parent_reservation_id is not null then
      raise exception 'proposal ceiling requires proposal action and no parent'
        using errcode = '22023';
    end if;
  elsif new.parent_reservation_id is not null then
    if new.reservation_scope <> 'operation' then
      raise exception 'only operations may consume a proposal ceiling'
        using errcode = '22023';
    end if;
    select * into v_parent from public.orchestrator_budget_reservations
     where id = new.parent_reservation_id and project_id = new.project_id
       and reservation_scope = 'proposal_ceiling' and status = 'reserved'
     for update;
    if not found then raise exception 'active proposal ceiling not found' using errcode = 'P0002'; end if;
    select coalesce(sum(case
      when status = 'settled' then actual_usd
      when status = 'reserved' then estimated_usd
      else 0
    end), 0) into v_parent_operations
      from public.orchestrator_budget_reservations
     where parent_reservation_id = v_parent.id
       and status in ('reserved', 'settled');
    if v_parent_operations + new.estimated_usd > v_parent.estimated_usd then
      raise exception 'proposal_ceiling_exhausted' using errcode = 'check_violation';
    end if;
  end if;

  with recursive family(id) as (
    select v_root.id
    union
    select r.id from public.orchestrator_runs r join family f
      on r.parent_run_id = f.id or r.continues_run_id = f.id
     where r.project_id = new.project_id
  )
  select coalesce(sum(r.spent_usd), 0) into v_spent
    from public.orchestrator_runs r where r.id in (select id from family);
  select coalesce(sum(estimated_usd), 0) into v_unparented_operations
    from public.orchestrator_budget_reservations
   where root_run_id = v_root.id and status = 'reserved'
     and reservation_scope = 'operation' and parent_reservation_id is null;
  select coalesce(max(estimated_usd), 0) into v_run_ceiling
    from public.orchestrator_budget_reservations
   where root_run_id = v_root.id and status = 'reserved'
     and reservation_scope = 'run_ceiling';
  -- Child settlement already contributes to orchestrator_runs.spent_usd.
  -- Count only each active proposal's remaining commitment so settled actuals
  -- are not charged a second time while sibling work is still pending.
  select coalesce(sum(greatest(parent.estimated_usd - coalesce(children.actual_usd, 0), 0)), 0)
    into v_proposal_ceilings
    from public.orchestrator_budget_reservations parent
    left join lateral (
      select sum(child.actual_usd) as actual_usd
        from public.orchestrator_budget_reservations child
       where child.parent_reservation_id = parent.id
         and child.status = 'settled'
    ) children on true
   where parent.root_run_id = v_root.id and parent.status = 'reserved'
     and parent.reservation_scope = 'proposal_ceiling';

  if new.reservation_scope = 'proposal_ceiling' then
    v_proposal_ceilings := v_proposal_ceilings + new.estimated_usd;
  elsif new.reservation_scope = 'operation' and new.parent_reservation_id is null then
    v_unparented_operations := v_unparented_operations + new.estimated_usd;
  elsif new.reservation_scope = 'run_ceiling' then
    v_run_ceiling := greatest(v_run_ceiling, new.estimated_usd);
  end if;
  if v_root.budget_usd is not null
     and greatest(v_spent + v_unparented_operations, v_run_ceiling)
       + v_proposal_ceilings > v_root.budget_usd then
    raise exception 'root_family_budget_exhausted_with_proposals'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger orchestrator_budget_reservations_guard_proposals
  before insert on public.orchestrator_budget_reservations
  for each row execute function public.guard_orchestrator_budget_admission();

create table public.rerun_execution_reservations (
  id uuid primary key default gen_random_uuid(),
  proposal_action_id uuid not null unique
    references public.actions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  root_run_id uuid not null references public.orchestrator_runs(id) on delete restrict,
  approval_action_id uuid not null references public.actions(id) on delete restrict,
  budget_reservation_id uuid not null unique
    references public.orchestrator_budget_reservations(id) on delete restrict,
  owns_materialized_root boolean not null default false,
  idempotency_key text not null,
  request_fingerprint text not null,
  approved_max_cost_usd double precision not null
    check (approved_max_cost_usd >= 0),
  status public.rerun_execution_status not null default 'reserved',
  lease_token uuid,
  lease_generation integer not null default 0 check (lease_generation >= 0),
  lease_expires_at timestamptz,
  execution_result_action_id uuid unique
    references public.actions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key)
);

create table public.rerun_execution_work_items (
  id uuid primary key default gen_random_uuid(),
  execution_reservation_id uuid not null
    references public.rerun_execution_reservations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_item_id text not null,
  request_fingerprint text not null,
  dispatch_action_id uuid not null unique
    references public.actions(id) on delete restrict,
  child_run_id uuid references public.orchestrator_runs(id) on delete set null,
  report_action_id uuid unique references public.actions(id) on delete set null,
  reconciliation_action_id uuid references public.actions(id) on delete set null,
  status public.rerun_work_item_status not null default 'reserved',
  lease_generation integer not null check (lease_generation >= 1),
  output_asset_ids uuid[] not null default '{}',
  binding_results jsonb,
  accepted_callbacks jsonb,
  blocked_precondition jsonb,
  primitive_action_ids uuid[] not null default '{}',
  budget_reservation_keys text[] not null default '{}',
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (execution_reservation_id, work_item_id)
);

create table public.rerun_execution_callbacks (
  id uuid primary key default gen_random_uuid(),
  execution_reservation_id uuid not null
    references public.rerun_execution_reservations(id) on delete cascade,
  work_reservation_id uuid not null
    references public.rerun_execution_work_items(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  executor_id text not null,
  binding_subset jsonb not null default '[]'::jsonb,
  callback_token_hash text not null,
  callback_generation integer not null check (callback_generation >= 1),
  job_ids uuid[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'canceled')),
  callback_result jsonb,
  child_run_id uuid references public.orchestrator_runs(id) on delete set null,
  report_action_id uuid references public.actions(id) on delete set null,
  reconciliation_action_id uuid references public.actions(id) on delete set null,
  primitive_action_ids uuid[] not null default '{}',
  budget_reservation_keys text[] not null default '{}',
  binding_results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  completed_at timestamptz,
  unique (work_reservation_id, executor_id)
);

create table public.rerun_proposal_successors (
  prior_proposal_action_id uuid primary key
    references public.actions(id) on delete cascade,
  successor_proposal_action_id uuid not null unique
    references public.actions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  request_fingerprint text not null,
  cause text not null check (cause in ('refresh', 'clarification_answer')),
  created_at timestamptz not null default now()
);

create index rerun_execution_reservations_project_status_idx
  on public.rerun_execution_reservations(project_id, status);
create index rerun_execution_work_items_execution_status_idx
  on public.rerun_execution_work_items(execution_reservation_id, status);

alter table public.rerun_execution_reservations enable row level security;
alter table public.rerun_execution_work_items enable row level security;
alter table public.rerun_execution_callbacks enable row level security;
alter table public.rerun_proposal_successors enable row level security;
revoke all on public.rerun_execution_reservations from public, anon, authenticated;
revoke all on public.rerun_execution_work_items from public, anon, authenticated;
revoke all on public.rerun_execution_callbacks from public, anon, authenticated;
revoke all on public.rerun_proposal_successors from public, anon, authenticated;

create trigger rerun_execution_reservations_set_updated_at
  before update on public.rerun_execution_reservations
  for each row execute function public.set_updated_at();
create trigger rerun_execution_work_items_set_updated_at
  before update on public.rerun_execution_work_items
  for each row execute function public.set_updated_at();

create or replace function public.reserve_rerun_child_budget(
  p_project_id uuid,
  p_execution_reservation_id uuid,
  p_work_item_id text,
  p_child_run_id uuid,
  p_action_id uuid,
  p_job_id uuid,
  p_reservation_key text,
  p_estimated_usd double precision
)
returns table (reservation_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execution public.rerun_execution_reservations%rowtype;
  v_work public.rerun_execution_work_items%rowtype;
  v_existing public.orchestrator_budget_reservations%rowtype;
begin
  if p_estimated_usd is null or p_estimated_usd < 0 then
    raise exception 'invalid child budget estimate' using errcode = '22023';
  end if;
  select * into v_execution from public.rerun_execution_reservations
   where id = p_execution_reservation_id and project_id = p_project_id
   for update;
  if not found or v_execution.status not in ('running', 'waiting') then
    raise exception 'active rerun execution not found' using errcode = 'P0002';
  end if;
  select * into v_work from public.rerun_execution_work_items
   where execution_reservation_id = v_execution.id
     and work_item_id = p_work_item_id for update;
  if not found then raise exception 'rerun work item not found' using errcode = 'P0002'; end if;
  if v_work.status not in ('reserved', 'running') then
    raise exception 'rerun work item is not accepting budget reservations'
      using errcode = '55000';
  end if;
  if p_action_id = v_work.dispatch_action_id then
    if p_child_run_id is not null then
      raise exception 'dispatch budget cannot claim a child run'
        using errcode = 'check_violation';
    end if;
  elsif p_child_run_id is null or not exists (
    select 1
      from public.orchestrator_runs child
      join public.actions primitive on primitive.id = p_action_id
     where child.id = p_child_run_id
       and child.project_id = p_project_id
       and child.parent_run_id = v_execution.root_run_id
       and child.root_action_id = v_work.dispatch_action_id
       and child.task_params #>> '{approvalContext,proposalActionId}'
         = v_execution.proposal_action_id::text
       and child.task_params #>> '{approvalContext,executionReservationId}'
         = v_execution.id::text
       and primitive.project_id = p_project_id
       and primitive.orchestrator_run_id = child.id
       and primitive.status in ('running', 'applied')
  ) then
    raise exception 'child budget action is outside proposal causation'
      using errcode = 'check_violation';
  end if;
  select * into v_existing from public.orchestrator_budget_reservations
   where project_id = p_project_id and reservation_key = p_reservation_key
   for update;
  if found then
    if v_existing.parent_reservation_id is distinct from v_execution.budget_reservation_id
       or v_existing.action_id is distinct from p_action_id
       or v_existing.orchestrator_run_id is distinct from
         coalesce(p_child_run_id, v_execution.root_run_id)
       or v_existing.job_id is distinct from p_job_id
       or v_existing.estimated_usd is distinct from p_estimated_usd then
      raise exception 'rerun_child_budget_replay_mismatch' using errcode = '23505';
    end if;
    return query select v_existing.id, true;
    return;
  end if;
  insert into public.orchestrator_budget_reservations (
    project_id, orchestrator_run_id, root_run_id, action_id, job_id,
    reservation_key, reservation_scope, estimated_usd, parent_reservation_id
  ) values (
    p_project_id, coalesce(p_child_run_id, v_execution.root_run_id),
    v_execution.root_run_id,
    p_action_id, p_job_id, p_reservation_key, 'operation', p_estimated_usd,
    v_execution.budget_reservation_id
  ) returning id into reservation_id;
  update public.rerun_execution_work_items
     set budget_reservation_keys = array_append(
       budget_reservation_keys, p_reservation_key
     )
   where id = v_work.id
     and not p_reservation_key = any(budget_reservation_keys);
  replayed := false;
  return next;
end;
$$;

create or replace function public.guard_rerun_proposal_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tool <> 'rerun_proposal' or new.status is not distinct from old.status then
    return new;
  end if;
  if not (
    old.status = 'proposed' and new.status in ('approved', 'rejected', 'failed')
    or old.status = 'approved' and new.status in ('running', 'failed')
    or old.status = 'running' and new.status in ('applied', 'failed')
  ) then
    raise exception 'invalid_rerun_proposal_transition:%->%', old.status, new.status
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger actions_guard_rerun_proposal_lifecycle
  before update of status on public.actions
  for each row execute function public.guard_rerun_proposal_lifecycle();

create or replace function public.assert_rerun_proposal_pins_fresh(
  p_project_id uuid,
  p_proposal_action_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal jsonb;
  v_pin jsonb;
  v_asset public.assets%rowtype;
  v_selection public.selections%rowtype;
  v_snapshot uuid;
begin
  select proposal into v_proposal from public.actions
   where id = p_proposal_action_id and project_id = p_project_id
     and tool = 'rerun_proposal' for update;
  if not found then raise exception 'rerun proposal not found' using errcode = 'P0002'; end if;
  -- Selection heads are append-only; briefly block inserts so absence and the
  -- observed latest seq are stable through admission.
  lock table public.selections in share row exclusive mode;
  for v_pin in select value from jsonb_array_elements(v_proposal #> '{pins,assets}')
  loop
    select * into v_asset from public.assets
     where id = (v_pin ->> 'assetId')::uuid and project_id = p_project_id
     for update;
    if not found
       or v_asset.content_hash is distinct from v_pin ->> 'contentHash'
       or v_asset.inputs_fingerprint is distinct from v_pin ->> 'inputsFingerprint' then
      raise exception 'stale_proposal_asset_pin' using errcode = '55000';
    end if;
  end loop;
  for v_pin in select value from jsonb_array_elements(v_proposal #> '{pins,selections}')
  loop
    select * into v_selection from public.selections
     where project_id = p_project_id
       and slot_owner_lineage_id is not distinct from
         nullif(v_pin ->> 'slotOwnerLineageId', '')::uuid
       and slot_role = v_pin ->> 'slotRole'
     order by seq desc limit 1;
    if coalesce(v_selection.seq, 0) is distinct from (v_pin ->> 'expectedSeq')::integer
       or v_selection.active_asset_id is distinct from
         nullif(v_pin ->> 'expectedActiveAssetId', '')::uuid then
      raise exception 'stale_proposal_selection_pin' using errcode = '55000';
    end if;
  end loop;
  for v_pin in select value from jsonb_array_elements(v_proposal #> '{pins,storySnapshots}')
  loop
    if v_pin ->> 'rowKind' = 'storyboard' then
      -- `storyboard` is the historical target discriminator. The retired
      -- storyboards.plan_asset_id head is projected through the canonical
      -- story_blueprints provenance rather than conflated with asset_id.
      select nullif(provenance ->> 'planAssetId', '')::uuid
        into v_snapshot from public.story_blueprints
       where id = (v_pin ->> 'rowId')::uuid and project_id = p_project_id for update;
    elsif v_pin ->> 'rowKind' = 'story_blueprint' then
      select asset_id into v_snapshot from public.story_blueprints
       where id = (v_pin ->> 'rowId')::uuid and project_id = p_project_id for update;
    elsif v_pin ->> 'rowKind' = 'story_scene' then
      select scene_asset_id into v_snapshot from public.story_blueprint_scenes
       where id = (v_pin ->> 'rowId')::uuid and project_id = p_project_id for update;
    elsif v_pin ->> 'rowKind' = 'story_beat' then
      select beat_asset_id into v_snapshot from public.story_beats
       where id = (v_pin ->> 'rowId')::uuid and project_id = p_project_id for update;
    else
      raise exception 'unsupported story snapshot pin' using errcode = '22023';
    end if;
    if not found or v_snapshot is distinct from
      nullif(v_pin ->> 'expectedSnapshotAssetId', '')::uuid then
      raise exception 'stale_proposal_story_pin' using errcode = '55000';
    end if;
  end loop;
end;
$$;

create or replace function public.approve_rerun_proposal(
  p_project_id uuid,
  p_proposal_action_id uuid,
  p_approval_action_id uuid,
  p_actor_id text,
  p_approved_max_cost_usd double precision,
  p_approval_fingerprint text,
  p_autonomous boolean default false
)
returns table (
  proposal_status public.action_status,
  approval_action_id uuid,
  replayed boolean,
  stale boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.actions%rowtype;
  v_existing public.actions%rowtype;
begin
  if p_approved_max_cost_usd is null or p_approved_max_cost_usd < 0
     or p_approval_fingerprint is null or length(trim(p_approval_fingerprint)) = 0
     or p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'invalid rerun approval input' using errcode = '22023';
  end if;
  select * into v_proposal from public.actions
   where id = p_proposal_action_id and project_id = p_project_id
   for update;
  if not found or v_proposal.tool <> 'rerun_proposal'
     or v_proposal.proposal ->> 'schemaVersion' <> 'RerunProposal.v2'
     or v_proposal.proposal ->> 'outcome' <> 'revision' then
    raise exception 'rerun proposal not found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.actions where id = p_approval_action_id;
  if found then
    if v_existing.project_id is distinct from p_project_id
       or v_existing.tool is distinct from 'rerun_proposal_approval'
       or v_existing.params ->> 'proposalActionId' is distinct from p_proposal_action_id::text
       or v_existing.params ->> 'approvalFingerprint' is distinct from p_approval_fingerprint
       or (v_existing.params ->> 'approvedMaxCostUsd')::double precision
         is distinct from p_approved_max_cost_usd
       or v_existing.params ->> 'actorId' is distinct from p_actor_id
       or (v_existing.params ->> 'autonomous')::boolean is distinct from p_autonomous then
      raise exception 'rerun_approval_replay_mismatch' using errcode = '23505';
    end if;
    return query select v_proposal.status, v_existing.id, true, false;
    return;
  end if;
  if v_proposal.status <> 'proposed' then
    raise exception 'proposal is not approvable from status %', v_proposal.status
      using errcode = '55000';
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
    return query select 'failed'::public.action_status, null::uuid, false, true;
    return;
  end;
  if (v_proposal.proposal ->> 'requiresApproval')::boolean is true and p_autonomous then
    raise exception 'creator approval is required' using errcode = 'check_violation';
  end if;
  if p_approved_max_cost_usd is distinct from
       (v_proposal.proposal #>> '{estimate,maxCostUsd}')::double precision then
    raise exception 'approved maximum must equal proposal ceiling'
      using errcode = 'check_violation';
  end if;

  insert into public.actions (
    id, schema_version, project_id, orchestrator_run_id, tool, status, params,
    input_asset_ids, rationale, proposal, job_ids, output_asset_ids
  ) values (
    p_approval_action_id, 'action.v1', p_project_id,
    v_proposal.orchestrator_run_id, 'rerun_proposal_approval', 'applied',
    jsonb_build_object(
      'schema_version', 'action_params.v1',
      'schemaVersion', 'RerunProposalApproval.v1',
      'proposalActionId', p_proposal_action_id,
      'actorId', p_actor_id,
      'approvedMaxCostUsd', p_approved_max_cost_usd,
      'approvalFingerprint', p_approval_fingerprint,
      'autonomous', p_autonomous
    ),
    '{}', 'Creator approved the immutable selective-regeneration proposal.',
    null, '{}', '{}'
  );
  update public.actions set status = 'approved' where id = p_proposal_action_id;
  return query select 'approved'::public.action_status, p_approval_action_id, false, false;
end;
$$;

create or replace function public.reject_rerun_proposal(
  p_project_id uuid,
  p_proposal_action_id uuid
)
returns public.action_status
language plpgsql
security definer
set search_path = public
as $$
declare v_action public.actions%rowtype;
begin
  select * into v_action from public.actions
   where id = p_proposal_action_id and project_id = p_project_id for update;
  if not found or v_action.tool <> 'rerun_proposal' then
    raise exception 'rerun proposal not found' using errcode = 'P0002';
  end if;
  if v_action.status = 'rejected' then return v_action.status; end if;
  if v_action.status <> 'proposed' then
    raise exception 'proposal is not rejectable from status %', v_action.status
      using errcode = '55000';
  end if;
  update public.actions set status = 'rejected' where id = p_proposal_action_id;
  return 'rejected'::public.action_status;
end;
$$;

create or replace function public.create_rerun_proposal_successor(
  p_project_id uuid,
  p_prior_action_id uuid,
  p_successor_action_id uuid,
  p_request_fingerprint text,
  p_cause text,
  p_orchestrator_run_id uuid,
  p_params jsonb,
  p_proposal jsonb,
  p_input_asset_ids uuid[],
  p_rationale text,
  p_successor_status public.action_status
)
returns table (successor_action_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior public.actions%rowtype;
  v_link public.rerun_proposal_successors%rowtype;
begin
  if p_cause not in ('refresh', 'clarification_answer')
     or p_successor_status not in ('proposed', 'applied') then
    raise exception 'invalid rerun successor input' using errcode = '22023';
  end if;
  select * into v_prior from public.actions
   where id = p_prior_action_id and project_id = p_project_id for update;
  if not found or v_prior.tool <> 'rerun_proposal' then
    raise exception 'prior rerun proposal not found' using errcode = 'P0002';
  end if;
  select * into v_link from public.rerun_proposal_successors
   where prior_proposal_action_id = p_prior_action_id;
  if found then
    if v_link.request_fingerprint is distinct from p_request_fingerprint
       or v_link.cause is distinct from p_cause then
      raise exception 'rerun_successor_replay_mismatch' using errcode = '23505';
    end if;
    return query select v_link.successor_proposal_action_id, true;
    return;
  end if;
  if v_prior.status <> 'proposed' then
    raise exception 'proposal is not refreshable from status %', v_prior.status
      using errcode = '55000';
  end if;
  insert into public.actions (
    id, schema_version, project_id, orchestrator_run_id, tool, status, params,
    input_asset_ids, rationale, proposal, job_ids, output_asset_ids
  ) values (
    p_successor_action_id, 'action.v1', p_project_id, p_orchestrator_run_id,
    'rerun_proposal', p_successor_status,
    jsonb_build_object('schema_version', 'action_params.v1') || p_params,
    coalesce(p_input_asset_ids, '{}'), p_rationale,
    jsonb_build_object('schema_version', 'action_proposal.v1') || p_proposal,
    '{}', '{}'
  );
  insert into public.rerun_proposal_successors (
    prior_proposal_action_id, successor_proposal_action_id, project_id,
    request_fingerprint, cause
  ) values (
    p_prior_action_id, p_successor_action_id, p_project_id,
    p_request_fingerprint, p_cause
  );
  update public.actions
     set status = 'failed',
         error = jsonb_build_object(
           'schema_version', 'action_error.v1',
           'kind', 'proposal_superseded',
           'successorActionId', p_successor_action_id,
           'cause', p_cause
         )
   where id = p_prior_action_id;
  return query select p_successor_action_id, false;
end;
$$;

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
      v_existing.root_run_id,
      v_existing.status, v_existing.lease_generation,
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
    select 1 from public.actions a
     where a.id = p_approval_action_id and a.project_id = p_project_id
       and a.tool = 'rerun_proposal_approval'
       and a.status = 'applied'
       and a.params ->> 'schemaVersion' = 'RerunProposalApproval.v1'
       and a.params ->> 'proposalActionId' = p_proposal_action_id::text
       and (a.params ->> 'approvedMaxCostUsd')::double precision
         is not distinct from p_approved_max_cost_usd
       and a.params ->> 'approvalFingerprint' = p_approval_fingerprint
       and length(trim(coalesce(a.params ->> 'actorId', ''))) > 0
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

  -- A project-scoped preview stays unbound and inert. The first approved
  -- execution transaction materializes exactly one Creative Director root;
  -- the proposal action and immutable proposal JSON remain unchanged.
  if v_proposal.orchestrator_run_id is null then
    insert into public.orchestrator_runs (
      schema_version, project_id, status, input_summary, budget_usd,
      spent_usd, agent_role, root_execution_profile
    ) values (
      'orchestrator_run.v1', p_project_id, 'queued',
      'Approved selective regeneration: ' ||
        left(coalesce(v_proposal.proposal ->> 'userIntent', ''), 1000),
      p_approved_max_cost_usd, 0, 'creative_director', 'creative_director'
    ) returning id into v_root_id;
    v_owns_materialized_root := true;
  else
    select r.id into v_root_id
      from public.orchestrator_runs r
     where r.id = v_proposal.orchestrator_run_id
       and r.project_id = p_project_id
       and r.agent_role = 'creative_director'
       and r.root_execution_profile = 'creative_director'
       and r.status in ('queued', 'running', 'waiting')
     for update;
    if not found then
      raise exception 'authorized proposal execution root not found'
        using errcode = 'P0002';
    end if;
  end if;

  -- The proposal ceiling is a parent reservation in the canonical budget
  -- ledger. Serialize through the family root; the admission trigger includes
  -- all concurrent proposal ceilings before allowing this insert.
  insert into public.orchestrator_budget_reservations (
    project_id, orchestrator_run_id, root_run_id, action_id,
    reservation_key, reservation_scope, estimated_usd, proposal_action_id
  ) values (
    p_project_id, v_root_id, v_root_id, p_proposal_action_id,
    'rerun-proposal:' || p_proposal_action_id::text,
    'proposal_ceiling', p_approved_max_cost_usd, p_proposal_action_id
  ) returning id into v_budget_id;

  insert into public.rerun_execution_reservations (
    proposal_action_id, project_id, root_run_id, approval_action_id, budget_reservation_id,
    idempotency_key, request_fingerprint, approved_max_cost_usd,
    owns_materialized_root
  ) values (
    p_proposal_action_id, p_project_id, v_root_id, p_approval_action_id, v_budget_id,
    p_idempotency_key, p_request_fingerprint, p_approved_max_cost_usd,
    v_owns_materialized_root
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

create or replace function public.claim_rerun_execution_lease(
  p_project_id uuid,
  p_reservation_id uuid,
  p_lease_seconds integer default 60
)
returns table (
  reservation_id uuid,
  budget_reservation_id uuid,
  lease_token uuid,
  lease_generation integer,
  lease_expires_at timestamptz,
  parked boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.rerun_execution_reservations%rowtype;
begin
  if p_lease_seconds < 5 or p_lease_seconds > 900 then
    raise exception 'invalid lease duration' using errcode = '22023';
  end if;
  select * into v_row from public.rerun_execution_reservations
   where id = p_reservation_id and project_id = p_project_id for update;
  if not found then raise exception 'execution reservation not found' using errcode = 'P0002'; end if;
  if v_row.status = 'running'
     and v_row.lease_expires_at is not null
     and v_row.lease_expires_at <= now()
     and exists (
       select 1 from public.rerun_execution_callbacks callback
        where callback.execution_reservation_id = v_row.id
          and callback.status = 'pending'
          and cardinality(callback.job_ids) > 0
          and callback.expires_at > now()
     ) then
    update public.rerun_execution_reservations
       set status = 'waiting', lease_token = null, lease_expires_at = null
     where id = v_row.id;
    reservation_id := v_row.id;
    budget_reservation_id := v_row.budget_reservation_id;
    lease_token := null;
    lease_generation := v_row.lease_generation;
    lease_expires_at := null;
    parked := true;
    return next;
    return;
  end if;
  if v_row.status = 'waiting' and (
    exists (
      select 1 from public.rerun_execution_callbacks callback
       where callback.execution_reservation_id = v_row.id
         and callback.status = 'pending'
         and cardinality(callback.job_ids) > 0
    )
    or exists (
      select 1 from public.rerun_execution_work_items work
       where work.execution_reservation_id = v_row.id
         and work.status = 'blocked'
    )
  ) then
    raise exception 'rerun_execution_lease_unavailable' using errcode = '55000';
  end if;
  if v_row.status not in ('reserved', 'running', 'waiting')
     or (v_row.lease_expires_at is not null and v_row.lease_expires_at > now()) then
    raise exception 'rerun_execution_lease_unavailable' using errcode = '55000';
  end if;
  update public.rerun_execution_reservations
     set status = 'running', lease_token = gen_random_uuid(),
         lease_generation = v_row.lease_generation + 1,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where id = p_reservation_id
   returning id, rerun_execution_reservations.budget_reservation_id,
     rerun_execution_reservations.lease_token,
     rerun_execution_reservations.lease_generation,
     rerun_execution_reservations.lease_expires_at,
     false
   into reservation_id, budget_reservation_id, lease_token,
     lease_generation, lease_expires_at, parked;
  return next;
end;
$$;

create or replace function public.renew_rerun_execution_lease(
  p_project_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid,
  p_lease_generation integer,
  p_lease_seconds integer default 60
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_expires_at timestamptz;
begin
  if p_lease_seconds < 5 or p_lease_seconds > 900 then
    raise exception 'invalid lease duration' using errcode = '22023';
  end if;
  update public.rerun_execution_reservations
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where id = p_reservation_id and project_id = p_project_id
     and status = 'running'
     and lease_token is not distinct from p_lease_token
     and lease_generation is not distinct from p_lease_generation
     and lease_expires_at > now()
   returning lease_expires_at into v_expires_at;
  if not found then
    raise exception 'stale_rerun_execution_lease' using errcode = '55000';
  end if;
  return v_expires_at;
end;
$$;

create or replace function public.reserve_rerun_work_item(
  p_project_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid,
  p_lease_generation integer,
  p_work_item_id text,
  p_request_fingerprint text,
  p_dispatch_action_id uuid,
  p_dispatch_params jsonb,
  p_callback_fences jsonb
)
returns table (
  work_reservation_id uuid,
  work_status public.rerun_work_item_status,
  child_run_id uuid,
  report_action_id uuid,
  reconciliation_action_id uuid,
  binding_results jsonb,
  primitive_action_ids uuid[],
  budget_reservation_keys text[],
  callback_results jsonb,
  replayed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execution public.rerun_execution_reservations%rowtype;
  v_existing public.rerun_execution_work_items%rowtype;
  v_proposal public.actions%rowtype;
  v_callback jsonb;
begin
  select * into v_execution from public.rerun_execution_reservations
   where id = p_reservation_id and project_id = p_project_id for update;
  if not found or v_execution.status <> 'running'
     or v_execution.lease_token is distinct from p_lease_token
     or v_execution.lease_generation is distinct from p_lease_generation
     or v_execution.lease_expires_at <= now() then
    raise exception 'stale_rerun_execution_lease' using errcode = '55000';
  end if;
  select * into v_existing from public.rerun_execution_work_items
   where execution_reservation_id = p_reservation_id
     and work_item_id = p_work_item_id for update;
  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint
       or v_existing.dispatch_action_id is distinct from p_dispatch_action_id then
      raise exception 'rerun_work_item_replay_mismatch' using errcode = '23505';
    end if;
    return query select v_existing.id, v_existing.status,
      v_existing.child_run_id, v_existing.report_action_id,
      v_existing.reconciliation_action_id, v_existing.binding_results,
      v_existing.primitive_action_ids, v_existing.budget_reservation_keys,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'executorId', callback.executor_id,
        'status', callback.status,
        'jobIds', to_jsonb(callback.job_ids),
        'result', case when callback.status = 'completed' then
          jsonb_build_object(
            'bindingSubset', callback.binding_subset,
            'childRunId', callback.child_run_id,
            'reportActionId', callback.report_action_id,
            'reconciliationActionId', callback.reconciliation_action_id,
            'primitiveActionIds', to_jsonb(callback.primitive_action_ids),
            'budgetReservationKeys', to_jsonb(callback.budget_reservation_keys),
            'outputs', callback.binding_results,
            'providerResult', callback.callback_result
          )
          else callback.callback_result end
      ) order by callback.executor_id), '[]'::jsonb)
       from public.rerun_execution_callbacks callback
       where callback.work_reservation_id = v_existing.id
         and callback.status <> 'canceled'),
      true;
    return;
  end if;
  select * into v_proposal from public.actions where id = v_execution.proposal_action_id;
  insert into public.actions (
    id, schema_version, project_id, orchestrator_run_id, tool, status, params,
    input_asset_ids, rationale, proposal, job_ids, output_asset_ids
  ) values (
    p_dispatch_action_id, 'action.v1', p_project_id, v_execution.root_run_id,
    'rerun_work_item_dispatch', 'running',
    jsonb_build_object('schema_version', 'action_params.v1') || p_dispatch_params,
    '{}', 'Bound selective-regeneration work-item dispatch.', null, '{}', '{}'
  );
  insert into public.rerun_execution_work_items (
    execution_reservation_id, project_id, work_item_id, request_fingerprint,
    dispatch_action_id, lease_generation
  ) values (
    p_reservation_id, p_project_id, p_work_item_id, p_request_fingerprint,
    p_dispatch_action_id, p_lease_generation
  ) returning id into work_reservation_id;
  for v_callback in select value from jsonb_array_elements(p_callback_fences)
  loop
    insert into public.rerun_execution_callbacks (
      execution_reservation_id, work_reservation_id, project_id, executor_id,
      binding_subset, callback_token_hash, callback_generation
    ) values (
      p_reservation_id, work_reservation_id, p_project_id,
      v_callback ->> 'executorId',
      coalesce(v_callback -> 'requiredOutputs', '[]'::jsonb),
      v_callback ->> 'tokenHash',
      (v_callback ->> 'generation')::integer
    );
  end loop;
  update public.rerun_execution_work_items
     set status = 'running'
   where id = work_reservation_id;
  work_status := 'running';
  child_run_id := null;
  report_action_id := null;
  reconciliation_action_id := null;
  binding_results := null;
  primitive_action_ids := '{}';
  budget_reservation_keys := '{}';
  callback_results := '[]'::jsonb;
  replayed := false;
  return next;
end;
$$;

create or replace function public.park_rerun_work_item(
  p_project_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid,
  p_lease_generation integer,
  p_work_item_id text,
  p_accepted_callbacks jsonb,
  p_completed_callbacks jsonb,
  p_blocked_precondition jsonb,
  p_partial_binding_results jsonb,
  p_primitive_action_ids uuid[],
  p_budget_reservation_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execution public.rerun_execution_reservations%rowtype;
  v_work public.rerun_execution_work_items%rowtype;
  v_callback jsonb;
  v_primitive_ids uuid[] := coalesce(p_primitive_action_ids, '{}');
  v_budget_keys text[] := coalesce(p_budget_reservation_keys, '{}');
begin
  select * into v_execution from public.rerun_execution_reservations
   where id = p_reservation_id and project_id = p_project_id for update;
  if not found or v_execution.status <> 'running'
     or v_execution.lease_token is distinct from p_lease_token
     or v_execution.lease_generation is distinct from p_lease_generation
     or v_execution.lease_expires_at <= now() then
    raise exception 'stale_rerun_execution_lease' using errcode = '55000';
  end if;
  select * into v_work from public.rerun_execution_work_items
   where execution_reservation_id = p_reservation_id
     and work_item_id = p_work_item_id for update;
  if not found then raise exception 'rerun work item not found' using errcode = 'P0002'; end if;
  if p_blocked_precondition is not null and (
       p_accepted_callbacks is not null or p_completed_callbacks is not null
     ) then
    raise exception 'blocked work cannot also accept or complete executor steps'
      using errcode = '22023';
  end if;
  if p_blocked_precondition is null
     and p_accepted_callbacks is null and p_completed_callbacks is null then
    raise exception 'work park requires executor progress or a blocked payload'
      using errcode = '22023';
  end if;
  if p_accepted_callbacks is not null and (
    jsonb_typeof(p_accepted_callbacks) <> 'array'
    or jsonb_array_length(p_accepted_callbacks) = 0
  ) then
    raise exception 'accepted callbacks must be a non-empty array'
      using errcode = '22023';
  end if;
  if p_completed_callbacks is not null and (
    jsonb_typeof(p_completed_callbacks) <> 'array'
    or jsonb_array_length(p_completed_callbacks) = 0
  ) then
    raise exception 'completed callbacks must be a non-empty array'
      using errcode = '22023';
  end if;
  if p_partial_binding_results is not null
     and jsonb_typeof(p_partial_binding_results) <> 'array' then
    raise exception 'partial binding results must be an array'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_primitive_ids) primitive_id
     where not exists (
       select 1 from public.actions a
        where a.id = primitive_id and a.project_id = p_project_id
          and a.status = 'applied'
          and (
            a.orchestrator_run_id = v_execution.root_run_id
            or exists (
              select 1 from public.orchestrator_runs child
               where child.id = a.orchestrator_run_id
                 and child.parent_run_id = v_execution.root_run_id
                 and child.root_action_id = v_work.dispatch_action_id
                 and child.task_params #>> '{approvalContext,proposalActionId}'
                   = v_execution.proposal_action_id::text
                 and child.task_params #>> '{approvalContext,executionReservationId}'
                   = v_execution.id::text
            )
          )
     )
  ) then
    raise exception 'primitive action is outside execution root'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from unnest(v_budget_keys) budget_key
     where not exists (
       select 1 from public.orchestrator_budget_reservations budget
        where budget.project_id = p_project_id
          and budget.parent_reservation_id = v_execution.budget_reservation_id
          and budget.reservation_key = budget_key
          and budget.action_id = any(
            array_append(v_primitive_ids, v_work.dispatch_action_id)
          )
     )
  ) then
    raise exception 'budget reservation is outside work-item causation'
      using errcode = 'check_violation';
  end if;
  update public.rerun_execution_work_items
     set status = case when p_blocked_precondition is not null
       then 'failed'::public.rerun_work_item_status
       else 'running'::public.rerun_work_item_status end,
         accepted_callbacks = p_accepted_callbacks,
         blocked_precondition = p_blocked_precondition,
         binding_results = coalesce(p_partial_binding_results, binding_results),
         primitive_action_ids = (
           select coalesce(array_agg(distinct id), '{}')
             from unnest(primitive_action_ids || v_primitive_ids) id
         ),
         budget_reservation_keys = (
           select coalesce(array_agg(distinct key), '{}')
             from unnest(budget_reservation_keys || v_budget_keys) key
         ),
         error = case when p_blocked_precondition is not null
           then jsonb_build_object(
             'schema_version', 'rerun_work_error.v1',
             'kind', 'blocked_precondition',
             'precondition', p_blocked_precondition
           )
           else error end
   where id = v_work.id;
  if p_blocked_precondition is not null then
    update public.actions
       set status = 'failed',
           error = jsonb_build_object(
             'schema_version', 'action_error.v1',
             'kind', 'blocked_precondition',
             'precondition', p_blocked_precondition
           )
     where id = v_work.dispatch_action_id and status = 'running';
    update public.rerun_execution_callbacks
       set status = 'canceled'
     where work_reservation_id = v_work.id and status = 'pending';
    update public.orchestrator_budget_reservations
       set status = 'released', released_at = now(), updated_at = now()
     where parent_reservation_id = v_execution.budget_reservation_id
       and reservation_key = any(v_budget_keys)
       and status = 'reserved';
    return;
  end if;
  if p_completed_callbacks is not null then
    for v_callback in select value from jsonb_array_elements(p_completed_callbacks)
    loop
      if exists (
        select 1 from public.rerun_execution_callbacks step
         where step.work_reservation_id = v_work.id
           and step.executor_id = v_callback ->> 'executorId'
           and step.status = 'completed'
           and (
             step.binding_results is distinct from
               coalesce(v_callback #> '{result,outputs}', '[]'::jsonb)
             or step.child_run_id is distinct from
               nullif(v_callback #>> '{result,childRunId}', '')::uuid
	             or step.report_action_id is distinct from
	               nullif(v_callback #>> '{result,reportActionId}', '')::uuid
	             or step.reconciliation_action_id is distinct from
	               nullif(v_callback #>> '{result,reconciliationActionId}', '')::uuid
	             or step.callback_result is distinct from
	               (v_callback #> '{result,providerResult}')
	             or step.primitive_action_ids is distinct from array(
               select jsonb_array_elements_text(coalesce(
                 v_callback #> '{result,primitiveActionIds}', '[]'::jsonb
               ))::uuid
             )
             or step.budget_reservation_keys is distinct from array(
               select jsonb_array_elements_text(coalesce(
                 v_callback #> '{result,budgetReservationKeys}', '[]'::jsonb
               ))
             )
           )
      ) then
        raise exception 'completed callback replay mismatch'
          using errcode = '23505';
      end if;
      update public.rerun_execution_callbacks
         set status = 'completed',
             callback_result = v_callback #> '{result,providerResult}',
             child_run_id = nullif(v_callback #>> '{result,childRunId}', '')::uuid,
             report_action_id = nullif(v_callback #>> '{result,reportActionId}', '')::uuid,
             reconciliation_action_id =
               nullif(v_callback #>> '{result,reconciliationActionId}', '')::uuid,
             primitive_action_ids = array(
               select jsonb_array_elements_text(
                 coalesce(v_callback #> '{result,primitiveActionIds}', '[]'::jsonb)
               )::uuid
             ),
             budget_reservation_keys = array(
               select jsonb_array_elements_text(
                 coalesce(v_callback #> '{result,budgetReservationKeys}', '[]'::jsonb)
               )
             ),
             binding_results =
               coalesce(v_callback #> '{result,outputs}', '[]'::jsonb),
             completed_at = now()
       where work_reservation_id = v_work.id
         and executor_id = v_callback ->> 'executorId'
         and callback_token_hash = v_callback ->> 'tokenHash'
         and callback_generation = (v_callback ->> 'generation')::integer
         and status in ('pending', 'completed');
      if not found then
        raise exception 'completed callback fence mismatch' using errcode = '55000';
      end if;
    end loop;
  end if;
  if p_accepted_callbacks is not null then
    for v_callback in select value from jsonb_array_elements(p_accepted_callbacks)
    loop
      update public.rerun_execution_callbacks
         set job_ids = array(
           select jsonb_array_elements_text(v_callback -> 'jobIds')::uuid
         )
       where work_reservation_id = v_work.id
         and executor_id = v_callback ->> 'executorId'
         and callback_token_hash = v_callback ->> 'tokenHash'
         and callback_generation = (v_callback ->> 'generation')::integer
         and status in ('pending', 'completed');
      if not found then
        raise exception 'accepted callback fence mismatch' using errcode = '55000';
      end if;
    end loop;
  end if;
  update public.rerun_execution_work_items
     set primitive_action_ids = (
           select coalesce(array_agg(distinct primitive_id), '{}')
             from public.rerun_execution_callbacks step,
                  unnest(step.primitive_action_ids) primitive_id
            where step.work_reservation_id = v_work.id
         ),
         budget_reservation_keys = (
           select coalesce(array_agg(distinct budget_key), '{}')
             from public.rerun_execution_callbacks step,
                  unnest(step.budget_reservation_keys) budget_key
            where step.work_reservation_id = v_work.id
         ),
         binding_results = (
           select coalesce(jsonb_agg(binding order by
             (binding ->> 'ordinal')::integer,
             binding ->> 'bindingId'), '[]'::jsonb)
             from public.rerun_execution_callbacks step,
                  jsonb_array_elements(step.binding_results) binding
            where step.work_reservation_id = v_work.id
         )
   where id = v_work.id;
end;
$$;

create or replace function public.record_rerun_executor_callback(
  p_project_id uuid,
  p_reservation_id uuid,
  p_work_item_id text,
  p_executor_id text,
  p_callback_token text,
  p_callback_generation integer,
  p_outcome text,
  p_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_callback public.rerun_execution_callbacks%rowtype;
  v_execution public.rerun_execution_reservations%rowtype;
  v_work public.rerun_execution_work_items%rowtype;
begin
  if p_outcome not in ('completed', 'failed') then
    raise exception 'invalid rerun callback outcome' using errcode = '22023';
  end if;
  select * into v_execution from public.rerun_execution_reservations
   where id = p_reservation_id and project_id = p_project_id for update;
  if not found then raise exception 'rerun callback not found' using errcode = 'P0002'; end if;
  select * into v_work from public.rerun_execution_work_items
   where execution_reservation_id = p_reservation_id
     and work_item_id = p_work_item_id for update;
  if not found then raise exception 'rerun callback not found' using errcode = 'P0002'; end if;
  select * into v_callback from public.rerun_execution_callbacks
   where work_reservation_id = v_work.id
     and executor_id = p_executor_id for update;
  if not found then raise exception 'rerun callback not found' using errcode = 'P0002'; end if;
  if v_callback.callback_generation is distinct from p_callback_generation
     or v_callback.callback_token_hash is distinct from
       encode(extensions.digest(p_callback_token, 'sha256'), 'hex') then
    raise exception 'stale_rerun_callback_fence' using errcode = '55000';
  end if;
  if v_callback.status in ('completed', 'failed') then
    if v_callback.status is distinct from p_outcome
       or v_callback.callback_result is distinct from p_result -> 'providerResult'
       or v_callback.child_run_id is distinct from
         nullif(p_result ->> 'childRunId', '')::uuid
       or v_callback.report_action_id is distinct from
         nullif(p_result ->> 'reportActionId', '')::uuid
       or v_callback.reconciliation_action_id is distinct from
         nullif(p_result ->> 'reconciliationActionId', '')::uuid
       or v_callback.primitive_action_ids is distinct from array(
         select jsonb_array_elements_text(
           coalesce(p_result -> 'primitiveActionIds', '[]'::jsonb)
         )::uuid
       )
       or v_callback.budget_reservation_keys is distinct from array(
         select jsonb_array_elements_text(
           coalesce(p_result -> 'budgetReservationKeys', '[]'::jsonb)
         )
       )
       or v_callback.binding_results is distinct from
         coalesce(p_result -> 'outputs', '[]'::jsonb) then
      raise exception 'rerun_callback_replay_mismatch' using errcode = '23505';
    end if;
    return true;
  end if;
  if v_callback.status <> 'pending'
     or v_callback.expires_at <= now()
     or v_execution.status not in ('running', 'waiting')
     or v_work.status <> 'running' then
    raise exception 'stale_rerun_callback_fence' using errcode = '55000';
  end if;
  update public.rerun_execution_callbacks
     set status = p_outcome,
         callback_result = p_result -> 'providerResult',
         child_run_id = nullif(p_result ->> 'childRunId', '')::uuid,
         report_action_id = nullif(p_result ->> 'reportActionId', '')::uuid,
         reconciliation_action_id =
           nullif(p_result ->> 'reconciliationActionId', '')::uuid,
         primitive_action_ids = array(
           select jsonb_array_elements_text(
             coalesce(p_result -> 'primitiveActionIds', '[]'::jsonb)
           )::uuid
         ),
         budget_reservation_keys = array(
           select jsonb_array_elements_text(
             coalesce(p_result -> 'budgetReservationKeys', '[]'::jsonb)
           )
         ),
         binding_results = coalesce(p_result -> 'outputs', '[]'::jsonb),
         completed_at = now()
   where id = v_callback.id;
  update public.rerun_execution_work_items
     set primitive_action_ids = (
           select coalesce(array_agg(distinct primitive_id), '{}')
             from public.rerun_execution_callbacks step,
                  unnest(step.primitive_action_ids) primitive_id
            where step.work_reservation_id = v_work.id
         ),
         budget_reservation_keys = (
           select coalesce(array_agg(distinct budget_key), '{}')
             from public.rerun_execution_callbacks step,
                  unnest(step.budget_reservation_keys) budget_key
            where step.work_reservation_id = v_work.id
         ),
         binding_results = (
           select coalesce(jsonb_agg(binding order by
             (binding ->> 'ordinal')::integer,
             binding ->> 'bindingId'), '[]'::jsonb)
             from public.rerun_execution_callbacks step,
                  jsonb_array_elements(step.binding_results) binding
            where step.work_reservation_id = v_work.id
         )
   where id = v_work.id;
  return false;
end;
$$;

create or replace function public.park_rerun_execution(
  p_project_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid,
  p_lease_generation integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rerun_execution_reservations
     set status = 'waiting', lease_token = null, lease_expires_at = null
   where id = p_reservation_id and project_id = p_project_id
     and status = 'running'
     and lease_token is not distinct from p_lease_token
     and lease_generation is not distinct from p_lease_generation
     and exists (
       select 1 from public.rerun_execution_work_items work
        where work.execution_reservation_id = p_reservation_id
          and work.status in ('running', 'blocked')
     );
  if not found then
    raise exception 'stale_rerun_execution_lease' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.complete_rerun_work_item(
  p_project_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid,
  p_lease_generation integer,
  p_work_item_id text,
  p_child_run_id uuid,
  p_report_action_id uuid,
  p_reconciliation_action_id uuid,
  p_binding_results jsonb,
  p_primitive_action_ids uuid[],
  p_budget_reservation_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execution public.rerun_execution_reservations%rowtype;
  v_work public.rerun_execution_work_items%rowtype;
  v_proposal public.actions%rowtype;
  v_expected jsonb;
  v_result jsonb;
  v_asset public.assets%rowtype;
  v_output_ids uuid[] := '{}';
  v_expected_count integer;
  v_result_count integer;
  v_step public.rerun_execution_callbacks%rowtype;
  v_step_reconciliation_action_id uuid;
begin
  select * into v_execution from public.rerun_execution_reservations
   where id = p_reservation_id and project_id = p_project_id for update;
  if not found or v_execution.status <> 'running'
     or v_execution.lease_token is distinct from p_lease_token
     or v_execution.lease_generation is distinct from p_lease_generation
     or v_execution.lease_expires_at <= now() then
    raise exception 'stale_rerun_execution_lease' using errcode = '55000';
  end if;
  select * into v_work from public.rerun_execution_work_items
   where execution_reservation_id = p_reservation_id
     and work_item_id = p_work_item_id for update;
  if not found then raise exception 'rerun work item not found' using errcode = 'P0002'; end if;
  if v_work.status = 'completed' then
    if v_work.binding_results is distinct from p_binding_results
       or v_work.child_run_id is distinct from p_child_run_id
       or v_work.report_action_id is distinct from p_report_action_id
       or v_work.reconciliation_action_id is distinct from p_reconciliation_action_id
       or v_work.primitive_action_ids is distinct from
         coalesce(p_primitive_action_ids, '{}')
       or v_work.budget_reservation_keys is distinct from
         coalesce(p_budget_reservation_keys, '{}') then
      raise exception 'rerun_work_completion_replay_mismatch' using errcode = '23505';
    end if;
    return;
  end if;
  if v_work.status not in ('reserved', 'running') then
    raise exception 'rerun work item is terminal' using errcode = '55000';
  end if;
  if jsonb_typeof(p_binding_results) <> 'array' then
    raise exception 'binding results must be an array' using errcode = '22023';
  end if;
  if (
    select coalesce(array_agg(distinct id order by id), '{}')
      from unnest(coalesce(p_primitive_action_ids, '{}')) id
  ) is distinct from (
    select coalesce(array_agg(distinct id order by id), '{}')
      from unnest(v_work.primitive_action_ids) id
  ) or (
    select coalesce(array_agg(distinct key order by key), '{}')
      from unnest(coalesce(p_budget_reservation_keys, '{}')) key
  ) is distinct from (
    select coalesce(array_agg(distinct key order by key), '{}')
      from unnest(v_work.budget_reservation_keys) key
  ) then
    raise exception 'declared work causation differs from durable reservation'
      using errcode = 'check_violation';
  end if;
  select * into v_proposal from public.actions where id = v_execution.proposal_action_id;
  select work -> 'requiredOutputs' into v_expected
    from jsonb_array_elements(v_proposal.proposal -> 'selectedWork') work
   where work ->> 'workItemId' = p_work_item_id;
  if v_expected is null then raise exception 'proposal work item not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.rerun_execution_callbacks
     where work_reservation_id = v_work.id
  ) then
    if exists (
      select 1 from public.rerun_execution_callbacks
       where work_reservation_id = v_work.id
         and status not in ('completed', 'canceled')
    ) then
      raise exception 'rerun work has incomplete executor steps'
        using errcode = 'check_violation';
    end if;
    if p_child_run_id is not null or p_report_action_id is not null then
      raise exception 'step-backed work cannot claim one aggregate child'
        using errcode = '22023';
    end if;
    if (
      select count(distinct reconciliation_action_id)
        from public.rerun_execution_callbacks
       where work_reservation_id = v_work.id
         and status = 'completed'
         and reconciliation_action_id is not null
    ) > 1 then
      raise exception 'executor steps claimed conflicting reconciliation actions'
        using errcode = 'check_violation';
    end if;
    select reconciliation_action_id
      into v_step_reconciliation_action_id
      from public.rerun_execution_callbacks
     where work_reservation_id = v_work.id
       and status = 'completed'
       and reconciliation_action_id is not null
     limit 1;
    if p_reconciliation_action_id is distinct from
         v_step_reconciliation_action_id then
      raise exception 'aggregate reconciliation differs from durable executor steps'
        using errcode = 'check_violation';
    end if;
    for v_step in
      select * from public.rerun_execution_callbacks
       where work_reservation_id = v_work.id and status = 'completed'
       order by executor_id
    loop
      if jsonb_array_length(v_step.binding_subset) <>
           jsonb_array_length(v_step.binding_results)
         or exists (
           select 1 from jsonb_array_elements(v_step.binding_results) result
            where not exists (
              select 1 from jsonb_array_elements(v_step.binding_subset) expected
               where expected ->> 'bindingId' = result ->> 'bindingId'
                 and expected ->> 'workItemId' = result ->> 'workItemId'
                 and expected -> 'target' = result -> 'target'
                 and expected ->> 'kind' = result ->> 'kind'
                 and expected ->> 'role' = result ->> 'role'
                 and (expected ->> 'ordinal')::integer =
                   (result ->> 'ordinal')::integer
            )
         ) then
        raise exception 'executor step binding subset mismatch'
          using errcode = 'check_violation';
      end if;
      if (v_step.child_run_id is null) <>
           (v_step.report_action_id is null) then
        raise exception 'executor step child and report must be paired'
          using errcode = 'check_violation';
      end if;
      if v_step.child_run_id is not null and not exists (
        select 1
          from public.orchestrator_runs child
          join public.actions report on report.id = v_step.report_action_id
         where child.id = v_step.child_run_id
           and child.project_id = p_project_id
           and child.parent_run_id = v_execution.root_run_id
           and child.root_action_id = v_work.dispatch_action_id
           and child.task_params #>> '{approvalContext,proposalActionId}'
             = v_execution.proposal_action_id::text
           and child.task_params #>> '{approvalContext,executionReservationId}'
             = v_execution.id::text
           and child.status = 'succeeded'
           and report.project_id = p_project_id
           and report.orchestrator_run_id = child.id
           and report.tool = 'domain_report'
           and report.status = 'applied'
           and report.params #> '{outcome,outputs}' = v_step.binding_results
      ) then
        raise exception 'executor step child report causation mismatch'
          using errcode = 'check_violation';
      end if;
    end loop;
    if p_binding_results is distinct from (
      select coalesce(jsonb_agg(binding order by
        (binding ->> 'ordinal')::integer,
        binding ->> 'bindingId'), '[]'::jsonb)
        from public.rerun_execution_callbacks step,
             jsonb_array_elements(step.binding_results) binding
       where step.work_reservation_id = v_work.id
         and step.status = 'completed'
    ) then
      raise exception 'aggregate bindings differ from durable executor steps'
        using errcode = 'check_violation';
    end if;
  end if;
  v_expected_count := jsonb_array_length(v_expected);
  v_result_count := jsonb_array_length(p_binding_results);
  if v_expected_count <> v_result_count then
    raise exception 'bound output count mismatch' using errcode = 'check_violation';
  end if;

  for v_result in select value from jsonb_array_elements(p_binding_results)
  loop
    if (
      select count(*) from jsonb_array_elements(v_expected) expected
       where expected ->> 'bindingId' = v_result ->> 'bindingId'
         and expected ->> 'workItemId' = v_result ->> 'workItemId'
         and expected -> 'target' = v_result -> 'target'
         and expected ->> 'kind' = v_result ->> 'kind'
         and expected ->> 'role' = v_result ->> 'role'
         and (expected ->> 'ordinal')::integer = (v_result ->> 'ordinal')::integer
    ) <> 1 then
      raise exception 'report claimed a binding outside its task'
        using errcode = 'check_violation';
    end if;
    if (
      select count(*) from jsonb_array_elements(p_binding_results) sibling
       where sibling ->> 'bindingId' = v_result ->> 'bindingId'
    ) <> 1 then
      raise exception 'report binding must appear exactly once'
        using errcode = 'check_violation';
    end if;
    select * into v_asset from public.assets
     where id = (v_result ->> 'assetId')::uuid and project_id = p_project_id;
    if not found then raise exception 'bound output asset not in project' using errcode = 'P0002'; end if;
    if v_asset.kind::text is distinct from (case (v_result ->> 'kind')
      when 'storyboard' then 'image'
      when 'audio_fit' then 'critique'
      else v_result ->> 'kind'
    end) then
      raise exception 'bound output asset kind mismatch' using errcode = 'check_violation';
    end if;
    if v_asset.role is distinct from v_result ->> 'intrinsicRole' then
      raise exception 'bound output intrinsic role mismatch' using errcode = 'check_violation';
    end if;
    v_output_ids := array_append(v_output_ids, v_asset.id);
  end loop;

  if (p_child_run_id is null) <> (p_report_action_id is null) then
    raise exception 'child run and report action must be provided together'
      using errcode = '22023';
  end if;
  if p_child_run_id is not null and not exists (
    select 1
      from public.orchestrator_runs child
      join public.actions report on report.id = p_report_action_id
     where child.id = p_child_run_id and child.project_id = p_project_id
       and child.parent_run_id = v_execution.root_run_id
       and child.root_action_id = v_work.dispatch_action_id
       and child.task_params #>> '{approvalContext,proposalActionId}'
         = v_execution.proposal_action_id::text
       and child.task_params #>> '{approvalContext,executionReservationId}'
         = v_execution.id::text
       and child.status = 'succeeded'
       and report.project_id = p_project_id
       and report.orchestrator_run_id = child.id
       and report.tool = 'domain_report' and report.status = 'applied'
       and report.params #> '{outcome,outputs}' = p_binding_results
  ) then
    raise exception 'domain report causation or fenced finalization mismatch'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from unnest(v_output_ids) output_id
     where not exists (
       select 1
         from public.rerun_execution_callbacks step
         join lateral jsonb_array_elements(step.binding_results) binding
           on (binding ->> 'assetId')::uuid = output_id
         join public.action_assets aa
           on aa.asset_id = output_id and aa.direction = 'output'
         join public.actions primitive on primitive.id = aa.action_id
        where step.work_reservation_id = v_work.id
          and step.status = 'completed'
          and aa.project_id = p_project_id
          and aa.action_id = any(step.primitive_action_ids)
          and primitive.orchestrator_run_id = coalesce(
            step.child_run_id, v_execution.root_run_id
          )
          and primitive.tool <> 'domain_report'
          and primitive.status = 'applied'
          and exists (
            select 1
              from public.orchestrator_budget_reservations budget
             where budget.project_id = p_project_id
               and budget.parent_reservation_id =
                 v_execution.budget_reservation_id
               and budget.reservation_key = any(step.budget_reservation_keys)
               and budget.action_id = primitive.id
               and budget.orchestrator_run_id = coalesce(
                 step.child_run_id, v_execution.root_run_id
               )
               and budget.status = 'settled'
          )
     )
     and exists (
       select 1 from public.rerun_execution_callbacks
        where work_reservation_id = v_work.id
     )
  ) then
    raise exception 'bound output lacks primitive action and budget causation'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.rerun_execution_callbacks
     where work_reservation_id = v_work.id
  ) and exists (
    select 1 from unnest(v_output_ids) output_id
     where not exists (
       select 1
         from public.action_assets aa
         join public.actions primitive on primitive.id = aa.action_id
        where aa.project_id = p_project_id
          and aa.asset_id = output_id
          and aa.direction = 'output'
          and aa.action_id = any(v_work.primitive_action_ids)
          and primitive.orchestrator_run_id =
            coalesce(p_child_run_id, v_execution.root_run_id)
          and primitive.tool <> 'domain_report'
          and primitive.status = 'applied'
          and exists (
            select 1 from public.orchestrator_budget_reservations budget
             where budget.parent_reservation_id =
               v_execution.budget_reservation_id
               and budget.reservation_key =
                 any(v_work.budget_reservation_keys)
               and budget.action_id = primitive.id
               and budget.status = 'settled'
          )
     )
  ) then
    raise exception 'bound output lacks primitive action and budget causation'
      using errcode = 'check_violation';
  end if;
  if p_reconciliation_action_id is not null and not exists (
    select 1 from public.actions reconciliation
     where reconciliation.id = p_reconciliation_action_id
       and reconciliation.project_id = p_project_id
       and reconciliation.orchestrator_run_id = v_execution.root_run_id
       and reconciliation.status = 'applied'
       and reconciliation.params ->> 'proposalActionId' =
         v_execution.proposal_action_id::text
       and reconciliation.params ->> 'executionReservationId' =
         v_execution.id::text
       and reconciliation.params ->> 'workItemId' = v_work.work_item_id
  ) then
    raise exception 'work reconciliation is outside proposal causation'
      using errcode = 'check_violation';
  end if;

  update public.rerun_execution_work_items
     set status = 'completed', child_run_id = p_child_run_id,
         report_action_id = p_report_action_id,
         reconciliation_action_id = p_reconciliation_action_id,
         binding_results = p_binding_results, output_asset_ids = v_output_ids
   where id = v_work.id;
  update public.rerun_execution_callbacks set status = 'canceled'
   where work_reservation_id = v_work.id and status = 'pending';
  update public.actions
     set status = 'applied', output_asset_ids = v_output_ids
   where id = v_work.dispatch_action_id;
  insert into public.action_assets(project_id, action_id, asset_id, direction, role, ordinal)
  select p_project_id, v_work.dispatch_action_id, result.asset_id, 'output',
         result.role, result.ordinal
    from (
      select (value ->> 'assetId')::uuid as asset_id,
             value ->> 'role' as role,
             (value ->> 'ordinal')::integer as ordinal
        from jsonb_array_elements(p_binding_results)
    ) result
  on conflict (action_id, direction, ordinal) do nothing;
end;
$$;

create or replace function public.fail_rerun_work_item(
  p_project_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid,
  p_lease_generation integer,
  p_work_item_id text,
  p_error jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execution public.rerun_execution_reservations%rowtype;
  v_work public.rerun_execution_work_items%rowtype;
begin
  select * into v_execution from public.rerun_execution_reservations
   where id = p_reservation_id and project_id = p_project_id for update;
  if not found or v_execution.status <> 'running'
     or v_execution.lease_token is distinct from p_lease_token
     or v_execution.lease_generation is distinct from p_lease_generation
     or v_execution.lease_expires_at <= now() then
    raise exception 'stale_rerun_execution_lease' using errcode = '55000';
  end if;
  select * into v_work from public.rerun_execution_work_items
   where execution_reservation_id = p_reservation_id
     and work_item_id = p_work_item_id for update;
  if not found then raise exception 'rerun work item not found' using errcode = 'P0002'; end if;
  if v_work.status = 'failed' then
    if v_work.error is distinct from p_error then
      raise exception 'rerun_work_failure_replay_mismatch' using errcode = '23505';
    end if;
    return;
  end if;
  if v_work.status = 'completed' then
    raise exception 'completed rerun work cannot fail' using errcode = '55000';
  end if;
  update public.rerun_execution_work_items
     set status = 'failed',
         error = jsonb_build_object('schema_version', 'rerun_work_error.v1')
           || coalesce(p_error, '{}'::jsonb)
   where id = v_work.id;
  update public.actions
     set status = 'failed',
         error = jsonb_build_object('schema_version', 'action_error.v1')
           || coalesce(p_error, '{}'::jsonb)
   where id = v_work.dispatch_action_id and status = 'running';
  update public.rerun_execution_callbacks
     set status = 'canceled'
   where work_reservation_id = v_work.id and status = 'pending';
  update public.orchestrator_budget_reservations
     set status = 'released', released_at = now(), updated_at = now()
   where parent_reservation_id = v_execution.budget_reservation_id
     and reservation_key = any(v_work.budget_reservation_keys)
     and status = 'reserved';
end;
$$;

create or replace function public.finalize_rerun_execution(
  p_project_id uuid,
  p_reservation_id uuid,
  p_lease_token uuid,
  p_lease_generation integer,
  p_execution_action_id uuid,
  p_outcome text,
  p_reconciliation_action_id uuid,
  p_error jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execution public.rerun_execution_reservations%rowtype;
  v_proposal public.actions%rowtype;
  v_existing public.actions%rowtype;
  v_outputs uuid[];
  v_child_runs uuid[];
  v_failed jsonb;
  v_actual_cost_usd double precision;
begin
  if p_outcome not in ('applied', 'failed') then
    raise exception 'invalid rerun terminal input' using errcode = '22023';
  end if;
  select * into v_execution from public.rerun_execution_reservations
   where id = p_reservation_id and project_id = p_project_id for update;
  if not found then raise exception 'execution reservation not found' using errcode = 'P0002'; end if;
  if v_execution.execution_result_action_id is not null then
    if v_execution.execution_result_action_id is distinct from p_execution_action_id then
      raise exception 'rerun_execution_replay_mismatch' using errcode = '23505';
    end if;
    select * into v_existing from public.actions
     where id = v_execution.execution_result_action_id;
    if v_existing.status is distinct from p_outcome::public.action_status
       or v_existing.params ->> 'reconciliationActionId'
         is distinct from p_reconciliation_action_id::text then
      raise exception 'rerun_execution_replay_mismatch' using errcode = '23505';
    end if;
    return v_execution.execution_result_action_id;
  end if;
  if v_execution.status <> 'running'
     or v_execution.lease_token is distinct from p_lease_token
     or v_execution.lease_generation is distinct from p_lease_generation
     or v_execution.lease_expires_at is null
     or v_execution.lease_expires_at <= now() then
    raise exception 'stale_rerun_execution_lease' using errcode = '55000';
  end if;
  select * into v_proposal from public.actions where id = v_execution.proposal_action_id;
  if p_outcome = 'failed' then
    update public.rerun_execution_work_items
       set status = 'canceled',
           error = coalesce(error, jsonb_build_object(
             'schema_version', 'rerun_work_error.v1',
             'kind', 'execution_failed'
           ))
     where execution_reservation_id = v_execution.id
       and status in ('reserved', 'running', 'blocked');
    update public.rerun_execution_callbacks
       set status = 'canceled'
     where execution_reservation_id = v_execution.id and status = 'pending';
    update public.orchestrator_budget_reservations
       set status = 'released', released_at = now(), updated_at = now()
     where parent_reservation_id = v_execution.budget_reservation_id
       and status = 'reserved';
  elsif exists (
    select 1 from public.orchestrator_budget_reservations
     where parent_reservation_id = v_execution.budget_reservation_id
       and status = 'reserved'
  ) then
    raise exception 'rerun execution has unsettled child budget'
      using errcode = 'check_violation';
  end if;
  select coalesce(sum(actual_usd), 0) into v_actual_cost_usd
    from public.orchestrator_budget_reservations
   where parent_reservation_id = v_execution.budget_reservation_id
     and status = 'settled';
  if v_actual_cost_usd > v_execution.approved_max_cost_usd then
    raise exception 'rerun actual cost exceeds approved ceiling'
      using errcode = 'check_violation';
  end if;
  if p_outcome = 'applied' then
    if exists (
      select 1 from public.rerun_execution_work_items
       where execution_reservation_id = p_reservation_id and status <> 'completed'
    ) or (
      select count(*) from public.rerun_execution_work_items
       where execution_reservation_id = p_reservation_id
    ) <> jsonb_array_length(v_proposal.proposal -> 'selectedWork') then
      raise exception 'rerun execution has incomplete bound work'
        using errcode = 'check_violation';
    end if;
    if p_reconciliation_action_id is null or not exists (
      select 1 from public.actions a
       where a.id = p_reconciliation_action_id and a.project_id = p_project_id
         and a.orchestrator_run_id = v_execution.root_run_id
         and a.tool = 'rerun_reconciliation'
         and a.params ->> 'schemaVersion' = 'RerunReconciliation.v1'
         and a.params ->> 'proposalActionId' = v_proposal.id::text
         and a.params ->> 'executionReservationId' = v_execution.id::text
         and a.status = 'applied'
    ) then
      raise exception 'applied rerun requires terminal root reconciliation'
        using errcode = 'check_violation';
    end if;
  end if;
  select coalesce(array_agg(distinct output_id), '{}') into v_outputs
    from public.rerun_execution_work_items work,
         unnest(work.output_asset_ids) output_id
   where work.execution_reservation_id = p_reservation_id;
  select coalesce(array_agg(distinct child_run_id)
    filter (where child_run_id is not null), '{}')
    into v_child_runs
    from (
      select child_run_id
        from public.rerun_execution_work_items
       where execution_reservation_id = p_reservation_id
      union all
      select callback.child_run_id
        from public.rerun_execution_callbacks callback
       where callback.execution_reservation_id = p_reservation_id
         and callback.status = 'completed'
    ) child_runs;
  select coalesce(jsonb_agg(jsonb_build_object(
    'workItemId', work_item_id, 'error', error
  )) filter (where status = 'failed'), '[]'::jsonb)
    into v_failed
    from public.rerun_execution_work_items
   where execution_reservation_id = p_reservation_id;

  insert into public.actions (
    id, schema_version, project_id, orchestrator_run_id, tool, status, params,
    input_asset_ids, rationale, proposal, job_ids, output_asset_ids, error
  ) values (
    p_execution_action_id, 'action.v1', p_project_id,
    v_execution.root_run_id, 'rerun_execution',
    p_outcome::public.action_status,
    jsonb_build_object(
      'schema_version', 'action_params.v1',
      'schemaVersion', 'RerunExecution.v1',
      'proposalActionId', v_proposal.id,
      'outcome', p_outcome,
      'childRunIds', to_jsonb(v_child_runs),
      'outputAssetIds', to_jsonb(v_outputs),
      'movedSelections', '[]'::jsonb,
      'preservedAssetIds', v_proposal.proposal -> 'preservedAssetIds',
      'failedWorkItems', v_failed,
      'actualCostUsd', v_actual_cost_usd,
      'reconciliationActionId', p_reconciliation_action_id
    ),
    v_proposal.input_asset_ids,
    'Terminal selective-regeneration execution result.',
    null, '{}', v_outputs,
    case when p_outcome = 'failed'
      then jsonb_build_object('schema_version', 'action_error.v1') || coalesce(p_error, '{}'::jsonb)
      else null end
  );
  insert into public.action_assets(project_id, action_id, asset_id, direction, role, ordinal)
  select p_project_id, p_execution_action_id, asset_id, 'output', 'rerun_output', ordinal - 1
    from unnest(v_outputs) with ordinality output(asset_id, ordinal);
  update public.actions set status = p_outcome::public.action_status
   where id = v_proposal.id;
  update public.rerun_execution_reservations
     set status = case when p_outcome = 'applied'
       then 'completed'::public.rerun_execution_status
       else 'failed'::public.rerun_execution_status end,
         execution_result_action_id = p_execution_action_id,
         lease_token = null, lease_expires_at = null
   where id = p_reservation_id;
  -- A proposal ceiling is admission authority, not a charge. Child settlement
  -- already records actual spend; releasing the parent must never add it again.
  update public.orchestrator_budget_reservations
     set status = 'released', released_at = now(), updated_at = now()
   where id = v_execution.budget_reservation_id and status = 'reserved';
  if v_execution.owns_materialized_root then
    update public.orchestrator_runs
       set status = case
         when p_outcome = 'applied'
           then 'succeeded'::public.orchestrator_run_status
         when p_error ->> 'kind' = 'execution_canceled'
           then 'canceled'::public.orchestrator_run_status
         else 'failed'::public.orchestrator_run_status
       end,
       completed_at = now(),
       error = case when p_outcome = 'failed'
         then jsonb_build_object(
           'schema_version', 'orchestrator_run_error.v1',
           'kind', coalesce(p_error ->> 'kind', 'rerun_execution_failed'),
           'message', coalesce(p_error ->> 'message', p_error ->> 'reason')
         )
         else null end
     where id = v_execution.root_run_id;
  end if;
  return p_execution_action_id;
end;
$$;

create or replace function public.cancel_rerun_execution(
  p_project_id uuid,
  p_proposal_action_id uuid,
  p_execution_action_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_execution public.rerun_execution_reservations%rowtype;
begin
  select * into v_execution from public.rerun_execution_reservations
   where project_id = p_project_id
     and proposal_action_id = p_proposal_action_id for update;
  if not found then raise exception 'execution reservation not found' using errcode = 'P0002'; end if;
  if v_execution.execution_result_action_id is not null then
    return v_execution.execution_result_action_id;
  end if;
  update public.rerun_execution_work_items
     set status = 'canceled',
         error = jsonb_build_object(
           'schema_version', 'rerun_work_error.v1',
           'kind', 'execution_canceled',
           'reason', p_reason
         )
   where execution_reservation_id = v_execution.id
     and status in ('reserved', 'running', 'blocked');
  update public.rerun_execution_callbacks set status = 'canceled'
   where execution_reservation_id = v_execution.id and status = 'pending';
  update public.rerun_execution_reservations
     set status = 'running', lease_token = gen_random_uuid(),
         lease_generation = lease_generation + 1,
         lease_expires_at = now() + interval '1 minute'
   where id = v_execution.id
   returning * into v_execution;
  return public.finalize_rerun_execution(
    p_project_id, v_execution.id, v_execution.lease_token,
    v_execution.lease_generation, p_execution_action_id, 'failed', null,
    jsonb_build_object(
      'kind', 'execution_canceled',
      'reason', p_reason,
      'recoverable', false
    )
  );
end;
$$;

create or replace function public.recover_rerun_execution(
  p_project_id uuid,
  p_reservation_id uuid,
  p_execution_action_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_execution public.rerun_execution_reservations%rowtype;
  v_root_status public.orchestrator_run_status;
begin
  select * into v_execution from public.rerun_execution_reservations
   where id = p_reservation_id and project_id = p_project_id for update;
  if not found then raise exception 'execution reservation not found' using errcode = 'P0002'; end if;
  if v_execution.execution_result_action_id is not null then
    return v_execution.execution_result_action_id;
  end if;
  select r.status into v_root_status
    from public.orchestrator_runs r where r.id = v_execution.root_run_id;
  if not (
    (
      v_execution.lease_expires_at is not null
      and v_execution.lease_expires_at <= now()
      and not exists (
        select 1 from public.rerun_execution_callbacks callback
         where callback.execution_reservation_id = p_reservation_id
           and callback.status = 'pending'
           and cardinality(callback.job_ids) > 0
           and callback.expires_at > now()
      )
    )
    or exists (
      select 1 from public.rerun_execution_callbacks callback
       where callback.execution_reservation_id = p_reservation_id
         and callback.status = 'pending' and callback.expires_at <= now()
    )
    or v_root_status in ('failed', 'canceled', 'timed_out', 'superseded')
  ) then
    raise exception 'rerun execution is not recoverable yet' using errcode = '55000';
  end if;
  update public.rerun_execution_work_items
     set status = 'canceled',
         error = jsonb_build_object('schema_version', 'rerun_work_error.v1', 'kind', p_reason)
   where execution_reservation_id = p_reservation_id
     and status in ('reserved', 'running', 'blocked');
  update public.rerun_execution_callbacks
     set status = 'canceled'
   where execution_reservation_id = p_reservation_id and status = 'pending';
  -- Recovery never reuses a worker fence. Mint a fresh, short-lived fence
  -- solely for the atomic failure finalizer.
  update public.rerun_execution_reservations
     set lease_token = gen_random_uuid(), lease_generation = lease_generation + 1,
         lease_expires_at = now() + interval '1 minute', status = 'running'
   where id = p_reservation_id
   returning * into v_execution;
  return public.finalize_rerun_execution(
    p_project_id, p_reservation_id, v_execution.lease_token,
    v_execution.lease_generation, p_execution_action_id, 'failed', null,
    jsonb_build_object('kind', p_reason, 'recoverable', true)
  );
end;
$$;

revoke all on function public.approve_rerun_proposal(
  uuid, uuid, uuid, text, double precision, text, boolean
) from public, anon, authenticated;
revoke all on function public.reject_rerun_proposal(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_rerun_proposal_successor(
  uuid, uuid, uuid, text, text, uuid, jsonb, jsonb, uuid[], text,
  public.action_status
) from public, anon, authenticated;
revoke all on function public.reserve_rerun_proposal_execution(
  uuid, uuid, uuid, text, text, double precision, text
) from public, anon, authenticated;
revoke all on function public.claim_rerun_execution_lease(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.renew_rerun_execution_lease(
  uuid, uuid, uuid, integer, integer
) from public, anon, authenticated;
revoke all on function public.reserve_rerun_work_item(
  uuid, uuid, uuid, integer, text, text, uuid, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.reserve_rerun_child_budget(
  uuid, uuid, text, uuid, uuid, uuid, text, double precision
) from public, anon, authenticated;
revoke all on function public.park_rerun_work_item(
  uuid, uuid, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, uuid[], text[]
) from public, anon, authenticated;
revoke all on function public.park_rerun_execution(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.record_rerun_executor_callback(
  uuid, uuid, text, text, text, integer, text, jsonb
) from public, anon, authenticated;
revoke all on function public.complete_rerun_work_item(
  uuid, uuid, uuid, integer, text, uuid, uuid, uuid, jsonb, uuid[], text[]
) from public, anon, authenticated;
revoke all on function public.fail_rerun_work_item(
  uuid, uuid, uuid, integer, text, jsonb
) from public, anon, authenticated;
revoke all on function public.finalize_rerun_execution(
  uuid, uuid, uuid, integer, uuid, text, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.recover_rerun_execution(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.cancel_rerun_execution(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.approve_rerun_proposal(
  uuid, uuid, uuid, text, double precision, text, boolean
) to service_role;
grant execute on function public.reject_rerun_proposal(uuid, uuid) to service_role;
grant execute on function public.create_rerun_proposal_successor(
  uuid, uuid, uuid, text, text, uuid, jsonb, jsonb, uuid[], text,
  public.action_status
) to service_role;
grant execute on function public.reserve_rerun_proposal_execution(
  uuid, uuid, uuid, text, text, double precision, text
) to service_role;
grant execute on function public.claim_rerun_execution_lease(
  uuid, uuid, integer
) to service_role;
grant execute on function public.renew_rerun_execution_lease(
  uuid, uuid, uuid, integer, integer
) to service_role;
grant execute on function public.reserve_rerun_work_item(
  uuid, uuid, uuid, integer, text, text, uuid, jsonb, jsonb
) to service_role;
grant execute on function public.reserve_rerun_child_budget(
  uuid, uuid, text, uuid, uuid, uuid, text, double precision
) to service_role;
grant execute on function public.park_rerun_work_item(
  uuid, uuid, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, uuid[], text[]
) to service_role;
grant execute on function public.park_rerun_execution(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.record_rerun_executor_callback(
  uuid, uuid, text, text, text, integer, text, jsonb
) to service_role;
grant execute on function public.complete_rerun_work_item(
  uuid, uuid, uuid, integer, text, uuid, uuid, uuid, jsonb, uuid[], text[]
) to service_role;
grant execute on function public.fail_rerun_work_item(
  uuid, uuid, uuid, integer, text, jsonb
) to service_role;
grant execute on function public.finalize_rerun_execution(
  uuid, uuid, uuid, integer, uuid, text, uuid, jsonb
) to service_role;
grant execute on function public.recover_rerun_execution(
  uuid, uuid, uuid, text
) to service_role;
grant execute on function public.cancel_rerun_execution(
  uuid, uuid, uuid, text
) to service_role;
