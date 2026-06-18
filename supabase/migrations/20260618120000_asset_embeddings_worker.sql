-- Asset embeddings projection and queue support.
--
-- Embeddings are derived search indexes beside the immutable asset graph. They
-- are rebuildable from typed source chunks and are not provenance records.

create extension if not exists vector with schema extensions;

do $$
begin
  alter type public.job_type add value if not exists 'asset_embedding';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.projects
    add constraint projects_workspace_id_id_key unique (workspace_id, id);
exception
  when duplicate_object then null;
end $$;

create table public.asset_embeddings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  asset_id uuid not null,
  chunk_key text not null,
  chunk_kind text not null,
  embedding_model text not null,
  embedding_dimensions integer not null,
  source_hash text not null,
  source_text text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_embeddings_workspace_fk foreign key (workspace_id)
    references public.workspaces(id) on delete cascade,
  constraint asset_embeddings_project_fk foreign key (workspace_id, project_id)
    references public.projects(workspace_id, id) on delete cascade,
  constraint asset_embeddings_asset_fk foreign key (project_id, asset_id)
    references public.assets(project_id, id) on delete cascade,
  constraint asset_embeddings_dimensions_check check (embedding_dimensions = 1536),
  constraint asset_embeddings_chunk_kind_check check (chunk_kind in (
    'asset_summary',
    'transcript',
    'planning'
  )),
  unique (asset_id, chunk_key, embedding_model)
);

create index asset_embeddings_project_idx
  on public.asset_embeddings (workspace_id, project_id);

create index asset_embeddings_asset_idx
  on public.asset_embeddings (asset_id);

create index asset_embeddings_model_hash_idx
  on public.asset_embeddings (embedding_model, source_hash);

alter table public.asset_embeddings enable row level security;

create policy asset_embeddings_owner on public.asset_embeddings
  for all using (
    public.owns_workspace(workspace_id)
    and public.owns_project(project_id)
  ) with check (
    public.owns_workspace(workspace_id)
    and public.owns_project(project_id)
  );

create policy asset_embeddings_public_read on public.asset_embeddings
  for select to anon, authenticated
  using (public.asset_is_effectively_public(asset_id));

create trigger asset_embeddings_set_updated_at
  before update on public.asset_embeddings
  for each row execute function public.set_updated_at();
