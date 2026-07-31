-- Least-privilege surface for PR 5 atomic selection/story-pointer application.

grant select (role, ordinal)
  on table public.action_assets to popcorn_api;

grant select (
  project_id, slot_owner_lineage_id, slot_role, seq, active_asset_id
) on table public.selections to popcorn_api;
grant insert (
  project_id, slot_owner_lineage_id, slot_role, seq, active_asset_id,
  set_by_action_id
) on table public.selections to popcorn_api;

drop policy if exists selections_popcorn_api_rerun_select
  on public.selections;
create policy selections_popcorn_api_rerun_select
  on public.selections for select to popcorn_api using (true);
drop policy if exists selections_popcorn_api_rerun_insert
  on public.selections;
create policy selections_popcorn_api_rerun_insert
  on public.selections for insert to popcorn_api with check (
    exists (
      select 1 from public.actions
       where actions.id = selections.set_by_action_id
         and actions.project_id = selections.project_id
         and actions.tool = 'rerun_execution'
         and actions.status = 'running'
    )
  );

grant select (id, project_id, asset_id, provenance)
  on table public.story_blueprints to popcorn_api;
grant select (id, project_id, scene_asset_id)
  on table public.story_blueprint_scenes to popcorn_api;
grant select (id, project_id, beat_asset_id)
  on table public.story_beats to popcorn_api;
revoke update on table public.story_blueprints from popcorn_api;
revoke update on table public.story_blueprint_scenes from popcorn_api;
revoke update on table public.story_beats from popcorn_api;

drop policy if exists story_blueprints_popcorn_api_rerun_select
  on public.story_blueprints;
create policy story_blueprints_popcorn_api_rerun_select
  on public.story_blueprints for select to popcorn_api using (true);
drop policy if exists story_scenes_popcorn_api_rerun_select
  on public.story_blueprint_scenes;
create policy story_scenes_popcorn_api_rerun_select
  on public.story_blueprint_scenes for select to popcorn_api using (true);
drop policy if exists story_beats_popcorn_api_rerun_select
  on public.story_beats;
create policy story_beats_popcorn_api_rerun_select
  on public.story_beats for select to popcorn_api using (true);
drop policy if exists story_blueprints_popcorn_api_rerun_update
  on public.story_blueprints;
drop policy if exists story_scenes_popcorn_api_rerun_update
  on public.story_blueprint_scenes;
drop policy if exists story_beats_popcorn_api_rerun_update
  on public.story_beats;

create or replace function public.apply_rerun_story_pointer(
  p_project_id uuid,
  p_execution_reservation_id uuid,
  p_execution_action_id uuid,
  p_row_kind text,
  p_row_id uuid,
  p_expected_asset_id uuid,
  p_new_asset_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_execution public.rerun_execution_reservations%rowtype;
  v_action public.actions%rowtype;
  v_proposal jsonb;
  v_move jsonb;
  v_binding jsonb;
  v_result jsonb;
  v_destination public.assets%rowtype;
  v_semantic jsonb;
  v_current uuid;
begin
  if p_row_kind not in ('story_blueprint', 'story_beat')
     or p_new_asset_id is null then
    raise exception 'invalid rerun story pointer request' using errcode = '22023';
  end if;

  select * into v_execution
    from public.rerun_execution_reservations
   where id = p_execution_reservation_id
     and project_id = p_project_id
   for update;
  if not found
     or v_execution.status <> 'running'
     or v_execution.execution_result_action_id is not null
     or v_execution.lease_token is null
     or v_execution.lease_expires_at <= now() then
    raise exception 'rerun execution is not live' using errcode = '55000';
  end if;

  select * into v_action
    from public.actions
   where id = p_execution_action_id
     and project_id = p_project_id
     and orchestrator_run_id = v_execution.root_run_id
     and tool = 'rerun_execution'
     and status = 'running';
  if not found
     or v_action.params->>'executionReservationId'
        is distinct from p_execution_reservation_id::text
     or v_action.params->>'proposalActionId'
        is distinct from v_execution.proposal_action_id::text then
    raise exception 'rerun execution action does not own reservation'
      using errcode = '42501';
  end if;

  select proposal into v_proposal
    from public.actions
   where id = v_execution.proposal_action_id
     and project_id = p_project_id
     and tool = 'rerun_proposal';
  if v_proposal is null then
    raise exception 'rerun proposal is missing' using errcode = 'P0002';
  end if;

  select move into v_move
    from jsonb_array_elements(
      coalesce(v_proposal->'plannedStoryPointerMoves', '[]'::jsonb)
    ) move
   where move->>'rowKind' = p_row_kind
     and move->>'rowId' = p_row_id::text
     and nullif(move->>'expectedSnapshotAssetId', '')::uuid
         is not distinct from p_expected_asset_id;
  if v_move is null then
    raise exception 'story pointer move was not approved' using errcode = '42501';
  end if;

  select output into v_binding
    from jsonb_array_elements(coalesce(v_proposal->'selectedWork', '[]'::jsonb)) work
    cross join lateral jsonb_array_elements(
      coalesce(work->'requiredOutputs', '[]'::jsonb)
    ) output
   where output->>'bindingId' = v_move->>'bindingId';
  if v_binding is null then
    raise exception 'story pointer binding is missing' using errcode = 'P0002';
  end if;

  select binding into v_result
    from public.rerun_execution_work_items work
    cross join lateral jsonb_array_elements(
      coalesce(work.binding_results, '[]'::jsonb)
    ) binding
   where work.execution_reservation_id = p_execution_reservation_id
     and work.status = 'completed'
     and work.work_item_id = v_binding->>'workItemId'
     and binding->>'bindingId' = v_binding->>'bindingId'
     and binding->>'assetId' = p_new_asset_id::text
     and binding->>'intrinsicRole' = v_binding->>'role';
  if v_result is null then
    raise exception 'story pointer destination lacks a completed exact binding'
      using errcode = '42501';
  end if;

  select * into v_destination
    from public.assets
   where id = p_new_asset_id
     and project_id = p_project_id;
  if not found
     or v_destination.role is distinct from v_binding->>'role'
     or v_destination.kind not in ('story_blueprint', 'plan', 'beat')
     or v_destination.content is null then
    raise exception 'story pointer destination is invalid' using errcode = '42501';
  end if;

  if p_row_kind = 'story_blueprint' then
    select asset_id into v_current
      from public.story_blueprints
     where project_id = p_project_id and id = p_row_id
     for update;
    if not found or v_current is distinct from p_expected_asset_id then
      raise exception 'stale_proposal: story_blueprint pointer changed' using errcode = '40001';
    end if;
    update public.story_blueprints
       set asset_id = p_new_asset_id,
           snapshot = v_destination.content
     where project_id = p_project_id and id = p_row_id;
  else
    select beat_asset_id into v_current
      from public.story_beats
     where project_id = p_project_id and id = p_row_id
     for update;
    if not found or v_current is distinct from p_expected_asset_id then
      raise exception 'stale_proposal: story_beat pointer changed' using errcode = '40001';
    end if;
    v_semantic := v_destination.content;
    if v_semantic->>'id' is distinct from p_row_id::text then
      raise exception 'story beat snapshot omitted its stable row identity'
        using errcode = '22023';
    end if;
    update public.story_beats
       set beat_asset_id = p_new_asset_id,
           intent = coalesce(v_semantic->>'intent', intent),
           visual_description = case
             when v_semantic ? 'visualDescription'
               then nullif(v_semantic->>'visualDescription', '')
             else visual_description
           end,
           dialogue_summary = case
             when v_semantic ? 'dialogueSummary'
               then nullif(v_semantic->>'dialogueSummary', '')
             else dialogue_summary
           end,
           narration = case
             when v_semantic ? 'narration'
               then nullif(v_semantic->>'narration', '')
             else narration
           end,
           duration_sec = coalesce(
             (v_semantic->>'durationSec')::double precision,
             duration_sec
           ),
           shot_type = case
             when v_semantic ? 'shotType' then nullif(v_semantic->>'shotType', '')
             else shot_type
           end,
           camera = case
             when v_semantic ? 'camera' then nullif(v_semantic->>'camera', '')
             else camera
           end,
           framing = case
             when v_semantic ? 'framing' then nullif(v_semantic->>'framing', '')
             else framing
           end
     where project_id = p_project_id and id = p_row_id;
  end if;
end;
$$;

revoke all on function public.apply_rerun_story_pointer(
  uuid, uuid, uuid, text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.apply_rerun_story_pointer(
  uuid, uuid, uuid, text, uuid, uuid, uuid
) to popcorn_api;

comment on function public.apply_rerun_story_pointer(
  uuid, uuid, uuid, text, uuid, uuid, uuid
) is
  'Applies one approved story pointer CAS only for a live rerun execution and its completed exact binding.';
