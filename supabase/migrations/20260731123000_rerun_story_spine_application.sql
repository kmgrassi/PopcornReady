-- Apply targeted and whole-storyboard reruns to the relational story spine.

alter table public.story_blueprint_scenes
  add column story_snapshot_asset_id uuid;
alter table public.story_beats add column stable_id text;
create or replace function public.story_beats_fill_stable_id()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  new.stable_id := coalesce(nullif(new.stable_id,''),new.id::text);
  return new;
end;
$$;
create trigger story_beats_fill_stable_id
  before insert on public.story_beats
  for each row execute function public.story_beats_fill_stable_id();
update public.story_beats beat
   set stable_id = coalesce((
     select plan_beat.value->>'id'
       from public.story_blueprint_scenes scene
       join public.story_blueprints blueprint on blueprint.id=scene.story_blueprint_id
       join public.assets plan_asset
         on plan_asset.id=nullif(blueprint.provenance->>'planAssetId','')::uuid
        and plan_asset.project_id=beat.project_id
       cross join lateral jsonb_array_elements(
         coalesce(plan_asset.content->'scenes','[]'::jsonb)
       ) plan_scene(value)
       cross join lateral jsonb_array_elements(
         coalesce(plan_scene.value->'beats','[]'::jsonb)
       ) with ordinality plan_beat(value,ordinality)
      where scene.id=beat.scene_id
        and plan_scene.value->>'id'=scene.stable_id
        and plan_beat.ordinality-1=beat.beat_index
      limit 1
   ),beat.id::text);
alter table public.story_beats alter column stable_id set not null;
create unique index story_beats_stable_id_idx
  on public.story_beats(scene_id,stable_id);
create or replace function public.story_spine_stable_id_is_immutable()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.stable_id is distinct from old.stable_id then
    raise exception 'story spine stable identity is immutable'
      using errcode='check_violation';
  end if;
  return new;
end;
$$;
create trigger story_scenes_keep_stable_id
  before update of stable_id on public.story_blueprint_scenes
  for each row execute function public.story_spine_stable_id_is_immutable();
create trigger story_beats_keep_stable_id
  before update of stable_id on public.story_beats
  for each row execute function public.story_spine_stable_id_is_immutable();
alter table public.story_blueprint_scenes
  add constraint story_blueprint_scenes_story_snapshot_asset_fk
  foreign key (project_id, story_snapshot_asset_id)
  references public.assets(project_id, id) on delete set null;
create index story_blueprint_scenes_story_snapshot_asset_idx
  on public.story_blueprint_scenes(story_snapshot_asset_id);
grant select (story_snapshot_asset_id, stable_id)
  on table public.story_blueprint_scenes to popcorn_api;
grant select (stable_id) on table public.story_beats to popcorn_api;
update public.story_blueprint_scenes scene
   set story_snapshot_asset_id = nullif(blueprint.provenance->>'planAssetId','')::uuid
  from public.story_blueprints blueprint
 where blueprint.id = scene.story_blueprint_id
   and blueprint.project_id = scene.project_id
   and nullif(blueprint.provenance->>'planAssetId','') is not null;

-- The lifecycle freshness function predates the separate semantic scene
-- pointer. Preserve its audited body while moving only that pointer lookup.
do $$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_get_functiondef(
    'public.assert_rerun_proposal_pins_fresh(uuid,uuid)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    'select scene_asset_id into v_snapshot',
    'select story_snapshot_asset_id into v_snapshot'
  );
  if v_rewritten = v_definition then
    raise exception 'could not update story-scene freshness pointer';
  end if;
  execute v_rewritten;
end;
$$;

alter function public.apply_rerun_story_pointer(
  uuid, uuid, uuid, text, uuid, uuid, uuid
) rename to apply_rerun_story_pointer_legacy;

revoke all on function public.apply_rerun_story_pointer_legacy(
  uuid, uuid, uuid, text, uuid, uuid, uuid
) from public, anon, authenticated, popcorn_api;

create or replace function public.apply_rerun_story_plan_pointer(
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
  v_proposal jsonb;
  v_move jsonb;
  v_binding jsonb;
  v_destination public.assets%rowtype;
  v_plan jsonb;
  v_scene jsonb;
  v_beat jsonb;
  v_blueprint public.story_blueprints%rowtype;
  v_act_id uuid;
  v_scene_id uuid;
  v_beat_id uuid;
  v_scene_act_id uuid;
  v_current uuid;
  v_target_blueprint_id uuid;
  v_scene_key text;
  v_beat_key text;
  v_scene_ids uuid[] := '{}'::uuid[];
  v_beat_ids uuid[] := '{}'::uuid[];
  v_scene_keys text[] := '{}'::text[];
  v_beat_keys text[] := '{}'::text[];
  v_scene_position integer;
  v_beat_position integer;
begin
  if p_row_kind not in ('storyboard', 'story_scene') then
    raise exception 'invalid rerun story plan pointer request' using errcode = '22023';
  end if;

  select * into v_execution
    from public.rerun_execution_reservations
   where id = p_execution_reservation_id and project_id = p_project_id
   for update;
  if not found or v_execution.status <> 'running'
     or v_execution.execution_result_action_id is not null
     or v_execution.lease_token is null or v_execution.lease_expires_at <= now() then
    raise exception 'rerun execution is not live' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.actions action
     where action.id = p_execution_action_id
       and action.project_id = p_project_id
       and action.orchestrator_run_id = v_execution.root_run_id
       and action.tool = 'rerun_execution' and action.status = 'running'
       and action.params->>'executionReservationId' = p_execution_reservation_id::text
       and action.params->>'proposalActionId' = v_execution.proposal_action_id::text
  ) then
    raise exception 'rerun execution action does not own reservation' using errcode = '42501';
  end if;

  select proposal into v_proposal from public.actions
   where id = v_execution.proposal_action_id and project_id = p_project_id
     and tool = 'rerun_proposal';
  select move into v_move
    from jsonb_array_elements(coalesce(v_proposal->'plannedStoryPointerMoves','[]'::jsonb)) move
   where move->>'rowKind' = p_row_kind and move->>'rowId' = p_row_id::text
     and nullif(move->>'expectedSnapshotAssetId','')::uuid
         is not distinct from p_expected_asset_id;
  if v_move is null then
    raise exception 'story pointer move was not approved' using errcode = '42501';
  end if;
  select output into v_binding
    from jsonb_array_elements(coalesce(v_proposal->'selectedWork','[]'::jsonb)) work
    cross join lateral jsonb_array_elements(coalesce(work->'requiredOutputs','[]'::jsonb)) output
   where output->>'bindingId' = v_move->>'bindingId';
  if v_binding is null or not exists (
    select 1 from public.rerun_execution_work_items work
    cross join lateral jsonb_array_elements(coalesce(work.binding_results,'[]'::jsonb)) result
     where work.execution_reservation_id = p_execution_reservation_id
       and work.status = 'completed' and work.work_item_id = v_binding->>'workItemId'
       and result->>'bindingId' = v_binding->>'bindingId'
       and result->>'assetId' = p_new_asset_id::text
       and result->>'intrinsicRole' = v_binding->>'role'
  ) then
    raise exception 'story pointer destination lacks a completed exact binding' using errcode = '42501';
  end if;
  select * into v_destination from public.assets
   where id = p_new_asset_id and project_id = p_project_id
     and kind = 'plan' and role = v_binding->>'role' and content is not null;
  if not found then
    raise exception 'story pointer destination is invalid' using errcode = '42501';
  end if;
  v_plan := v_destination.content;
  if jsonb_typeof(v_plan->'scenes') is distinct from 'array' then
    raise exception 'storyboard snapshot has no scene array' using errcode = '22023';
  end if;

  if p_row_kind = 'story_scene' then
    select story_snapshot_asset_id,stable_id,story_blueprint_id
      into strict v_current,v_scene_key,v_target_blueprint_id
      from public.story_blueprint_scenes
     where project_id = p_project_id and id = p_row_id for update;
    if v_current is distinct from p_expected_asset_id then
      raise exception 'stale_proposal: story_scene pointer changed' using errcode = '40001';
    end if;
    select scene into v_scene from jsonb_array_elements(v_plan->'scenes') scene
     where scene->>'id' = v_scene_key;
    if v_scene is null then
      raise exception 'story scene snapshot omitted its stable row identity' using errcode = '22023';
    end if;
    update public.story_beats set beat_index=beat_index+100000
     where scene_id=p_row_id;
    update public.story_blueprint_scenes
       set story_snapshot_asset_id = p_new_asset_id,
           title = coalesce(nullif(v_scene->>'name',''), title),
           setting = case when v_scene ? 'setting' then nullif(v_scene->>'setting','') else setting end,
           mood = case when v_scene ? 'mood' then nullif(v_scene->>'mood','') else mood end,
           target_duration_sec = coalesce((
             select sum(coalesce((beat->>'durationSec')::double precision,0))
               from jsonb_array_elements(coalesce(v_scene->'beats','[]'::jsonb)) beat
           ), target_duration_sec)
     where project_id = p_project_id and id = p_row_id;
    v_beat_position := 0;
    for v_beat in select value from jsonb_array_elements(coalesce(v_scene->'beats','[]'::jsonb)) loop
      v_beat_key := nullif(v_beat->>'id','');
      if v_beat_key is null or v_beat_key = any(v_beat_keys) then
        raise exception 'story scene snapshot contains missing or duplicate beat ids'
          using errcode='22023';
      end if;
      v_beat_keys := array_append(v_beat_keys,v_beat_key);
      select id into v_beat_id from public.story_beats
       where scene_id=p_row_id and stable_id=v_beat_key for update;
      v_beat_id := coalesce(v_beat_id,gen_random_uuid());
      v_beat_ids := array_append(v_beat_ids,v_beat_id);
      insert into public.story_beats(
        id,project_id,scene_id,stable_id,beat_index,intent,duration_sec,
        shot_type,camera,framing,beat_asset_id
      ) values (
        v_beat_id,p_project_id,p_row_id,v_beat_key,v_beat_position,
        coalesce(v_beat->>'intent',''),(v_beat->>'durationSec')::double precision,
        nullif(v_beat->>'shotType',''),nullif(v_beat->>'camera',''),
        nullif(v_beat->>'framing',''),p_new_asset_id
      ) on conflict (id) do update set
        stable_id=excluded.stable_id,beat_index=excluded.beat_index,
        intent=excluded.intent,duration_sec=excluded.duration_sec,
        shot_type=excluded.shot_type,camera=excluded.camera,
        framing=excluded.framing,beat_asset_id=excluded.beat_asset_id
        where story_beats.project_id=p_project_id and story_beats.scene_id=p_row_id;
      v_beat_position := v_beat_position+1;
    end loop;
    delete from public.story_beats
     where scene_id=p_row_id and not(id=any(v_beat_ids));
    return;
  end if;

  select * into v_blueprint from public.story_blueprints
   where project_id = p_project_id and id = p_row_id for update;
  if not found or nullif(v_blueprint.provenance->>'planAssetId','')::uuid
      is distinct from p_expected_asset_id then
    raise exception 'stale_proposal: storyboard pointer changed' using errcode = '40001';
  end if;
  select id into v_act_id from public.story_blueprint_acts
   where story_blueprint_id = p_row_id order by position, id limit 1;
  if v_act_id is null then
    insert into public.story_blueprint_acts(
      story_blueprint_id,workspace_id,project_id,stable_id,position,title,purpose,
      summary,target_duration_sec
    ) values (p_row_id,v_blueprint.workspace_id,p_project_id,'act-1',0,'Story','Story','Story',0)
    returning id into v_act_id;
  end if;

  update public.story_blueprint_scenes set position = position + 100000
   where story_blueprint_id = p_row_id;
  update public.story_beats set beat_index = beat_index + 100000
   where scene_id in (select id from public.story_blueprint_scenes where story_blueprint_id=p_row_id);
  v_scene_position := 0;
  for v_scene in select value from jsonb_array_elements(v_plan->'scenes') loop
    v_scene_key := nullif(v_scene->>'id','');
    if v_scene_key is null or v_scene_key = any(v_scene_keys) then
      raise exception 'storyboard snapshot contains duplicate scene ids' using errcode = '22023';
    end if;
    v_scene_keys := array_append(v_scene_keys,v_scene_key);
    select id,story_blueprint_act_id into v_scene_id,v_scene_act_id
      from public.story_blueprint_scenes
     where story_blueprint_id=p_row_id and stable_id=v_scene_key for update;
    v_scene_id := coalesce(v_scene_id,gen_random_uuid());
    v_scene_ids := array_append(v_scene_ids,v_scene_id);
    insert into public.story_blueprint_scenes(
      id,story_blueprint_id,story_blueprint_act_id,workspace_id,project_id,
      stable_id,position,title,summary,target_duration_sec,setting,mood,story_snapshot_asset_id
    ) values (
      v_scene_id,p_row_id,coalesce(v_scene_act_id,v_act_id),v_blueprint.workspace_id,p_project_id,
      v_scene_key,v_scene_position,coalesce(nullif(v_scene->>'name',''),'Scene'),
      coalesce(nullif(v_scene->>'name',''),'Scene'),coalesce((
        select sum(coalesce((beat->>'durationSec')::double precision,0))
          from jsonb_array_elements(coalesce(v_scene->'beats','[]'::jsonb)) beat
      ),0),nullif(v_scene->>'setting',''),nullif(v_scene->>'mood',''),p_new_asset_id
    ) on conflict (id) do update set
      story_blueprint_act_id=excluded.story_blueprint_act_id, position=excluded.position,
      title=excluded.title, target_duration_sec=excluded.target_duration_sec,
      setting=excluded.setting, mood=excluded.mood,
      story_snapshot_asset_id=excluded.story_snapshot_asset_id
      where story_blueprint_scenes.project_id=p_project_id
        and story_blueprint_scenes.story_blueprint_id=p_row_id;
    v_beat_position := 0;
    for v_beat in select value from jsonb_array_elements(coalesce(v_scene->'beats','[]'::jsonb)) loop
      v_beat_key := nullif(v_beat->>'id','');
      if v_beat_key is null or v_beat_key = any(v_beat_keys) then
        raise exception 'storyboard snapshot contains duplicate beat ids' using errcode = '22023';
      end if;
      v_beat_keys := array_append(v_beat_keys,v_beat_key);
      select beat.id into v_beat_id
        from public.story_beats beat
        join public.story_blueprint_scenes scene on scene.id=beat.scene_id
       where scene.story_blueprint_id=p_row_id and beat.stable_id=v_beat_key
       for update of beat;
      v_beat_id := coalesce(v_beat_id,gen_random_uuid());
      v_beat_ids := array_append(v_beat_ids,v_beat_id);
      insert into public.story_beats(
        id,project_id,scene_id,stable_id,beat_index,intent,duration_sec,shot_type,camera,
        framing,beat_asset_id
      ) values (
        v_beat_id,p_project_id,v_scene_id,v_beat_key,v_beat_position,
        coalesce(v_beat->>'intent',''),(v_beat->>'durationSec')::double precision,
        nullif(v_beat->>'shotType',''),nullif(v_beat->>'camera',''),
        nullif(v_beat->>'framing',''),p_new_asset_id
      ) on conflict (id) do update set
        scene_id=excluded.scene_id,stable_id=excluded.stable_id,
        beat_index=excluded.beat_index,intent=excluded.intent,
        duration_sec=excluded.duration_sec,shot_type=excluded.shot_type,
        camera=excluded.camera,framing=excluded.framing,beat_asset_id=excluded.beat_asset_id
        where story_beats.project_id=p_project_id;
      v_beat_position := v_beat_position + 1;
    end loop;
    v_scene_position := v_scene_position + 1;
  end loop;
  delete from public.story_beats where scene_id in (
    select id from public.story_blueprint_scenes where story_blueprint_id=p_row_id
  ) and not (id = any(v_beat_ids));
  delete from public.story_blueprint_scenes
   where story_blueprint_id=p_row_id and not (id = any(v_scene_ids));
  update public.story_blueprints
     set provenance=jsonb_set(coalesce(provenance,'{}'::jsonb),'{planAssetId}',to_jsonb(p_new_asset_id::text),true)
   where id=p_row_id and project_id=p_project_id;
end;
$$;

create or replace function public.apply_rerun_story_pointer(
  p_project_id uuid, p_execution_reservation_id uuid, p_execution_action_id uuid,
  p_row_kind text, p_row_id uuid, p_expected_asset_id uuid, p_new_asset_id uuid
)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_row_kind in ('storyboard','story_scene') then
    perform public.apply_rerun_story_plan_pointer(
      p_project_id,p_execution_reservation_id,p_execution_action_id,p_row_kind,
      p_row_id,p_expected_asset_id,p_new_asset_id
    );
  else
    perform public.apply_rerun_story_pointer_legacy(
      p_project_id,p_execution_reservation_id,p_execution_action_id,p_row_kind,
      p_row_id,p_expected_asset_id,p_new_asset_id
    );
  end if;
end;
$$;

revoke all on function public.apply_rerun_story_plan_pointer(
  uuid,uuid,uuid,text,uuid,uuid,uuid
) from public,anon,authenticated,popcorn_api;
revoke all on function public.apply_rerun_story_pointer(
  uuid,uuid,uuid,text,uuid,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.apply_rerun_story_pointer(
  uuid,uuid,uuid,text,uuid,uuid,uuid
) to popcorn_api;
