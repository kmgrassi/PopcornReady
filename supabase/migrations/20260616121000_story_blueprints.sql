-- Canonical story blueprint resource for the orchestrator writing layer.
--
-- The creative document itself is a first-class row. A matching immutable
-- asset graph node records provenance and stale-detection inputs.

set check_function_bodies = off;

create table public.story_blueprints (
  id              uuid primary key default gen_random_uuid(),
  schema_version  text not null default 'storyBlueprint.v1',
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  brief_asset_id  uuid references public.assets(id) on delete set null,
  asset_id        uuid references public.assets(id) on delete set null,
  supersedes_id   uuid references public.story_blueprints(id) on delete set null,
  status          text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  snapshot        jsonb not null,
  provenance      jsonb not null default '{}'::jsonb,
  created_by      jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index story_blueprints_project_id_idx on public.story_blueprints(project_id);
create index story_blueprints_brief_asset_id_idx on public.story_blueprints(brief_asset_id);
create index story_blueprints_asset_id_idx on public.story_blueprints(asset_id);

create table public.story_blueprint_characters (
  id                 uuid primary key default gen_random_uuid(),
  story_blueprint_id uuid not null references public.story_blueprints(id) on delete cascade,
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  stable_id          text not null,
  position           integer not null,
  name               text not null,
  role               text not null,
  description        text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (story_blueprint_id, stable_id),
  unique (story_blueprint_id, position)
);

create table public.story_blueprint_acts (
  id                  uuid primary key default gen_random_uuid(),
  story_blueprint_id  uuid not null references public.story_blueprints(id) on delete cascade,
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  project_id          uuid not null references public.projects(id) on delete cascade,
  stable_id           text not null,
  position            integer not null,
  title               text not null,
  purpose             text not null,
  summary             text not null,
  target_duration_sec double precision not null check (target_duration_sec >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (story_blueprint_id, stable_id),
  unique (story_blueprint_id, position)
);

create table public.story_blueprint_scenes (
  id                     uuid primary key default gen_random_uuid(),
  story_blueprint_id     uuid not null references public.story_blueprints(id) on delete cascade,
  story_blueprint_act_id uuid not null references public.story_blueprint_acts(id) on delete cascade,
  workspace_id           uuid not null references public.workspaces(id) on delete cascade,
  project_id             uuid not null references public.projects(id) on delete cascade,
  stable_id              text not null,
  position               integer not null,
  title                  text not null,
  summary                text not null,
  target_duration_sec    double precision not null check (target_duration_sec >= 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (story_blueprint_id, stable_id),
  unique (story_blueprint_id, position)
);

create index story_blueprint_characters_project_id_idx
  on public.story_blueprint_characters(project_id);
create index story_blueprint_acts_project_id_idx
  on public.story_blueprint_acts(project_id);
create index story_blueprint_scenes_project_id_idx
  on public.story_blueprint_scenes(project_id);

alter table public.projects
  add column current_story_blueprint_id uuid references public.story_blueprints(id) on delete set null;

create trigger story_blueprints_set_updated_at
  before update on public.story_blueprints
  for each row execute function public.set_updated_at();
create trigger story_blueprint_characters_set_updated_at
  before update on public.story_blueprint_characters
  for each row execute function public.set_updated_at();
create trigger story_blueprint_acts_set_updated_at
  before update on public.story_blueprint_acts
  for each row execute function public.set_updated_at();
create trigger story_blueprint_scenes_set_updated_at
  before update on public.story_blueprint_scenes
  for each row execute function public.set_updated_at();

alter table public.story_blueprints add constraint story_blueprints_snapshot_schema_check
  check (
    jsonb_typeof(snapshot) = 'object'
    and (snapshot ? 'schema' or snapshot ? 'schema_version')
  );

alter table public.story_blueprints add constraint story_blueprints_provenance_schema_check
  check (
    provenance = '{}'::jsonb
    or (
      jsonb_typeof(provenance) = 'object'
      and (provenance ? 'schema' or provenance ? 'schema_version')
    )
  );

alter table public.assets drop constraint assets_kind_media;
alter table public.assets add constraint assets_kind_media check (
  (kind in ('brief','beat','narration_script','critique','plan','story_blueprint','composite')
     and media = 'data')
  or (kind in ('anchor','keyframe','poster') and media = 'image')
  or (kind = 'audio_track' and media = 'audio')
  or (kind = 'clip' and media = 'video')
  or (kind in ('source_footage','render') and media <> 'data')
);

create or replace function public.assets_set_ref()
returns trigger
language plpgsql
as $$
begin
  if new.ref is null then
    new.ref :=
      case new.kind
        when 'source_footage'   then 'src'
        when 'brief'            then 'brief'
        when 'beat'             then 'beat'
        when 'anchor'           then 'anc'
        when 'keyframe'         then 'kf'
        when 'clip'             then 'clip'
        when 'audio_track'      then 'aud'
        when 'narration_script' then 'narr'
        when 'critique'         then 'crit'
        when 'plan'             then 'plan'
        when 'story_blueprint'  then 'story'
        when 'composite'        then 'cut'
        when 'render'           then 'rend'
        when 'poster'           then 'poster'
      end || '_' || substr(md5(gen_random_uuid()::text), 1, 6);
  end if;
  return new;
end;
$$;

create or replace function public.validate_story_blueprint_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_workspace_id uuid;
  v_asset_project_id uuid;
  v_asset_workspace_id uuid;
  v_brief_project_id uuid;
  v_brief_workspace_id uuid;
begin
  select p.workspace_id into v_project_workspace_id
  from public.projects p
  where p.id = new.project_id;

  if v_project_workspace_id is null then
    raise exception 'story blueprint project does not exist (%)', new.project_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_project_workspace_id is distinct from new.workspace_id then
    raise exception 'story blueprint project workspace % does not match row workspace %',
      v_project_workspace_id, new.workspace_id
      using errcode = 'check_violation';
  end if;

  if new.asset_id is not null then
    select a.project_id, a.workspace_id into v_asset_project_id, v_asset_workspace_id
    from public.assets a
    where a.id = new.asset_id;

    if v_asset_project_id is null then
      raise exception 'story blueprint asset does not exist (%)', new.asset_id
        using errcode = 'foreign_key_violation';
    end if;

    if v_asset_project_id is distinct from new.project_id
       or v_asset_workspace_id is distinct from new.workspace_id then
      raise exception 'story blueprint asset scope does not match row scope'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.brief_asset_id is not null then
    select a.project_id, a.workspace_id into v_brief_project_id, v_brief_workspace_id
    from public.assets a
    where a.id = new.brief_asset_id;

    if v_brief_project_id is null then
      raise exception 'story blueprint brief asset does not exist (%)', new.brief_asset_id
        using errcode = 'foreign_key_violation';
    end if;

    if v_brief_project_id is distinct from new.project_id
       or v_brief_workspace_id is distinct from new.workspace_id then
      raise exception 'story blueprint brief asset scope does not match row scope'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_story_blueprint_refs() from public;

create trigger story_blueprints_validate_refs
  before insert or update of workspace_id, project_id, asset_id, brief_asset_id on public.story_blueprints
  for each row execute function public.validate_story_blueprint_refs();

create or replace function public.validate_story_blueprint_child_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_project_id uuid;
  v_parent_workspace_id uuid;
  v_act_blueprint_id uuid;
begin
  select b.project_id, b.workspace_id into v_parent_project_id, v_parent_workspace_id
  from public.story_blueprints b
  where b.id = new.story_blueprint_id;

  if v_parent_project_id is null then
    raise exception 'story blueprint parent does not exist (%)', new.story_blueprint_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_parent_project_id is distinct from new.project_id
     or v_parent_workspace_id is distinct from new.workspace_id then
    raise exception 'story blueprint child scope does not match parent scope'
      using errcode = 'check_violation';
  end if;

  if TG_TABLE_NAME = 'story_blueprint_scenes' then
    select a.story_blueprint_id into v_act_blueprint_id
    from public.story_blueprint_acts a
    where a.id = new.story_blueprint_act_id;

    if v_act_blueprint_id is distinct from new.story_blueprint_id then
      raise exception 'story blueprint scene act does not belong to the same blueprint'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_story_blueprint_child_refs() from public;

create trigger story_blueprint_characters_validate_refs
  before insert or update of story_blueprint_id, workspace_id, project_id
  on public.story_blueprint_characters
  for each row execute function public.validate_story_blueprint_child_refs();
create trigger story_blueprint_acts_validate_refs
  before insert or update of story_blueprint_id, workspace_id, project_id
  on public.story_blueprint_acts
  for each row execute function public.validate_story_blueprint_child_refs();
create trigger story_blueprint_scenes_validate_refs
  before insert or update of story_blueprint_id, story_blueprint_act_id, workspace_id, project_id
  on public.story_blueprint_scenes
  for each row execute function public.validate_story_blueprint_child_refs();

alter table public.story_blueprints enable row level security;
alter table public.story_blueprint_characters enable row level security;
alter table public.story_blueprint_acts enable row level security;
alter table public.story_blueprint_scenes enable row level security;

create policy story_blueprints_owner on public.story_blueprints
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

create policy story_blueprints_public_read on public.story_blueprints
  for select to anon, authenticated
  using (public.project_is_public(project_id));

create policy story_blueprint_characters_owner on public.story_blueprint_characters
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy story_blueprint_characters_public_read on public.story_blueprint_characters
  for select to anon, authenticated
  using (public.project_is_public(project_id));

create policy story_blueprint_acts_owner on public.story_blueprint_acts
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy story_blueprint_acts_public_read on public.story_blueprint_acts
  for select to anon, authenticated
  using (public.project_is_public(project_id));

create policy story_blueprint_scenes_owner on public.story_blueprint_scenes
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy story_blueprint_scenes_public_read on public.story_blueprint_scenes
  for select to anon, authenticated
  using (public.project_is_public(project_id));
