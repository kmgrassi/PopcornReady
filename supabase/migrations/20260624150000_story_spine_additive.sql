-- Story spine unification, additive foundation for code-path repointing.
--
-- This does not drop the legacy storyboard container tables. It adds the
-- unified operational rows so producers/consumers can move first, while old
-- surfaces remain available until the later drop PR.

alter table public.story_blueprint_acts
  add column if not exists mockup_asset_id uuid references public.assets(id) on delete set null,
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'queued', 'generating', 'ready', 'approved', 'rejected', 'failed'));

alter table public.story_blueprint_scenes
  add column if not exists setting text,
  add column if not exists mood text,
  add column if not exists scene_asset_id uuid references public.assets(id) on delete set null,
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'queued', 'generating', 'ready', 'approved', 'rejected', 'failed'));

do $$
begin
  alter table public.story_blueprint_scenes
    add constraint story_blueprint_scenes_project_id_id_unique unique (project_id, id);
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

create table if not exists public.story_beats (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  scene_id           uuid not null,
  beat_index         integer not null,
  intent             text not null,
  visual_description text,
  dialogue_summary   text,
  narration          text,
  duration_sec       double precision,
  status             text not null default 'draft'
    check (status in ('draft', 'queued', 'generating', 'ready', 'approved', 'rejected', 'failed')),
  beat_asset_id      uuid,
  shot_type          text,
  camera             text,
  framing            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint story_beats_beat_index_nonnegative check (beat_index >= 0),
  constraint story_beats_duration_nonnegative check (duration_sec is null or duration_sec >= 0),
  constraint story_beats_scene_fk foreign key (project_id, scene_id)
    references public.story_blueprint_scenes (project_id, id) on delete cascade,
  constraint story_beats_project_id_id_unique unique (project_id, id),
  constraint story_beats_asset_fk foreign key (project_id, beat_asset_id)
    references public.assets (project_id, id) on delete set null
);

create unique index if not exists story_beats_order_idx
  on public.story_beats (scene_id, beat_index);
create index if not exists story_beats_scene_idx on public.story_beats (scene_id);
create index if not exists story_beats_asset_idx on public.story_beats (beat_asset_id);

drop trigger if exists story_beats_set_updated_at on public.story_beats;
create trigger story_beats_set_updated_at
  before update on public.story_beats
  for each row execute function public.set_updated_at();

create or replace function public.story_beats_require_snapshot()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if (
    old.intent is distinct from new.intent
    or old.visual_description is distinct from new.visual_description
    or old.dialogue_summary is distinct from new.dialogue_summary
    or old.narration is distinct from new.narration
    or old.duration_sec is distinct from new.duration_sec
    or old.shot_type is distinct from new.shot_type
    or old.camera is distinct from new.camera
    or old.framing is distinct from new.framing
  ) and old.beat_asset_id is not null
    and old.beat_asset_id is not distinct from new.beat_asset_id then
    raise exception 'semantic story beat edits must move beat_asset_id to a new snapshot asset'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists story_beats_require_snapshot on public.story_beats;
create trigger story_beats_require_snapshot
  before update on public.story_beats
  for each row execute function public.story_beats_require_snapshot();

create table if not exists public.story_panels (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  beat_id         uuid not null,
  panel_index     integer not null,
  image_asset_id  uuid,
  prompt_asset_id uuid,
  status          text not null default 'queued'
    check (status in ('draft', 'queued', 'generating', 'ready', 'approved', 'rejected', 'failed')),
  is_selected     boolean not null default false,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint story_panels_panel_index_nonnegative check (panel_index >= 0),
  constraint story_panels_beat_fk foreign key (project_id, beat_id)
    references public.story_beats (project_id, id) on delete cascade,
  constraint story_panels_image_asset_fk foreign key (project_id, image_asset_id)
    references public.assets (project_id, id) on delete set null,
  constraint story_panels_prompt_asset_fk foreign key (project_id, prompt_asset_id)
    references public.assets (project_id, id) on delete set null
);

create unique index if not exists story_panels_order_idx
  on public.story_panels (beat_id, panel_index);
create unique index if not exists story_panels_selected_idx
  on public.story_panels (beat_id)
  where is_selected;
create index if not exists story_panels_beat_idx on public.story_panels (beat_id);
create index if not exists story_panels_image_asset_idx on public.story_panels (image_asset_id);
create index if not exists story_panels_prompt_asset_idx on public.story_panels (prompt_asset_id);

drop trigger if exists story_panels_set_updated_at on public.story_panels;
create trigger story_panels_set_updated_at
  before update on public.story_panels
  for each row execute function public.set_updated_at();

alter table public.story_beats enable row level security;
alter table public.story_panels enable row level security;

drop policy if exists story_beats_owner on public.story_beats;
create policy story_beats_owner on public.story_beats
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));
drop policy if exists story_panels_owner on public.story_panels;
create policy story_panels_owner on public.story_panels
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

drop policy if exists story_beats_public_read on public.story_beats;
create policy story_beats_public_read on public.story_beats
  for select using (public.project_is_public(project_id));
drop policy if exists story_panels_public_read on public.story_panels;
create policy story_panels_public_read on public.story_panels
  for select using (public.project_is_public(project_id));

comment on table public.story_beats is
  'Unified operational story beats reparented under story_blueprint_scenes; ids are the stable generation join key.';
comment on table public.story_panels is
  'Generated visual storyboard panels for unified story beats.';
