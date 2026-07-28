-- Specialist-agent orchestration PR 16: one root action may atomically fan
-- out to Visuals and Audio. `root_action_id` is the durable join key; it does
-- not introduce a parallel assignment or report persistence model.

create or replace function public.create_domain_run_dispatch_batch(
  p_project_id uuid,
  p_parent_run_id uuid,
  p_root_action_id uuid,
  p_assignments jsonb
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
  v_assignment jsonb;
  v_valid_count integer;
  v_domain_count integer;
begin
  if jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) <> 2 then
    raise exception 'parallel dispatch requires exactly two assignments' using errcode = '22023';
  end if;
  select count(*), count(distinct item ->> 'domain') into v_valid_count, v_domain_count
    from jsonb_array_elements(p_assignments) item
   where item ->> 'domain' in ('visuals', 'audio');
  if v_valid_count <> 2 or v_domain_count <> 2 then
    raise exception 'parallel dispatch requires one visuals and one audio assignment' using errcode = '22023';
  end if;
  -- Lock the root before creating either child. The child creation helper also
  -- validates depth, session serialization, idempotency, and dispatch rows.
  perform 1 from public.orchestrator_runs r
   where r.id = p_parent_run_id and r.project_id = p_project_id for update;
  if not found then
    raise exception 'root run not found for parallel dispatch' using errcode = '22023';
  end if;
  for v_assignment in select value from jsonb_array_elements(p_assignments) loop
    return query select * from public.create_domain_run_dispatch(
      v_assignment ->> 'idempotencyScope',
      v_assignment ->> 'idempotencyKey',
      v_assignment ->> 'requestHash',
      (v_assignment ->> 'runId')::uuid,
      p_project_id,
      (v_assignment ->> 'domain')::public.agent_domain,
      v_assignment ->> 'inputSummary',
      (v_assignment ->> 'budgetUsd')::numeric,
      (v_assignment ->> 'taskKind')::public.domain_task_kind,
      v_assignment -> 'task',
      'creative_director'::public.trusted_origin_kind,
      p_parent_run_id, p_root_action_id, null, null, null, null, null, true,
      16, 4, 500, 2
    );
  end loop;
end;
$$;

-- A report finalizer normally applies its root action immediately. For a
-- `delegate_domains` action, keep it running until every causally linked child
-- is terminal; the last report is the only one that applies the action. The
-- existing finalizer still wakes the root after each report, which is safe: the
-- engine observes the running join and parks again until the final wake.
create or replace function public.keep_parallel_delegation_join_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incomplete boolean;
  v_failed boolean;
  v_children jsonb;
begin
  -- The action row is the join mutex. Make that serialization explicit so two
  -- terminal reports cannot both evaluate a stale sibling snapshot.
  perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
  if new.tool <> 'delegate_domains' then
    return new;
  end if;
  select
    bool_or(child.status not in ('succeeded', 'failed', 'canceled', 'timed_out', 'superseded')),
    bool_or(child.status <> 'succeeded' or coalesce(report.params -> 'outcome' ->> 'outcome', '') <> 'done'),
    jsonb_agg(jsonb_build_object(
      'runId', child.id,
      'status', child.status,
      'reportOutcome', report.params -> 'outcome' ->> 'outcome'
    ) order by child.id)
    into v_incomplete, v_failed, v_children
    from public.orchestrator_runs child
    left join public.actions report
      on report.orchestrator_run_id = child.id and report.tool = 'domain_report'
   where child.project_id = new.project_id and child.root_action_id = new.id;

  if new.status in ('applied', 'failed') and coalesce(v_incomplete, true) then
    new.status := 'running';
    new.error := null;
    new.output_asset_ids := '{}';
  elsif new.status in ('applied', 'failed') and coalesce(v_failed, true) then
    new.status := 'failed';
    new.error := jsonb_build_object(
      'schema', 'ToolError.v1',
      'kind', 'precondition_unmet',
      'message', 'One or more parallel domain assignments did not complete successfully.',
      'recoverable', true,
      'children', coalesce(v_children, '[]'::jsonb)
    );
  elsif new.status = 'applied' then
    select coalesce(array_agg(distinct output_id), '{}') into new.output_asset_ids
      from public.orchestrator_runs child
      join public.actions report
        on report.orchestrator_run_id = child.id and report.tool = 'domain_report'
      cross join lateral unnest(report.output_asset_ids) output_id
     where child.project_id = new.project_id and child.root_action_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists actions_keep_parallel_delegation_join_open on public.actions;
create trigger actions_keep_parallel_delegation_join_open
before update of status, error, output_asset_ids on public.actions
for each row execute function public.keep_parallel_delegation_join_open();

revoke all on function public.create_domain_run_dispatch_batch(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_domain_run_dispatch_batch(uuid, uuid, uuid, jsonb) to service_role;
