-- Workspace-level model defaults for broad generation purposes.
--
-- These settings are non-secret routing preferences. Provider API keys stay in
-- provider_api_keys; this table only records which provider/model the workspace
-- wants to use when a request does not specify one directly.

alter type public.model_provider add value if not exists 'ideogram';

create type public.model_generation_purpose as enum (
  'image_generation',
  'video_generation',
  'audio_generation',
  'text_generation'
);

create table public.workspace_model_settings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  purpose      public.model_generation_purpose not null,
  provider     text not null check (btrim(provider) <> ''),
  model        text not null check (btrim(model) <> ''),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (workspace_id, purpose)
);

create trigger workspace_model_settings_set_updated_at
  before update on public.workspace_model_settings
  for each row execute function public.set_updated_at();

alter table public.workspace_model_settings enable row level security;

create policy workspace_model_settings_member_select on public.workspace_model_settings
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy workspace_model_settings_admin_insert on public.workspace_model_settings
  for insert to authenticated
  with check (public.is_workspace_admin(workspace_id));

create policy workspace_model_settings_admin_update on public.workspace_model_settings
  for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create policy workspace_model_settings_admin_delete on public.workspace_model_settings
  for delete to authenticated
  using (public.is_workspace_admin(workspace_id));
