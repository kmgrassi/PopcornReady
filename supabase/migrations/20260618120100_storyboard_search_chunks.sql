-- PR 5 asset-embeddings follow-up: expose storyboard scene/beat retrieval
-- chunks as a typed, rebuildable projection. This does not create embeddings;
-- it gives the future embedding worker/search path stable source text and a
-- full-text retrieval fallback for storyboard structure.

create or replace view public.storyboard_search_chunks as
with scene_chunks as (
  select
    ('storyboard.scene.' || ss.id::text) as chunk_key,
    'storyboard_scene'::text as chunk_kind,
    concat_ws(E'\n',
      'Scene ' || (ss.scene_index + 1)::text,
      case when nullif(btrim(ss.title), '') is not null
        then 'Title: ' || btrim(ss.title) end,
      case when nullif(btrim(ss.summary), '') is not null
        then 'Summary: ' || btrim(ss.summary) end,
      case when nullif(btrim(ss.setting), '') is not null
        then 'Setting: ' || btrim(ss.setting) end,
      case when nullif(btrim(ss.mood), '') is not null
        then 'Mood: ' || btrim(ss.mood) end,
      case when ss.duration_sec is not null
        then 'Duration seconds: ' || ss.duration_sec::text end
    ) as source_text,
    ss.project_id,
    ss.storyboard_id,
    ss.id as scene_id,
    null::uuid as beat_id,
    ss.scene_index,
    null::integer as beat_index,
    ss.scene_asset_id as linked_asset_id,
    ss.updated_at
  from public.storyboard_scenes ss
), beat_chunks as (
  select
    ('storyboard.beat.' || b.id::text) as chunk_key,
    'storyboard_beat'::text as chunk_kind,
    concat_ws(E'\n',
      'Beat ' || (b.beat_index + 1)::text,
      case when nullif(btrim(ss.title), '') is not null
        then 'Scene title: ' || btrim(ss.title) end,
      case when nullif(btrim(ss.summary), '') is not null
        then 'Scene summary: ' || btrim(ss.summary) end,
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
    ss.storyboard_id,
    b.scene_id,
    b.id as beat_id,
    ss.scene_index,
    b.beat_index,
    b.beat_asset_id as linked_asset_id,
    b.updated_at
  from public.storyboard_beats b
  join public.storyboard_scenes ss
    on ss.project_id = b.project_id
   and ss.id = b.scene_id
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
