-- Claimed Visuals storyboard work becomes visible as one complete bundle.
-- Provider bytes are uploaded first under deterministic ids; this transaction
-- fences the exact job/action/run/session claim plus plan, pointer, and
-- preserved-panel CAS tokens before inserting any graph or relational row.

create or replace function public.asset_graph_canonical_jsonb_text(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  v_result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(string_agg(
        to_jsonb(item.key)::text || ':' ||
          public.asset_graph_canonical_jsonb_text(item.value),
        ',' order by item.key
      ), '') || '}'
      into v_result
      from jsonb_each(p_value) item;
      return v_result;
    when 'array' then
      select '[' || coalesce(string_agg(
        public.asset_graph_canonical_jsonb_text(item.value),
        ',' order by item.ordinality
      ), '') || ']'
      into v_result
      from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
      return v_result;
    else
      return p_value::text;
  end case;
end;
$$;

revoke all on function public.asset_graph_canonical_jsonb_text(jsonb)
from public, anon, authenticated;

create or replace function public.commit_claimed_storyboard_bundle(
  p_workspace_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_action_id uuid,
  p_run_id uuid,
  p_session_claim_generation bigint,
  p_plan_asset_id uuid,
  p_plan_content_hash text,
  p_expected_plan_selection_seq integer,
  p_expected_current_storyboard_id uuid,
  p_baseline_storyboard_id uuid,
  p_preservation jsonb,
  p_storyboard_id uuid,
  p_bundle_fingerprint text,
  p_act_id uuid,
  p_new_assets jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_job public.jobs;
  v_action public.actions;
  v_run public.orchestrator_runs;
  v_session public.agent_sessions;
  v_plan_selection public.selections;
  v_existing_storyboard public.story_blueprints;
  v_plan_content jsonb;
  v_plan_hash text;
  v_expected_scenes jsonb;
  v_submitted_scenes jsonb;
  v_expected_beats jsonb;
  v_submitted_beats jsonb;
  v_expected jsonb;
  v_submitted jsonb;
  v_item jsonb;
  v_scene jsonb;
  v_beat jsonb;
  v_panel_count integer := 0;
  v_match_count integer := 0;
  v_asset_ordinality integer := 0;
  v_expected_params jsonb;
  v_expected_inputs_fingerprint text;
  v_commit_result jsonb;
begin
  if p_action_id is null
     or p_run_id is null
     or p_session_claim_generation is null
     or nullif(p_bundle_fingerprint, '') is null then
    raise exception 'claimed storyboard commit requires action, run, and claim'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Replay is checked before active ownership. A caller whose first response
  -- was lost must be able to recover the immutable committed result after the
  -- job/action/session have already transitioned terminal.
  select * into v_existing_storyboard
  from public.story_blueprints
  where id = p_storyboard_id and project_id = p_project_id;
  if found then
    select * into v_job from public.jobs
    where id = p_job_id
      and workspace_id = p_workspace_id
      and project_id = p_project_id;
    select * into v_action from public.actions
    where id = p_action_id
      and project_id = p_project_id;
    select * into v_run from public.orchestrator_runs
    where id = p_run_id
      and project_id = p_project_id
      and agent_role = 'visuals';
    if v_job.id is null
       or v_job.action_id is distinct from p_action_id
       or v_action.id is null
       or v_action.orchestrator_run_id is distinct from p_run_id
       or v_action.tool <> 'generate_storyboard'
       or v_run.id is null
       or v_existing_storyboard.provenance ->> 'jobId' is distinct from p_job_id::text
       or v_existing_storyboard.provenance ->> 'actionId' is distinct from p_action_id::text
       or v_existing_storyboard.provenance ->> 'runId' is distinct from p_run_id::text
       or v_existing_storyboard.provenance ->> 'planAssetId' is distinct from p_plan_asset_id::text
       or v_existing_storyboard.provenance ->> 'bundleFingerprint'
          is distinct from p_bundle_fingerprint then
      raise exception 'storyboard bundle replay does not match the committed payload'
        using errcode = 'unique_violation';
    end if;
    select count(*) into v_panel_count
    from public.story_panels sp
    join public.story_beats sb on sb.id = sp.beat_id
    join public.story_blueprint_scenes ss on ss.id = sb.scene_id
    where ss.story_blueprint_id = p_storyboard_id and sp.is_selected;
    return jsonb_build_object(
      'storyboardId', p_storyboard_id,
      'panelCount', v_panel_count,
      'assetIds', coalesce(v_existing_storyboard.provenance -> 'assetIds', '[]'::jsonb)
    );
  end if;

  select * into v_job from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id and project_id = p_project_id
  for update;
  if not found
     or v_job.action_id is distinct from p_action_id
     or v_job.session_claim_generation is distinct from p_session_claim_generation
     or v_job.status not in ('queued', 'running') then
    raise exception 'stale_session_claim: storyboard job is not active under the supplied claim'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select * into v_action from public.actions
  where id = p_action_id and project_id = p_project_id
  for update;
  if not found
     or v_action.orchestrator_run_id is distinct from p_run_id
     or v_action.tool <> 'generate_storyboard'
     or v_action.status <> 'running' then
    raise exception 'storyboard action does not own the claimed job'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select * into v_run from public.orchestrator_runs
  where id = p_run_id and project_id = p_project_id and agent_role = 'visuals'
    and status in ('running', 'waiting')
  for update;
  if not found or v_run.agent_session_id is null then
    raise exception 'stale_session_claim: storyboard run is not an active Visuals session run'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  select * into v_session from public.agent_sessions
  where id = v_run.agent_session_id
  for update;
  if not found
     or v_session.project_id is distinct from p_project_id
     or v_session.active_run_id is distinct from p_run_id
     or v_session.claim_generation is distinct from p_session_claim_generation then
    raise exception 'stale_session_claim: storyboard run no longer owns generation %',
      p_session_claim_generation using errcode = 'object_not_in_prerequisite_state';
  end if;

  select * into v_project from public.projects
  where id = p_project_id and workspace_id = p_workspace_id and status <> 'deleted'
  for update;
  if not found
     or v_project.current_story_blueprint_id is distinct from p_expected_current_storyboard_id then
    raise exception 'storyboard project pointer changed during generation'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select * into v_plan_selection
  from public.selections
  where project_id = p_project_id
    and slot_owner_lineage_id is null
    and slot_role = 'plan'
  order by seq desc
  limit 1
  for update;
  if not found
     or v_plan_selection.seq is distinct from p_expected_plan_selection_seq
     or v_plan_selection.active_asset_id is distinct from p_plan_asset_id then
    raise exception 'active plan selection changed during storyboard generation'
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  select content, content_hash into v_plan_content, v_plan_hash from public.assets
  where id = p_plan_asset_id and project_id = p_project_id and kind = 'plan'
  for update;
  if not found or coalesce(v_plan_hash, '') is distinct from coalesce(p_plan_content_hash, '') then
    raise exception 'active plan content changed during storyboard generation'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Reconstruct the complete active-plan beat manifest in PostgreSQL. The
  -- application payload cannot omit, duplicate, reorder, or swap a beat/panel
  -- mapping and still make any graph or relational row visible.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sceneIndex', plan_scene.ordinality - 1,
        'title', plan_scene.value ->> 'name',
        'setting', plan_scene.value ->> 'setting',
        'mood', plan_scene.value ->> 'mood'
      )
      order by plan_scene.ordinality
    ),
    '[]'::jsonb
  )
  into v_expected_scenes
  from jsonb_array_elements(coalesce(v_plan_content -> 'scenes', '[]'::jsonb))
       with ordinality as plan_scene(value, ordinality);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sceneIndex', (submitted_scene.value ->> 'sceneIndex')::integer,
        'title', submitted_scene.value ->> 'title',
        'setting', submitted_scene.value ->> 'setting',
        'mood', submitted_scene.value ->> 'mood'
      )
      order by (submitted_scene.value ->> 'sceneIndex')::integer
    ),
    '[]'::jsonb
  )
  into v_submitted_scenes
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
       as submitted_scene(value);

  if jsonb_array_length(v_expected_scenes) = 0
     or jsonb_array_length(v_submitted_scenes) <> jsonb_array_length(v_expected_scenes) then
    raise exception 'storyboard rows do not cover the complete active-plan scene manifest'
      using errcode = 'invalid_parameter_value';
  end if;
  for v_expected in select value from jsonb_array_elements(v_expected_scenes)
  loop
    select count(*) into v_match_count
    from jsonb_array_elements(v_submitted_scenes) submitted(value)
    where submitted.value = v_expected;
    if v_match_count <> 1 then
      raise exception 'storyboard scene rows do not match the active plan'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'planBeatId', plan_beat.value ->> 'id',
        'sceneIndex', plan_scene.ordinality - 1,
        'beatIndex', plan_beat.ordinality - 1,
        'intent', coalesce(plan_beat.value ->> 'intent', ''),
        'durationSec', plan_beat.value -> 'durationSec',
        'shotType', plan_beat.value -> 'shotType',
        'camera', plan_beat.value -> 'camera',
        'framing', plan_beat.value -> 'framing'
      )
      order by plan_scene.ordinality, plan_beat.ordinality
    ),
    '[]'::jsonb
  )
  into v_expected_beats
  from jsonb_array_elements(coalesce(v_plan_content -> 'scenes', '[]'::jsonb))
       with ordinality as plan_scene(value, ordinality)
  cross join lateral jsonb_array_elements(coalesce(plan_scene.value -> 'beats', '[]'::jsonb))
       with ordinality as plan_beat(value, ordinality);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'planBeatId', submitted_beat.value ->> 'planBeatId',
        'sceneIndex', (submitted_scene.value ->> 'sceneIndex')::integer,
        'beatIndex', (submitted_beat.value ->> 'beatIndex')::integer,
        'intent', coalesce(submitted_beat.value ->> 'intent', ''),
        'durationSec', submitted_beat.value -> 'durationSec',
        'shotType', submitted_beat.value -> 'shotType',
        'camera', submitted_beat.value -> 'camera',
        'framing', submitted_beat.value -> 'framing',
        'imageAssetId', submitted_beat.value ->> 'imageAssetId'
      )
      order by (submitted_scene.value ->> 'sceneIndex')::integer,
               (submitted_beat.value ->> 'beatIndex')::integer
    ),
    '[]'::jsonb
  )
  into v_submitted_beats
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
       as submitted_scene(value)
  cross join lateral jsonb_array_elements(coalesce(submitted_scene.value -> 'beats', '[]'::jsonb))
       as submitted_beat(value);

  if jsonb_array_length(v_expected_beats) = 0
     or jsonb_array_length(v_submitted_beats) <> jsonb_array_length(v_expected_beats)
     or exists (
       select 1
       from jsonb_array_elements(v_expected_beats) expected(value)
       where nullif(expected.value ->> 'planBeatId', '') is null
     )
     or (
       select count(distinct expected.value ->> 'planBeatId')
       from jsonb_array_elements(v_expected_beats) expected(value)
     ) <> jsonb_array_length(v_expected_beats) then
    raise exception 'storyboard rows do not cover the complete active plan'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_expected in select value from jsonb_array_elements(v_expected_beats)
  loop
    select count(*) into v_match_count
    from jsonb_array_elements(v_submitted_beats) submitted(value)
    where submitted.value ->> 'planBeatId' = v_expected ->> 'planBeatId'
      and (submitted.value ->> 'sceneIndex')::integer =
          (v_expected ->> 'sceneIndex')::integer
      and (submitted.value ->> 'beatIndex')::integer =
          (v_expected ->> 'beatIndex')::integer
      and submitted.value -> 'intent' = v_expected -> 'intent'
      and submitted.value -> 'durationSec' is not distinct from
          v_expected -> 'durationSec'
      and submitted.value -> 'shotType' is not distinct from
          v_expected -> 'shotType'
      and submitted.value -> 'camera' is not distinct from
          v_expected -> 'camera'
      and submitted.value -> 'framing' is not distinct from
          v_expected -> 'framing';
    if v_match_count <> 1 then
      raise exception 'storyboard row coordinates do not match the active plan'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  if (
    select count(distinct item.value ->> 'id')
    from jsonb_array_elements(coalesce(p_new_assets, '[]'::jsonb)) item(value)
  ) <> jsonb_array_length(coalesce(p_new_assets, '[]'::jsonb)) then
    raise exception 'new storyboard asset ids must be unique'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_submitted in select value from jsonb_array_elements(v_submitted_beats)
  loop
    select count(*) into v_match_count
    from jsonb_array_elements(coalesce(p_new_assets, '[]'::jsonb)) item(value)
    where item.value ->> 'id' = v_submitted ->> 'imageAssetId'
      and item.value ->> 'beatId' = v_submitted ->> 'planBeatId'
      and item.value -> 'params' -> 'provenance' ->> 'beatId' =
          v_submitted ->> 'planBeatId'
      and exists (
        select 1
        from jsonb_array_elements(coalesce(item.value -> 'inputs', '[]'::jsonb)) edge(value)
        where edge.value ->> 'assetId' = p_plan_asset_id::text
          and edge.value ->> 'relation' = 'input'
          and edge.value ->> 'role' = 'plan'
          and coalesce(edge.value ->> 'contentHash', '') =
              coalesce(p_plan_content_hash, '')
      );
    if v_match_count = 0 then
      select count(*) into v_match_count
      from jsonb_array_elements(coalesce(p_preservation, '[]'::jsonb)) item(value)
      where item.value ->> 'assetId' = v_submitted ->> 'imageAssetId'
        and item.value ->> 'planBeatId' = v_submitted ->> 'planBeatId'
        and (item.value ->> 'sceneIndex')::integer =
            (v_submitted ->> 'sceneIndex')::integer
        and (item.value ->> 'beatIndex')::integer =
            (v_submitted ->> 'beatIndex')::integer;
    end if;
    if v_match_count <> 1 then
      raise exception 'storyboard panel asset does not match its active-plan beat'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  for v_item, v_asset_ordinality in
    select value, ordinality::integer
    from jsonb_array_elements(coalesce(p_new_assets, '[]'::jsonb))
         with ordinality
  loop
    if jsonb_array_length(coalesce(v_item -> 'inputs', '[]'::jsonb)) <> 1
       or v_item -> 'inputs' -> 0 is distinct from jsonb_build_object(
         'assetId', p_plan_asset_id::text,
         'relation', 'input',
         'role', 'plan',
         'position', v_asset_ordinality - 1,
         'contentHash', p_plan_content_hash
       ) then
      raise exception 'new storyboard assets require exactly one active-plan input edge'
        using errcode = 'invalid_parameter_value';
    end if;
    v_expected_params := jsonb_build_object(
      'schema_version', 'asset_params.v1',
      'provenance', jsonb_strip_nulls(jsonb_build_object(
        'provider', v_item -> 'params' -> 'provenance' ->> 'provider',
        'model', nullif(v_item -> 'params' -> 'provenance' ->> 'model', ''),
        'prompt', v_item -> 'params' -> 'provenance' ->> 'prompt',
        'beatId', v_item ->> 'beatId'
      ))
    );
    if v_item -> 'params' is distinct from v_expected_params
       or nullif(v_expected_params -> 'provenance' ->> 'provider', '') is null
       or v_expected_params -> 'provenance' ->> 'prompt' is null then
      raise exception 'new storyboard asset params do not match the claimed beat'
        using errcode = 'invalid_parameter_value';
    end if;
    v_expected_inputs_fingerprint := encode(
      extensions.digest(
        public.asset_graph_canonical_jsonb_text(jsonb_build_object(
          'inputHashes', jsonb_build_array(jsonb_build_object(
            'assetId', p_plan_asset_id::text,
            'contentHash', coalesce(p_plan_content_hash, '')
          )),
          'paramsHash', encode(
            extensions.digest(
              public.asset_graph_canonical_jsonb_text(v_expected_params),
              'sha256'
            ),
            'hex'
          )
        )),
        'sha256'
      ),
      'hex'
    );
    if v_item ->> 'inputsFingerprint' is distinct from v_expected_inputs_fingerprint then
      raise exception 'new storyboard asset inputs fingerprint is invalid'
        using errcode = 'invalid_parameter_value';
    end if;
    select count(*) into v_match_count
    from jsonb_array_elements(v_submitted_beats) submitted(value)
    where submitted.value ->> 'imageAssetId' = v_item ->> 'id'
      and submitted.value ->> 'planBeatId' = v_item ->> 'beatId';
    if v_match_count <> 1 then
      raise exception 'each new storyboard asset must back exactly one plan beat'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_preservation, '[]'::jsonb))
  loop
    select count(*) into v_match_count
    from jsonb_array_elements(v_submitted_beats) submitted(value)
    where submitted.value ->> 'imageAssetId' = v_item ->> 'assetId'
      and submitted.value ->> 'planBeatId' = v_item ->> 'planBeatId'
      and (submitted.value ->> 'sceneIndex')::integer =
          (v_item ->> 'sceneIndex')::integer
      and (submitted.value ->> 'beatIndex')::integer =
          (v_item ->> 'beatIndex')::integer;
    if v_match_count <> 1 then
      raise exception 'each preserved storyboard asset must back exactly one plan beat'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  if p_baseline_storyboard_id is not null then
    perform 1 from public.story_blueprints
    where id = p_baseline_storyboard_id
      and project_id = p_project_id
      and provenance ->> 'planAssetId' = p_plan_asset_id::text
    for update;
    if not found then
      raise exception 'storyboard preservation baseline changed'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  elsif jsonb_array_length(coalesce(p_preservation, '[]'::jsonb)) > 0 then
    raise exception 'storyboard preservation rows require a baseline'
      using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_preservation, '[]'::jsonb))
  loop
    perform 1
    from public.story_panels sp
    join public.story_beats sb on sb.id = sp.beat_id
    join public.story_blueprint_scenes ss on ss.id = sb.scene_id
    where ss.story_blueprint_id = p_baseline_storyboard_id
      and ss.id = (v_item ->> 'relationalSceneId')::uuid
      and ss.position = (v_item ->> 'sceneIndex')::integer
      and sb.id = (v_item ->> 'relationalBeatId')::uuid
      and sb.beat_index = (v_item ->> 'beatIndex')::integer
      and sp.id = (v_item ->> 'panelId')::uuid
      and sp.image_asset_id = (v_item ->> 'assetId')::uuid
      and sp.is_selected
      and sp.status in ('ready', 'approved')
    for update of sp, sb, ss;
    if not found then
      raise exception 'a preserved storyboard panel changed during generation'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    perform 1 from public.assets
    where id = (v_item ->> 'assetId')::uuid
      and project_id = p_project_id
      and status = 'ready'
      and media = 'image'
      and role = 'beat_storyboard'
      and coalesce(content_hash, '') = coalesce(v_item ->> 'assetContentHash', '')
      and params -> 'provenance' ->> 'beatId' = v_item ->> 'planBeatId'
      and exists (
        select 1
        from jsonb_array_elements(coalesce(inputs, '[]'::jsonb)) edge
        where edge ->> 'assetId' = p_plan_asset_id::text
          and edge ->> 'relation' = 'input'
          and edge ->> 'role' = 'plan'
          and coalesce(edge ->> 'contentHash', '') = coalesce(p_plan_content_hash, '')
      )
    for update;
    if not found then
      raise exception 'a preserved storyboard asset changed during generation'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_new_assets, '[]'::jsonb))
  loop
    insert into public.assets (
      id, schema_version, workspace_id, project_id, kind, media, status, role,
      filename, params, inputs, content_hash, inputs_fingerprint,
      created_by_action_id, storage_key, storage_bucket, source, description,
      visibility
    ) values (
      (v_item ->> 'id')::uuid, 'asset.v1', p_workspace_id, p_project_id,
      'keyframe', 'image', 'ready', 'beat_storyboard',
      v_item ->> 'filename', v_item -> 'params', v_item -> 'inputs',
      v_item ->> 'contentHash', v_item ->> 'inputsFingerprint', p_action_id,
      v_item ->> 'storageKey', v_item ->> 'storageBucket',
      jsonb_build_object(
        'type', 'generated',
        'generatedAssetId', v_item ->> 'id'
      ),
      v_item ->> 'description',
      (v_item ->> 'visibility')::public.visibility
    );
  end loop;

  insert into public.story_blueprints (
    id, schema_version, workspace_id, project_id, status, snapshot, provenance,
    created_by
  ) values (
    p_storyboard_id, 'storyBlueprint.v1', p_workspace_id, p_project_id, 'draft',
    jsonb_build_object(
      'schema_version', 'storyBlueprint.v1',
      'title', v_project.name,
      'characters', '[]'::jsonb,
      'acts', '[]'::jsonb,
      'scenes', '[]'::jsonb
    ),
    jsonb_build_object(
      'schema_version', 'story_blueprint_provenance.v1',
      'planAssetId', p_plan_asset_id,
      'handoffReady', true,
      'jobId', p_job_id,
      'actionId', p_action_id,
      'runId', p_run_id,
      'bundleFingerprint', p_bundle_fingerprint,
      'assetIds', coalesce(
        (select jsonb_agg(value ->> 'id' order by ordinality)
         from jsonb_array_elements(p_new_assets) with ordinality),
        '[]'::jsonb
      )
    ),
    jsonb_build_object(
      'schema_version', 'story_blueprint_creator.v1',
      'tool', 'generate_storyboard',
      'actionId', p_action_id
    )
  );
  insert into public.story_blueprint_acts (
    id, story_blueprint_id, workspace_id, project_id, stable_id, position,
    title, purpose, summary, target_duration_sec, status
  ) values (
    p_act_id, p_storyboard_id, p_workspace_id, p_project_id, 'act_1', 0,
    'Act 1', 'Storyboard', 'Storyboard scenes.', 0, 'ready'
  );

  for v_scene in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    insert into public.story_blueprint_scenes (
      id, story_blueprint_id, story_blueprint_act_id, workspace_id, project_id,
      stable_id, position, title, summary, setting, mood, target_duration_sec,
      status
    ) values (
      (v_scene ->> 'id')::uuid, p_storyboard_id, p_act_id, p_workspace_id,
      p_project_id, 'scene_' || ((v_scene ->> 'sceneIndex')::integer + 1),
      (v_scene ->> 'sceneIndex')::integer, coalesce(v_scene ->> 'title', ''),
      '', v_scene ->> 'setting', v_scene ->> 'mood', 0, 'ready'
    );
    for v_beat in select value from jsonb_array_elements(v_scene -> 'beats')
    loop
      insert into public.story_beats (
        id, project_id, scene_id, beat_index, intent, duration_sec, shot_type,
        camera, framing, status
      ) values (
        (v_beat ->> 'id')::uuid, p_project_id, (v_scene ->> 'id')::uuid,
        (v_beat ->> 'beatIndex')::integer, coalesce(v_beat ->> 'intent', ''),
        nullif(v_beat ->> 'durationSec', '')::double precision,
        v_beat ->> 'shotType', v_beat ->> 'camera', v_beat ->> 'framing', 'ready'
      );
      insert into public.story_panels (
        id, project_id, beat_id, panel_index, image_asset_id, status, is_selected
      ) values (
        (v_beat ->> 'panelId')::uuid, p_project_id, (v_beat ->> 'id')::uuid,
        0, (v_beat ->> 'imageAssetId')::uuid, 'ready', true
      );
      v_panel_count := v_panel_count + 1;
    end loop;
  end loop;

  update public.projects
  set current_story_blueprint_id = p_storyboard_id
  where id = p_project_id and workspace_id = p_workspace_id;

  v_commit_result := jsonb_build_object(
    'storyboardId', p_storyboard_id,
    'panelCount', v_panel_count,
    'assetIds', coalesce(
      (select jsonb_agg(value ->> 'id' order by ordinality)
       from jsonb_array_elements(p_new_assets) with ordinality),
      '[]'::jsonb
    )
  );
  update public.jobs
  set
    status = 'succeeded',
    result = v_commit_result,
    progress = progress || jsonb_build_object(
      'currentStep', 'completed',
      'percent', 100,
      'heartbeatAt', now(),
      'lastProgressAt', now()
    ),
    updated_at = now()
  where id = p_job_id
    and workspace_id = p_workspace_id
    and project_id = p_project_id
    and status in ('queued', 'running');
  if not found then
    raise exception 'storyboard job changed before atomic completion'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  return v_commit_result;
end;
$$;

revoke all on function public.commit_claimed_storyboard_bundle(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, integer, uuid, uuid, jsonb,
  uuid, text, uuid, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.commit_claimed_storyboard_bundle(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, integer, uuid, uuid, jsonb,
  uuid, text, uuid, jsonb, jsonb
) to service_role;
