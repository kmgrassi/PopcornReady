-- Story spine unification, PR 1: additive schema + backfill.
--
-- This keeps the legacy storyboard container/scene tables in place for current
-- readers, while creating the unified operational spine:
--   story_blueprint_acts -> story_blueprint_scenes -> story_beats -> story_panels
--
-- The load-bearing invariant is preserved: story_beats.id equals the old
-- storyboard_beats.id, and story_panels.id equals the old storyboard_panels.id.

alter table public.story_blueprint_acts
  add column mockup_asset_id uuid,
  add column status public.storyboard_item_status not null default 'draft',
  add constraint story_blueprint_acts_project_id_id_unique unique (project_id, id),
  add constraint story_blueprint_acts_mockup_asset_fk foreign key (project_id, mockup_asset_id)
    references public.assets (project_id, id) on delete set null (mockup_asset_id);

create index story_blueprint_acts_mockup_asset_idx
  on public.story_blueprint_acts (mockup_asset_id);

alter table public.story_blueprint_scenes
  add column setting text,
  add column mood text,
  add column scene_asset_id uuid,
  add column status public.storyboard_item_status not null default 'draft',
  add constraint story_blueprint_scenes_project_id_id_unique unique (project_id, id),
  add constraint story_blueprint_scenes_scene_asset_fk foreign key (project_id, scene_asset_id)
    references public.assets (project_id, id) on delete set null (scene_asset_id);

create index story_blueprint_scenes_scene_asset_idx
  on public.story_blueprint_scenes (scene_asset_id);

create table public.story_beats (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null,
  scene_id           uuid not null,
  beat_index         integer not null,
  intent             text not null default '',
  visual_description text,
  dialogue_summary   text,
  narration          text,
  duration_sec       double precision,
  shot_type          text,
  camera             text,
  framing            text,
  status             public.storyboard_item_status not null default 'draft',
  beat_asset_id      uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint story_beats_beat_index_nonnegative check (beat_index >= 0),
  constraint story_beats_duration_nonnegative check (
    duration_sec is null or duration_sec >= 0
  ),
  constraint story_beats_scene_fk foreign key (project_id, scene_id)
    references public.story_blueprint_scenes (project_id, id) on delete cascade,
  constraint story_beats_project_id_id_unique unique (project_id, id),
  constraint story_beats_asset_fk foreign key (project_id, beat_asset_id)
    references public.assets (project_id, id) on delete set null (beat_asset_id)
);

create unique index story_beats_order_idx
  on public.story_beats (scene_id, beat_index);
create index story_beats_scene_idx
  on public.story_beats (scene_id);
create index story_beats_asset_idx
  on public.story_beats (beat_asset_id);

create trigger story_beats_set_updated_at
  before update on public.story_beats
  for each row execute function public.set_updated_at();

create or replace function public.story_beats_require_snapshot()
returns trigger
language plpgsql
as $$
begin
  if (new.intent                is distinct from old.intent
      or new.visual_description is distinct from old.visual_description
      or new.dialogue_summary   is distinct from old.dialogue_summary
      or new.narration          is distinct from old.narration
      or new.duration_sec       is distinct from old.duration_sec
      or new.shot_type          is distinct from old.shot_type
      or new.camera             is distinct from old.camera
      or new.framing            is distinct from old.framing)
     and old.beat_asset_id is not null
     and (new.beat_asset_id is null or new.beat_asset_id = old.beat_asset_id)
  then
    raise exception 'semantic beat edits must mint a new beat snapshot asset and update beat_asset_id in the same write'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger story_beats_require_snapshot
  before update on public.story_beats
  for each row execute function public.story_beats_require_snapshot();

create table public.story_panels (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null,
  beat_id         uuid not null,
  panel_index     integer not null default 0,
  image_asset_id  uuid,
  prompt_asset_id uuid,
  status          public.storyboard_item_status not null default 'queued',
  is_selected     boolean not null default false,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint story_panels_panel_index_nonnegative check (panel_index >= 0),
  constraint story_panels_beat_fk foreign key (project_id, beat_id)
    references public.story_beats (project_id, id) on delete cascade,
  constraint story_panels_project_id_id_unique unique (project_id, id),
  constraint story_panels_image_asset_fk foreign key (project_id, image_asset_id)
    references public.assets (project_id, id) on delete set null (image_asset_id),
  constraint story_panels_prompt_asset_fk foreign key (project_id, prompt_asset_id)
    references public.assets (project_id, id) on delete set null (prompt_asset_id)
);

create unique index story_panels_order_idx
  on public.story_panels (beat_id, panel_index);
create unique index story_panels_selected_idx
  on public.story_panels (beat_id)
  where is_selected;
create index story_panels_beat_idx
  on public.story_panels (beat_id);
create index story_panels_image_asset_idx
  on public.story_panels (image_asset_id);
create index story_panels_prompt_asset_idx
  on public.story_panels (prompt_asset_id);

create trigger story_panels_set_updated_at
  before update on public.story_panels
  for each row execute function public.set_updated_at();

comment on table public.story_beats is
  'Unified ordered story beats under story_blueprint_scenes. Backfilled from storyboard_beats with ids preserved.';
comment on table public.story_panels is
  'Unified visual panels under story_beats. Backfilled from storyboard_panels with ids preserved.';

alter table public.story_beats enable row level security;
alter table public.story_panels enable row level security;

create policy story_beats_owner on public.story_beats
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));
create policy story_panels_owner on public.story_panels
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

create policy story_beats_public_read on public.story_beats
  for select to anon, authenticated
  using (public.project_is_public(project_id));
create policy story_panels_public_read on public.story_panels
  for select to anon, authenticated
  using (public.project_is_public(project_id));

create temp table story_spine_storyboards on commit drop as
with storyboard_counts as (
  select
    project_id,
    count(*) as storyboard_count
  from public.storyboards
  group by project_id
), latest_blueprints as (
  select distinct on (project_id)
    id,
    project_id
  from public.story_blueprints
  order by project_id, created_at desc, id
)
select
  sb.id as storyboard_id,
  sb.project_id,
  p.workspace_id,
  sb.status as storyboard_status,
  sb.created_at as storyboard_created_at,
  sb.updated_at as storyboard_updated_at,
  coalesce(p.current_story_blueprint_id, lb.id) as source_story_blueprint_id,
  case
    when p.current_story_blueprint_id is not null
     and sc.storyboard_count = 1
      then p.current_story_blueprint_id
    else gen_random_uuid()
  end as story_blueprint_id,
  (p.current_story_blueprint_id is not null and sc.storyboard_count = 1) as uses_existing_blueprint
from public.storyboards sb
join public.projects p
  on p.id = sb.project_id
join storyboard_counts sc
  on sc.project_id = sb.project_id
left join latest_blueprints lb
  on lb.project_id = sb.project_id;

insert into public.story_blueprints (
  id,
  schema_version,
  workspace_id,
  project_id,
  brief_asset_id,
  asset_id,
  supersedes_id,
  status,
  snapshot,
  provenance,
  created_by,
  created_at,
  updated_at
)
select
  ss.story_blueprint_id,
  'storyBlueprint.v1',
  ss.workspace_id,
  ss.project_id,
  src.brief_asset_id,
  null,
  ss.source_story_blueprint_id,
  case when ss.storyboard_status = 'approved' then 'approved' else 'draft' end,
  jsonb_build_object(
    'schema', 'storyBlueprint.v1',
    'source', 'story_spine_backfill',
    'storyboardId', ss.storyboard_id::text
  ),
  jsonb_build_object(
    'schema', 'storySpineBackfill.v1',
    'storyboardId', ss.storyboard_id::text,
    'sourceStoryBlueprintId', ss.source_story_blueprint_id::text
  ),
  null,
  ss.storyboard_created_at,
  greatest(ss.storyboard_updated_at, now())
from story_spine_storyboards ss
left join public.story_blueprints src
  on src.id = ss.source_story_blueprint_id
where not ss.uses_existing_blueprint;

insert into public.story_blueprint_characters (
  story_blueprint_id,
  workspace_id,
  project_id,
  stable_id,
  position,
  name,
  role,
  description,
  created_at,
  updated_at
)
select
  ss.story_blueprint_id,
  ss.workspace_id,
  ss.project_id,
  c.stable_id,
  c.position,
  c.name,
  c.role,
  c.description,
  c.created_at,
  c.updated_at
from story_spine_storyboards ss
join public.story_blueprint_characters c
  on c.story_blueprint_id = ss.source_story_blueprint_id
where not ss.uses_existing_blueprint;

insert into public.story_blueprint_acts (
  story_blueprint_id,
  workspace_id,
  project_id,
  stable_id,
  position,
  title,
  purpose,
  summary,
  target_duration_sec,
  status,
  created_at,
  updated_at
)
select
  ss.story_blueprint_id,
  ss.workspace_id,
  ss.project_id,
  a.stable_id,
  a.position,
  a.title,
  a.purpose,
  a.summary,
  a.target_duration_sec,
  'draft',
  a.created_at,
  a.updated_at
from story_spine_storyboards ss
join public.story_blueprint_acts a
  on a.story_blueprint_id = ss.source_story_blueprint_id
where not ss.uses_existing_blueprint;

insert into public.story_blueprint_acts (
  story_blueprint_id,
  workspace_id,
  project_id,
  stable_id,
  position,
  title,
  purpose,
  summary,
  target_duration_sec,
  status
)
select
  ss.story_blueprint_id,
  ss.workspace_id,
  ss.project_id,
  'imported-act-1',
  0,
  'Imported Act',
  'Imported storyboard scenes',
  'Operational scenes imported during story spine backfill.',
  coalesce(sum(s.duration_sec), 0),
  'draft'
from story_spine_storyboards ss
left join public.story_blueprint_acts a
  on a.story_blueprint_id = ss.story_blueprint_id
left join public.storyboard_scenes s
  on s.storyboard_id = ss.storyboard_id
where a.id is null
group by ss.story_blueprint_id, ss.workspace_id, ss.project_id;

delete from public.story_blueprint_scenes s
using story_spine_storyboards ss
where ss.uses_existing_blueprint
  and s.story_blueprint_id = ss.story_blueprint_id;

create temp table story_spine_scene_map on commit drop as
with scenes as (
  select
    ss.storyboard_id,
    ss.id as storyboard_scene_id,
    ss.project_id,
    ss.scene_index,
    ss.title,
    ss.summary,
    ss.setting,
    ss.mood,
    ss.duration_sec,
    ss.scene_asset_id,
    ss.status,
    ss.created_at,
    ss.updated_at,
    sp.story_blueprint_id,
    sp.workspace_id,
    count(*) over (partition by ss.storyboard_id) as scene_count
  from public.storyboard_scenes ss
  join story_spine_storyboards sp
    on sp.storyboard_id = ss.storyboard_id
), acts as (
  select
    a.id as story_blueprint_act_id,
    a.story_blueprint_id,
    row_number() over (
      partition by a.story_blueprint_id
      order by a.position, a.id
    ) - 1 as act_offset,
    count(*) over (partition by a.story_blueprint_id) as act_count
  from public.story_blueprint_acts a
)
select
  gen_random_uuid() as story_blueprint_scene_id,
  s.storyboard_scene_id,
  s.storyboard_id,
  s.project_id,
  s.workspace_id,
  s.story_blueprint_id,
  a.story_blueprint_act_id,
  s.scene_index,
  s.title,
  s.summary,
  s.setting,
  s.mood,
  s.duration_sec,
  s.scene_asset_id,
  s.status,
  s.created_at,
  s.updated_at
from scenes s
join acts a
  on a.story_blueprint_id = s.story_blueprint_id
 and a.act_offset = least(
   a.act_count - 1,
   floor((s.scene_index::numeric * a.act_count::numeric) / greatest(s.scene_count, 1))::integer
 );

insert into public.story_blueprint_scenes (
  id,
  story_blueprint_id,
  story_blueprint_act_id,
  workspace_id,
  project_id,
  stable_id,
  position,
  title,
  summary,
  target_duration_sec,
  setting,
  mood,
  scene_asset_id,
  status,
  created_at,
  updated_at
)
select
  story_blueprint_scene_id,
  story_blueprint_id,
  story_blueprint_act_id,
  workspace_id,
  project_id,
  'storyboard-scene-' || storyboard_scene_id::text,
  scene_index,
  coalesce(nullif(btrim(title), ''), 'Scene ' || (scene_index + 1)::text),
  coalesce(summary, ''),
  coalesce(duration_sec, 0),
  setting,
  mood,
  scene_asset_id,
  status,
  created_at,
  updated_at
from story_spine_scene_map;

insert into public.story_beats (
  id,
  project_id,
  scene_id,
  beat_index,
  intent,
  visual_description,
  dialogue_summary,
  narration,
  duration_sec,
  status,
  beat_asset_id,
  created_at,
  updated_at
)
select
  b.id,
  b.project_id,
  sm.story_blueprint_scene_id,
  b.beat_index,
  b.intent,
  b.visual_description,
  b.dialogue_summary,
  b.narration,
  b.duration_sec,
  b.status,
  b.beat_asset_id,
  b.created_at,
  b.updated_at
from public.storyboard_beats b
join story_spine_scene_map sm
  on sm.storyboard_scene_id = b.scene_id;

insert into public.story_panels (
  id,
  project_id,
  beat_id,
  panel_index,
  image_asset_id,
  prompt_asset_id,
  status,
  is_selected,
  approved_at,
  created_at,
  updated_at
)
select
  p.id,
  p.project_id,
  p.beat_id,
  p.panel_index,
  p.image_asset_id,
  p.prompt_asset_id,
  p.status,
  p.is_selected,
  p.approved_at,
  p.created_at,
  p.updated_at
from public.storyboard_panels p
join public.story_beats b
  on b.project_id = p.project_id
 and b.id = p.beat_id;

with latest_imported as (
  select distinct on (ss.project_id)
    ss.project_id,
    ss.story_blueprint_id
  from story_spine_storyboards ss
  where not ss.uses_existing_blueprint
  order by ss.project_id, ss.storyboard_created_at desc, ss.storyboard_id
)
update public.projects p
set current_story_blueprint_id = li.story_blueprint_id
from latest_imported li
where p.id = li.project_id;
