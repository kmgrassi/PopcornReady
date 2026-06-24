-- Repoint storyboard retrieval/search chunks from the retired storyboard
-- container tables to the unified story spine.

create or replace view public.storyboard_search_chunks as
with scene_chunks as (
  select
    ('storyboard.scene.' || s.id::text) as chunk_key,
    'storyboard_scene'::text as chunk_kind,
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
    ('storyboard.beat.' || b.id::text) as chunk_key,
    'storyboard_beat'::text as chunk_kind,
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

create or replace function public.search_storyboard_chunks(
  p_workspace_id uuid,
  p_project_id uuid,
  p_query text,
  p_storyboard_id uuid default null,
  p_limit integer default 20
)
returns table (
  chunk_key text,
  chunk_kind text,
  source_hash text,
  source_text text,
  project_id uuid,
  storyboard_id uuid,
  scene_id uuid,
  beat_id uuid,
  scene_index integer,
  beat_index integer,
  linked_asset_id uuid,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  with query as (
    select plainto_tsquery('english', p_query) as tsq
  )
  select
    c.chunk_key,
    c.chunk_kind,
    c.source_hash,
    c.source_text,
    c.project_id,
    c.storyboard_id,
    c.scene_id,
    c.beat_id,
    c.scene_index,
    c.beat_index,
    c.linked_asset_id,
    ts_rank(to_tsvector('english', c.source_text), query.tsq) as rank
  from public.storyboard_search_chunks c
  join public.projects p
    on p.id = c.project_id
   and p.workspace_id = p_workspace_id
  cross join query
  where c.project_id = p_project_id
    and (p_storyboard_id is null or c.storyboard_id = p_storyboard_id)
    and to_tsvector('english', c.source_text) @@ query.tsq
  order by rank desc, c.updated_at desc, c.chunk_key
  limit least(greatest(p_limit, 1), 100)
$$;

revoke all on function public.search_storyboard_chunks(uuid, uuid, text, uuid, integer)
  from public;
grant execute on function public.search_storyboard_chunks(uuid, uuid, text, uuid, integer)
  to service_role;
