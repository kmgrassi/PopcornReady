-- Asset embedding projection for semantic search.
--
-- This PR intentionally adds only schema support. Provider calls, enqueue
-- points, vector indexes, and search RPCs are owned by later PRs in
-- docs/scopes/asset-embeddings.md.

create extension if not exists vector with schema extensions;

alter table public.projects
  add constraint projects_workspace_id_id_unique unique (workspace_id, id);

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
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_embeddings_source_text_nonempty check (btrim(source_text) <> ''),
  constraint asset_embeddings_chunk_key_nonempty check (btrim(chunk_key) <> ''),
  constraint asset_embeddings_chunk_kind_nonempty check (btrim(chunk_kind) <> ''),
  constraint asset_embeddings_model_nonempty check (btrim(embedding_model) <> ''),
  constraint asset_embeddings_dimensions_check check (embedding_dimensions = 1536),
  constraint asset_embeddings_workspace_fk foreign key (workspace_id)
    references public.workspaces(id) on delete cascade,
  constraint asset_embeddings_project_fk foreign key (workspace_id, project_id)
    references public.projects(workspace_id, id) on delete cascade,
  constraint asset_embeddings_asset_fk foreign key (project_id, asset_id)
    references public.assets(project_id, id) on delete cascade,
  constraint asset_embeddings_asset_model_chunk_unique
    unique (asset_id, chunk_key, embedding_model)
);

create index asset_embeddings_workspace_project_idx
  on public.asset_embeddings(workspace_id, project_id);
create index asset_embeddings_asset_id_idx
  on public.asset_embeddings(asset_id);
create index asset_embeddings_source_hash_idx
  on public.asset_embeddings(source_hash);

create trigger asset_embeddings_set_updated_at
  before update on public.asset_embeddings
  for each row execute function public.set_updated_at();

alter table public.asset_embeddings enable row level security;

create policy asset_embeddings_owner on public.asset_embeddings
  for all using (public.owns_workspace(workspace_id) and public.owns_project(project_id))
  with check (public.owns_workspace(workspace_id) and public.owns_project(project_id));

comment on table public.asset_embeddings is
  'Derived semantic-search chunks for asset graph rows. Embeddings are rebuildable indexes, not provenance.';
comment on column public.asset_embeddings.source_text is
  'Typed source text used to create the embedding. Kept for debugging and deterministic rebuilds.';
comment on column public.asset_embeddings.source_hash is
  'Hash of the chunk key/kind, source text, and source-builder version.';
