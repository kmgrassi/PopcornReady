-- Canonical script-draft artifacts for the orchestrator writing layer.
--
-- Story blueprints are created in 20260616121000_story_blueprints.sql. This
-- migration adds the next writing artifact while keeping first-class script
-- structure relational instead of canonical JSONB.

create table public.script_drafts (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null default 'scriptDraft.v1',
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  brief_asset_id uuid references public.assets(id) on delete set null,
  story_blueprint_id uuid not null,
  asset_id uuid references public.assets(id) on delete set null,
  supersedes_id uuid references public.script_drafts(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  -- Narrow typed summary only. First-class script structure lives in
  -- script_scenes and script_dialogue_lines below.
  content jsonb not null,
  created_by_action_id uuid references public.actions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint script_drafts_project_id_id_unique unique (project_id, id),
  constraint script_drafts_project_asset_unique unique (project_id, asset_id),
  constraint script_drafts_content_schema check (
    jsonb_typeof(content) = 'object'
    and content->>'schemaVersion' = 'scriptDraft.v1'
  ),
  constraint script_drafts_story_blueprint_fk foreign key (project_id, story_blueprint_id)
    references public.story_blueprints(project_id, id) on delete cascade,
  constraint script_drafts_asset_fk foreign key (project_id, asset_id)
    references public.assets(project_id, id),
  constraint script_drafts_brief_asset_fk foreign key (project_id, brief_asset_id)
    references public.assets(project_id, id)
);

create index script_drafts_project_id_idx
  on public.script_drafts(project_id, created_at desc);
create index script_drafts_story_blueprint_id_idx
  on public.script_drafts(story_blueprint_id);

create trigger script_drafts_set_updated_at
  before update on public.script_drafts
  for each row execute function public.set_updated_at();

create table public.script_scenes (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null default 'scriptScene.v1',
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  script_draft_id uuid not null,
  scene_key text not null,
  position integer not null check (position >= 0),
  title text not null check (btrim(title) <> ''),
  summary text not null default '',
  narration text,
  visual_intent text,
  duration_sec double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint script_scenes_project_id_id_unique unique (project_id, id),
  constraint script_scenes_draft_position_unique unique (script_draft_id, position),
  constraint script_scenes_draft_scene_key_unique unique (script_draft_id, scene_key),
  constraint script_scenes_draft_fk foreign key (project_id, script_draft_id)
    references public.script_drafts(project_id, id) on delete cascade
);

create index script_scenes_project_id_idx
  on public.script_scenes(project_id, script_draft_id, position);

create trigger script_scenes_set_updated_at
  before update on public.script_scenes
  for each row execute function public.set_updated_at();

create table public.script_dialogue_lines (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null default 'scriptDialogueLine.v1',
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  script_draft_id uuid not null,
  script_scene_id uuid not null,
  line_key text not null,
  position integer not null check (position >= 0),
  character_id text,
  character_name text,
  text text not null check (btrim(text) <> ''),
  delivery text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint script_dialogue_lines_draft_line_key_unique unique (script_draft_id, line_key),
  constraint script_dialogue_lines_scene_position_unique unique (script_scene_id, position),
  constraint script_dialogue_lines_draft_fk foreign key (project_id, script_draft_id)
    references public.script_drafts(project_id, id) on delete cascade,
  constraint script_dialogue_lines_scene_fk foreign key (project_id, script_scene_id)
    references public.script_scenes(project_id, id) on delete cascade
);

create index script_dialogue_lines_scene_id_idx
  on public.script_dialogue_lines(project_id, script_scene_id, position);

create trigger script_dialogue_lines_set_updated_at
  before update on public.script_dialogue_lines
  for each row execute function public.set_updated_at();

alter table public.projects
  add column current_script_draft_id uuid references public.script_drafts(id) on delete set null;

alter table public.script_drafts enable row level security;
alter table public.script_scenes enable row level security;
alter table public.script_dialogue_lines enable row level security;

create policy script_drafts_owner on public.script_drafts
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));
create policy script_scenes_owner on public.script_scenes
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));
create policy script_dialogue_lines_owner on public.script_dialogue_lines
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

create policy script_drafts_public_read on public.script_drafts
  for select to anon, authenticated
  using (public.project_is_public(project_id));
create policy script_scenes_public_read on public.script_scenes
  for select to anon, authenticated
  using (public.project_is_public(project_id));
create policy script_dialogue_lines_public_read on public.script_dialogue_lines
  for select to anon, authenticated
  using (public.project_is_public(project_id));
