-- Least-privilege direct-Postgres access for the durable rerun lifecycle.
-- Application orchestration lives in typed TypeScript transactions; Postgres
-- retains RLS, lifecycle triggers, constraints, and the pin-freshness lock.

revoke all on table public.actions from popcorn_api;
revoke all on table public.action_assets from popcorn_api;
revoke all on table public.rerun_execution_reservations from popcorn_api;
revoke all on table public.rerun_execution_work_items from popcorn_api;
revoke all on table public.rerun_execution_callbacks from popcorn_api;
revoke all on table public.rerun_proposal_successors from popcorn_api;
revoke all on table public.orchestrator_budget_reservations from popcorn_api;
revoke all on table public.assets from popcorn_api;

grant select (
  id, project_id, orchestrator_run_id, tool, status, params, proposal,
  input_asset_ids, rationale, output_asset_ids, error
) on table public.actions to popcorn_api;
grant insert (
  id, schema_version, project_id, orchestrator_run_id, tool, status, params,
  input_asset_ids, rationale, proposal, job_ids, output_asset_ids, error
) on table public.actions to popcorn_api;
grant update (status, error, output_asset_ids)
  on table public.actions to popcorn_api;
grant select (project_id, action_id, asset_id, direction)
  on table public.action_assets to popcorn_api;
grant insert (project_id, action_id, asset_id, direction, role, ordinal)
  on table public.action_assets to popcorn_api;

grant select (
  id, proposal_action_id, project_id, root_run_id, approval_action_id,
  budget_reservation_id, owns_materialized_root, idempotency_key,
  request_fingerprint, approved_max_cost_usd, status, lease_token,
  lease_generation, lease_expires_at, execution_result_action_id
) on table public.rerun_execution_reservations to popcorn_api;
grant insert (
  proposal_action_id, project_id, root_run_id, approval_action_id,
  budget_reservation_id, owns_materialized_root, idempotency_key,
  request_fingerprint, approved_max_cost_usd
) on table public.rerun_execution_reservations to popcorn_api;
grant update (
  status, lease_token, lease_generation, lease_expires_at,
  execution_result_action_id, updated_at
) on table public.rerun_execution_reservations to popcorn_api;

grant select (
  id, execution_reservation_id, project_id, work_item_id,
  request_fingerprint, dispatch_action_id, child_run_id, report_action_id,
  reconciliation_action_id, status, lease_generation, output_asset_ids,
  binding_results, accepted_callbacks, blocked_precondition,
  primitive_action_ids, budget_reservation_keys, error
) on table public.rerun_execution_work_items to popcorn_api;
grant insert (
  execution_reservation_id, project_id, work_item_id, request_fingerprint,
  dispatch_action_id, lease_generation, status
) on table public.rerun_execution_work_items to popcorn_api;
grant update (
  child_run_id, report_action_id, reconciliation_action_id, status,
  output_asset_ids, binding_results, accepted_callbacks,
  blocked_precondition, primitive_action_ids, budget_reservation_keys, error,
  updated_at
) on table public.rerun_execution_work_items to popcorn_api;

grant select (
  id, execution_reservation_id, work_reservation_id, project_id, executor_id,
  binding_subset, callback_token_hash, callback_generation, job_ids, status,
  callback_result, child_run_id, report_action_id, reconciliation_action_id,
  primitive_action_ids, budget_reservation_keys, binding_results, expires_at
) on table public.rerun_execution_callbacks to popcorn_api;
grant insert (
  execution_reservation_id, work_reservation_id, project_id, executor_id,
  binding_subset, callback_token_hash, callback_generation
) on table public.rerun_execution_callbacks to popcorn_api;
grant update (
  job_ids, status, callback_result, child_run_id, report_action_id,
  reconciliation_action_id, primitive_action_ids, budget_reservation_keys,
  binding_results, completed_at
) on table public.rerun_execution_callbacks to popcorn_api;

grant select (
  prior_proposal_action_id, successor_proposal_action_id, project_id,
  request_fingerprint, cause
) on table public.rerun_proposal_successors to popcorn_api;
grant insert (
  prior_proposal_action_id, successor_proposal_action_id, project_id,
  request_fingerprint, cause
) on table public.rerun_proposal_successors to popcorn_api;

grant select (
  id, project_id, orchestrator_run_id, root_run_id, action_id, job_id,
  reservation_key, reservation_scope, estimated_usd, actual_usd, status,
  proposal_action_id, parent_reservation_id
) on table public.orchestrator_budget_reservations to popcorn_api;
grant insert (
  project_id, orchestrator_run_id, root_run_id, action_id, job_id,
  reservation_key, reservation_scope, estimated_usd, proposal_action_id,
  parent_reservation_id
) on table public.orchestrator_budget_reservations to popcorn_api;
grant update (status, released_at, updated_at)
  on table public.orchestrator_budget_reservations to popcorn_api;
grant select (id, project_id, kind, role)
  on table public.assets to popcorn_api;

grant select (
  id, project_id, parent_run_id, root_action_id, task_params, status,
  agent_role, root_execution_profile, budget_usd, spent_usd, origin_kind
) on table public.orchestrator_runs to popcorn_api;
grant insert (
  schema_version, project_id, status, input_summary, budget_usd, spent_usd,
  agent_role, root_execution_profile
) on table public.orchestrator_runs to popcorn_api;
grant update (
  status, started_at, completed_at, error, updated_at
) on table public.orchestrator_runs to popcorn_api;

drop policy if exists actions_popcorn_api_rerun_select on public.actions;
create policy actions_popcorn_api_rerun_select
  on public.actions for select to popcorn_api
  using (tool in (
    'rerun_proposal', 'rerun_proposal_approval', 'rerun_work_item_dispatch',
    'rerun_reconciliation', 'rerun_execution', 'domain_report'
  ));
drop policy if exists actions_popcorn_api_rerun_insert on public.actions;
create policy actions_popcorn_api_rerun_insert
  on public.actions for insert to popcorn_api
  with check (tool in (
    'rerun_proposal', 'rerun_proposal_approval', 'rerun_work_item_dispatch',
    'rerun_reconciliation', 'rerun_execution'
  ));
drop policy if exists actions_popcorn_api_rerun_update on public.actions;
create policy actions_popcorn_api_rerun_update
  on public.actions for update to popcorn_api
  using (tool in (
    'rerun_proposal', 'rerun_work_item_dispatch', 'rerun_execution'
  ))
  with check (tool in (
    'rerun_proposal', 'rerun_work_item_dispatch', 'rerun_execution'
  ));

drop policy if exists action_assets_popcorn_api_rerun_select on public.action_assets;
create policy action_assets_popcorn_api_rerun_select
  on public.action_assets for select to popcorn_api using (true);
drop policy if exists action_assets_popcorn_api_rerun_insert on public.action_assets;
create policy action_assets_popcorn_api_rerun_insert
  on public.action_assets for insert to popcorn_api with check (
    exists (
      select 1 from public.actions
       where actions.id = action_assets.action_id
         and actions.project_id = action_assets.project_id
         and actions.tool in ('rerun_work_item_dispatch', 'rerun_execution')
    )
  );

drop policy if exists assets_popcorn_api_rerun_select on public.assets;
create policy assets_popcorn_api_rerun_select
  on public.assets for select to popcorn_api using (true);

drop policy if exists rerun_reservations_popcorn_api_all
  on public.rerun_execution_reservations;
create policy rerun_reservations_popcorn_api_all
  on public.rerun_execution_reservations for all to popcorn_api
  using (true) with check (true);
drop policy if exists rerun_work_popcorn_api_all
  on public.rerun_execution_work_items;
create policy rerun_work_popcorn_api_all
  on public.rerun_execution_work_items for all to popcorn_api
  using (true) with check (true);
drop policy if exists rerun_callbacks_popcorn_api_all
  on public.rerun_execution_callbacks;
create policy rerun_callbacks_popcorn_api_all
  on public.rerun_execution_callbacks for all to popcorn_api
  using (true) with check (true);
drop policy if exists rerun_successors_popcorn_api_all
  on public.rerun_proposal_successors;
create policy rerun_successors_popcorn_api_all
  on public.rerun_proposal_successors for all to popcorn_api
  using (true) with check (true);

drop policy if exists rerun_budget_popcorn_api_all
  on public.orchestrator_budget_reservations;
create policy rerun_budget_popcorn_api_all
  on public.orchestrator_budget_reservations for all to popcorn_api
  using (
    reservation_scope in ('proposal_ceiling', 'operation')
    and (
      proposal_action_id is not null
      or parent_reservation_id is not null
    )
  )
  with check (
    reservation_scope in ('proposal_ceiling', 'operation')
    and (
      proposal_action_id is not null
      or parent_reservation_id is not null
    )
  );

drop policy if exists orchestrator_runs_popcorn_api_rerun_select
  on public.orchestrator_runs;
create policy orchestrator_runs_popcorn_api_rerun_select
  on public.orchestrator_runs for select to popcorn_api
  using (
    agent_role = 'creative_director'
    and root_execution_profile = 'creative_director'
  );
drop policy if exists orchestrator_runs_popcorn_api_rerun_insert
  on public.orchestrator_runs;
create policy orchestrator_runs_popcorn_api_rerun_insert
  on public.orchestrator_runs for insert to popcorn_api
  with check (
    agent_role = 'creative_director'
    and root_execution_profile = 'creative_director'
  );
drop policy if exists orchestrator_runs_popcorn_api_rerun_update
  on public.orchestrator_runs;
create policy orchestrator_runs_popcorn_api_rerun_update
  on public.orchestrator_runs for update to popcorn_api
  using (
    agent_role = 'creative_director'
    and root_execution_profile = 'creative_director'
  )
  with check (
    agent_role = 'creative_director'
    and root_execution_profile = 'creative_director'
  );

revoke all on function public.approve_rerun_proposal(
  uuid, uuid, uuid, text, double precision, text, boolean
) from popcorn_api;
revoke all on function public.reject_rerun_proposal(uuid, uuid)
  from popcorn_api;
revoke all on function public.create_rerun_proposal_successor(
  uuid, uuid, uuid, text, text, uuid, jsonb, jsonb, uuid[], text,
  public.action_status
) from popcorn_api;
revoke all on function public.reserve_rerun_proposal_execution(
  uuid, uuid, uuid, text, text, double precision, text
) from popcorn_api;
revoke all on function public.claim_rerun_execution_lease(uuid, uuid, integer)
  from popcorn_api;
revoke all on function public.renew_rerun_execution_lease(
  uuid, uuid, uuid, integer, integer
) from popcorn_api;
revoke all on function public.reserve_rerun_work_item(
  uuid, uuid, uuid, integer, text, text, uuid, jsonb, jsonb
) from popcorn_api;
revoke all on function public.park_rerun_work_item(
  uuid, uuid, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, uuid[], text[]
) from popcorn_api;
revoke all on function public.record_rerun_executor_callback(
  uuid, uuid, text, text, text, integer, text, jsonb
) from popcorn_api;
revoke all on function public.park_rerun_execution(uuid, uuid, uuid, integer)
  from popcorn_api;
revoke all on function public.complete_rerun_work_item(
  uuid, uuid, uuid, integer, text, uuid, uuid, uuid, jsonb, uuid[], text[]
) from popcorn_api;
revoke all on function public.fail_rerun_work_item(
  uuid, uuid, uuid, integer, text, jsonb
) from popcorn_api;
revoke all on function public.finalize_rerun_execution(
  uuid, uuid, uuid, integer, uuid, text, uuid, jsonb
) from popcorn_api;
revoke all on function public.cancel_rerun_execution(uuid, uuid, uuid, text)
  from popcorn_api;
revoke all on function public.reserve_rerun_child_budget(
  uuid, uuid, text, uuid, uuid, uuid, text, double precision
) from popcorn_api;
revoke all on function public.recover_rerun_execution(uuid, uuid, uuid, text)
  from popcorn_api;

grant execute on function public.assert_rerun_proposal_pins_fresh(uuid, uuid)
  to popcorn_api;
