-- Manual removal script for the story-spine cutover.
--
-- Run this only after application code no longer reads from or writes to:
--   storyboards, storyboard_scenes, storyboard_beats, storyboard_panels.
--
-- It is intentionally NOT a timestamped migration because the current app still
-- carries compatibility fallbacks while PR 1/2 data is being verified. The
-- guards below fail fast if any legacy row was not mirrored into the unified
-- spine with the load-bearing id preservation intact.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $$
declare
  missing_count integer;
begin
  select count(*) into missing_count
  from public.storyboard_scenes legacy
  where not exists (
    select 1
    from public.story_blueprint_scenes spine
    where spine.project_id = legacy.project_id
      and spine.stable_id = 'storyboard-scene-' || legacy.id::text
  );

  if missing_count > 0 then
    raise exception 'Refusing to remove legacy storyboard_scenes: % scenes are not mirrored into story_blueprint_scenes.', missing_count
      using errcode = 'check_violation';
  end if;

  select count(*) into missing_count
  from public.storyboard_beats legacy
  where not exists (
    select 1
    from public.story_beats spine
    where spine.project_id = legacy.project_id
      and spine.id = legacy.id
  );

  if missing_count > 0 then
    raise exception 'Refusing to remove legacy storyboard_beats: % beats are not mirrored into story_beats with ids preserved.', missing_count
      using errcode = 'check_violation';
  end if;

  select count(*) into missing_count
  from public.storyboard_panels legacy
  where not exists (
    select 1
    from public.story_panels spine
    where spine.project_id = legacy.project_id
      and spine.id = legacy.id
  );

  if missing_count > 0 then
    raise exception 'Refusing to remove legacy storyboard_panels: % panels are not mirrored into story_panels with ids preserved.', missing_count
      using errcode = 'check_violation';
  end if;
end $$;

-- Keep the existing retrieval/search RPC name alive while backing it from the
-- unified spine. `storyboard_id` is now the current story_blueprint_id.
create or replace view public.storyboard_search_chunks as
with scene_chunks as (
  select
    ('story.scene.' || s.id::text) as chunk_key,
    'story_scene'::text as chunk_kind,
    concat_ws(E'\n',
      'Scene ' || (s.position + 1)::text,
      case when nullif(btrim(s.title), '') is not null
        then 'Title: ' || btrim(s.title) end,
      case when nullif(btrim(s.summary), '') is not null
        then 'Summary: ' || btrim(s.summary) end,
      case when nullif(btrim(s.setting), '') is not null
        then 'Setting: ' || btrim(s.setting) end,
      case when nullif(btrim(s.mood), '') is not null
        then 'Mood: ' || btrim(s.mood) end,
      case when s.target_duration_sec is not null
        then 'Duration seconds: ' || s.target_duration_sec::text end
    ) as source_text,
    s.project_id,
    s.story_blueprint_id as storyboard_id,
    s.id as scene_id,
    null::uuid as beat_id,
    s.position as scene_index,
    null::integer as beat_index,
    s.scene_asset_id as linked_asset_id,
    s.updated_at
  from public.story_blueprint_scenes s
), beat_chunks as (
  select
    ('story.beat.' || b.id::text) as chunk_key,
    'story_beat'::text as chunk_kind,
    concat_ws(E'\n',
      'Beat ' || (b.beat_index + 1)::text,
      case when nullif(btrim(s.title), '') is not null
        then 'Scene title: ' || btrim(s.title) end,
      case when nullif(btrim(s.summary), '') is not null
        then 'Scene summary: ' || btrim(s.summary) end,
      case when nullif(btrim(b.intent), '') is not null
        then 'Intent: ' || btrim(b.intent) end,
      case when nullif(btrim(b.visual_description), '') is not null
        then 'Visual description: ' || btrim(b.visual_description) end,
      case when nullif(btrim(b.dialogue_summary), '') is not null
        then 'Dialogue summary: ' || btrim(b.dialogue_summary) end,
      case when nullif(btrim(b.narration), '') is not null
        then 'Narration: ' || btrim(b.narration) end,
      case when nullif(btrim(b.shot_type), '') is not null
        then 'Shot type: ' || btrim(b.shot_type) end,
      case when nullif(btrim(b.camera), '') is not null
        then 'Camera: ' || btrim(b.camera) end,
      case when nullif(btrim(b.framing), '') is not null
        then 'Framing: ' || btrim(b.framing) end,
      case when b.duration_sec is not null
        then 'Duration seconds: ' || b.duration_sec::text end
    ) as source_text,
    b.project_id,
    s.story_blueprint_id as storyboard_id,
    b.scene_id,
    b.id as beat_id,
    s.position as scene_index,
    b.beat_index,
    b.beat_asset_id as linked_asset_id,
    b.updated_at
  from public.story_beats b
  join public.story_blueprint_scenes s
    on s.project_id = b.project_id
   and s.id = b.scene_id
)
select
  chunk_key,
  chunk_kind,
  encode(digest(source_text, 'sha256'), 'hex') as source_hash,
  source_text,
  project_id,
  storyboard_id,
  scene_id,
  beat_id,
  scene_index,
  beat_index,
  linked_asset_id,
  updated_at
from scene_chunks
where source_text <> ('Scene ' || (scene_index + 1)::text)
union all
select
  chunk_key,
  chunk_kind,
  encode(digest(source_text, 'sha256'), 'hex') as source_hash,
  source_text,
  project_id,
  storyboard_id,
  scene_id,
  beat_id,
  scene_index,
  beat_index,
  linked_asset_id,
  updated_at
from beat_chunks
where source_text <> ('Beat ' || (beat_index + 1)::text);

revoke all on public.storyboard_search_chunks from public;
revoke all on public.storyboard_search_chunks from anon, authenticated;

-- Regeneration now repoints selected story panels instead of retired
-- storyboard panels. The function signature stays stable for callers.
create or replace function public.regenerate_asset_version(
  p_workspace_id uuid,
  p_old_asset_id uuid,
  p_filename text,
  p_storage_key text,
  p_storage_bucket text,
  p_params jsonb,
  p_content_hash text default null,
  p_duration_sec double precision default null,
  p_action_id uuid default null
)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.assets;
  v_new public.assets;
  v_sel record;
  v_effective_params jsonb;
  v_inputs_fingerprint text;
  v_next_version integer;
begin
  select * into v_old
  from public.assets
  where id = p_old_asset_id
    and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'Asset not found: %', p_old_asset_id
      using errcode = 'no_data_found';
  end if;

  if v_old.media <> 'image' then
    raise exception 'Asset % is not an image (media=%); only images regenerate from a prompt.',
      p_old_asset_id, v_old.media
      using errcode = 'invalid_parameter_value';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_old.lineage_id::text));

  perform 1
  from public.assets
  where lineage_id = v_old.lineage_id
    and workspace_id = p_workspace_id
  order by version
  for update;

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.assets
  where lineage_id = v_old.lineage_id
    and workspace_id = p_workspace_id;

  v_effective_params := coalesce(p_params, v_old.params);

  select encode(
    extensions.digest(
      jsonb_build_object(
        'inputHashes',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'assetId', input_item.value->>'assetId',
                'contentHash', coalesce(input_item.value->>'contentHash', '')
              )
              order by input_item.value->>'assetId'
            )
            from jsonb_array_elements(coalesce(v_old.inputs, '[]'::jsonb)) as input_item(value)
          ),
          '[]'::jsonb
        ),
        'paramsHash',
        encode(extensions.digest(coalesce(v_effective_params, 'null'::jsonb)::text, 'sha256'), 'hex')
      )::text,
      'sha256'
    ),
    'hex'
  ) into v_inputs_fingerprint;

  insert into public.assets (
    schema_version,
    workspace_id,
    project_id,
    lineage_id,
    version,
    kind,
    media,
    status,
    role,
    name,
    slug,
    filename,
    content,
    params,
    inputs,
    content_hash,
    inputs_fingerprint,
    created_by_action_id,
    remote_url,
    storage_key,
    storage_bucket,
    source,
    duration_sec,
    description,
    context,
    semantic_analysis,
    visibility
  ) values (
    v_old.schema_version,
    v_old.workspace_id,
    v_old.project_id,
    v_old.lineage_id,
    v_next_version,
    v_old.kind,
    v_old.media,
    'ready',
    v_old.role,
    v_old.name,
    null,
    p_filename,
    v_old.content,
    v_effective_params,
    v_old.inputs,
    coalesce(p_content_hash, v_old.content_hash),
    v_inputs_fingerprint,
    coalesce(p_action_id, v_old.created_by_action_id),
    null,
    p_storage_key,
    p_storage_bucket,
    v_old.source,
    coalesce(p_duration_sec, v_old.duration_sec),
    v_old.description,
    v_old.context,
    v_old.semantic_analysis,
    v_old.visibility
  )
  returning * into v_new;

  update public.story_panels
  set image_asset_id = v_new.id
  where project_id = v_old.project_id
    and image_asset_id in (
      select id
      from public.assets
      where project_id = v_old.project_id
        and lineage_id = v_old.lineage_id
    );

  for v_sel in
    select slot_owner_lineage_id, slot_role
    from public.current_selections
    where project_id = v_old.project_id
      and active_asset_id in (
        select id
        from public.assets
        where project_id = v_old.project_id
          and lineage_id = v_old.lineage_id
      )
  loop
    insert into public.selections (
      project_id,
      slot_owner_lineage_id,
      slot_role,
      active_asset_id,
      set_by_action_id
    ) values (
      v_old.project_id,
      v_sel.slot_owner_lineage_id,
      v_sel.slot_role,
      v_new.id,
      p_action_id
    );
  end loop;

  return v_new;
end;
$$;

comment on function public.regenerate_asset_version(
  uuid, uuid, text, text, text, jsonb, text, double precision, uuid
) is
  'Atomically mint a new immutable image asset version and repoint story_panels + selection slots that referenced the prior version.';

-- Project manifest keeps the historical `storyboards` JSON key but sources it
-- from the unified story spine.
create or replace function public.project_manifest(p_project_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'assets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ref', a.ref, 'kind', a.kind, 'status', a.status, 'role', a.role,
        'lineage', a.lineage_id, 'v', a.version,
        'summary', coalesce(a.description, a.content ->> 'summary'),
        'fp', a.inputs_fingerprint,
        'inputs', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'ref', ia.ref, 'rel', e.relation, 'role', e.role, 'pos', e.position
          ) order by e.relation, e.position), '[]'::jsonb)
          from public.asset_edges e
          join public.assets ia on ia.id = e.to_id
          where e.from_id = a.id
        )
      ) order by a.created_at), '[]'::jsonb)
      from public.assets a
      where a.project_id = p_project_id
    ),
    'selections', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'owner', s.slot_owner_lineage_id, 'slot', s.slot_role, 'seq', s.seq,
        'active', (select ref from public.assets where id = s.active_asset_id)
      )), '[]'::jsonb)
      from public.current_selections s
      where s.project_id = p_project_id
    ),
    'storyboards', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id,
        'status', b.status,
        'planAsset', null,
        'scenes', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id,
            'index', s.position,
            'title', s.title,
            'summary', s.summary,
            'setting', s.setting,
            'mood', s.mood,
            'durationSec', s.target_duration_sec,
            'status', s.status,
            'sceneAsset', (select ref from public.assets where id = s.scene_asset_id),
            'beats', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', beat.id,
                'index', beat.beat_index,
                'intent', beat.intent,
                'visualDescription', beat.visual_description,
                'dialogueSummary', beat.dialogue_summary,
                'narration', beat.narration,
                'durationSec', beat.duration_sec,
                'shotType', beat.shot_type,
                'camera', beat.camera,
                'framing', beat.framing,
                'status', beat.status,
                'beatAsset', (select ref from public.assets where id = beat.beat_asset_id),
                'panels', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                    'id', panel.id,
                    'index', panel.panel_index,
                    'status', panel.status,
                    'selected', panel.is_selected,
                    'approvedAt', panel.approved_at,
                    'imageAsset', (select ref from public.assets where id = panel.image_asset_id),
                    'promptAsset', (select ref from public.assets where id = panel.prompt_asset_id)
                  ) order by panel.panel_index), '[]'::jsonb)
                  from public.story_panels panel
                  where panel.beat_id = beat.id
                )
              ) order by beat.beat_index), '[]'::jsonb)
              from public.story_beats beat
              where beat.scene_id = s.id
            )
          ) order by s.position), '[]'::jsonb)
          from public.story_blueprint_scenes s
          where s.story_blueprint_id = b.id
        )
      ) order by b.created_at), '[]'::jsonb)
      from public.story_blueprints b
      where b.project_id = p_project_id
    )
  )
$$;

drop table public.storyboard_panels;
drop table public.storyboard_beats;
drop function if exists public.storyboard_beats_require_snapshot();
drop table public.storyboard_scenes;
drop table public.storyboards;

commit;
