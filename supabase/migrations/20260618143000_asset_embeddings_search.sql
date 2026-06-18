-- Asset embedding search projection.
--
-- This is intentionally separate from the immutable asset graph: embeddings are
-- rebuildable search indexes, not provenance.

create extension if not exists vector with schema extensions;

create unique index if not exists projects_workspace_id_id_unique
  on public.projects (workspace_id, id);

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
  constraint asset_embeddings_chunk_key_check check (length(trim(chunk_key)) > 0),
  constraint asset_embeddings_chunk_kind_check check (length(trim(chunk_kind)) > 0),
  constraint asset_embeddings_model_check check (length(trim(embedding_model)) > 0),
  unique (asset_id, chunk_key, embedding_model)
);

create trigger asset_embeddings_set_updated_at
  before update on public.asset_embeddings
  for each row execute function public.set_updated_at();

create index asset_embeddings_project_model_idx
  on public.asset_embeddings (workspace_id, project_id, embedding_model, asset_id);

create index asset_embeddings_asset_idx
  on public.asset_embeddings (asset_id);

alter table public.asset_embeddings enable row level security;

create policy asset_embeddings_owner on public.asset_embeddings
  for all
  using (public.owns_workspace(workspace_id) and public.owns_project(project_id))
  with check (public.owns_workspace(workspace_id) and public.owns_project(project_id));

-- Public discovery gets its own later RPC. Keep the first search path scoped to
-- the authenticated workspace/project API.
create or replace function public.search_project_asset_embeddings(
  p_workspace_id uuid,
  p_project_id uuid,
  p_query text,
  p_query_embedding text,
  p_embedding_model text default null,
  p_media_filter public.asset_media default null,
  p_kind_filter public.graph_asset_kind default null,
  p_role_filter text default null,
  p_match_count integer default 20
)
returns table (
  id uuid,
  schema_version text,
  workspace_id uuid,
  project_id uuid,
  kind public.graph_asset_kind,
  media public.asset_media,
  status text,
  role text,
  filename text,
  content jsonb,
  params jsonb,
  inputs jsonb,
  content_hash text,
  inputs_fingerprint text,
  remote_url text,
  storage_key text,
  storage_bucket text,
  source jsonb,
  duration_sec double precision,
  description text,
  context jsonb,
  semantic_analysis jsonb,
  created_by_action_id uuid,
  visibility text,
  created_at timestamptz,
  updated_at timestamptz,
  embedding_id uuid,
  chunk_key text,
  chunk_kind text,
  embedding_model text,
  source_hash text,
  source_text text,
  vector_score double precision,
  text_score double precision,
  hybrid_score double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with query_input as (
    select
      trim(coalesce(p_query, '')) as query_text,
      p_query_embedding::extensions.vector(1536) as query_embedding,
      greatest(1, least(coalesce(p_match_count, 20), 100)) as match_count
  ),
  ranked_chunks as (
    select
      a.*,
      e.id as embedding_id,
      e.chunk_key,
      e.chunk_kind,
      e.embedding_model,
      e.source_hash,
      e.source_text,
      1 - (e.embedding <=> qi.query_embedding) as vector_score,
      case
        when qi.query_text = '' then 0::double precision
        else ts_rank_cd(
          to_tsvector(
            'english',
            coalesce(a.description, '') || ' ' ||
            coalesce(a.content ->> 'summary', '') || ' ' ||
            coalesce(a.context ->> 'summary', '') || ' ' ||
            coalesce(a.context #>> '{context,summary}', '') || ' ' ||
            coalesce(a.context #>> '{agentContext,summary}', '') || ' ' ||
            coalesce(a.context #>> '{clipUnderstanding,combinedSummary}', '') || ' ' ||
            coalesce(a.context #>> '{context,transcriptText}', '') || ' ' ||
            coalesce(a.semantic_analysis::text, '') || ' ' ||
            coalesce(e.source_text, '')
          ),
          plainto_tsquery('english', qi.query_text)
        )::double precision
      end as text_score
    from query_input qi
    join public.asset_embeddings e
      on e.workspace_id = p_workspace_id
     and e.project_id = p_project_id
    join public.assets a
      on a.id = e.asset_id
     and a.project_id = e.project_id
     and a.workspace_id = e.workspace_id
    join public.projects p
      on p.id = a.project_id
     and p.workspace_id = a.workspace_id
    where p.status <> 'deleted'
      and a.status = 'ready'
      and (p_embedding_model is null or e.embedding_model = p_embedding_model)
      and (p_media_filter is null or a.media = p_media_filter)
      and (p_kind_filter is null or a.kind = p_kind_filter)
      and (p_role_filter is null or a.role = p_role_filter)
      and (
        coalesce(auth.role(), '') = 'service_role'
        or (public.owns_workspace(p_workspace_id) and public.owns_project(p_project_id))
      )
  ),
  ranked as (
    select distinct on (ranked_chunks.id)
      ranked_chunks.*,
      (ranked_chunks.vector_score * 0.75 + least(ranked_chunks.text_score, 1) * 0.25)
        as hybrid_score
    from ranked_chunks
    order by
      ranked_chunks.id,
      (ranked_chunks.vector_score * 0.75 + least(ranked_chunks.text_score, 1) * 0.25) desc,
      ranked_chunks.vector_score desc,
      ranked_chunks.updated_at desc
  )
  select
    ranked.id,
    ranked.schema_version,
    ranked.workspace_id,
    ranked.project_id,
    ranked.kind,
    ranked.media,
    ranked.status::text,
    ranked.role,
    ranked.filename,
    ranked.content,
    ranked.params,
    ranked.inputs,
    ranked.content_hash,
    ranked.inputs_fingerprint,
    ranked.remote_url,
    ranked.storage_key,
    ranked.storage_bucket,
    ranked.source,
    ranked.duration_sec,
    ranked.description,
    ranked.context,
    ranked.semantic_analysis,
    ranked.created_by_action_id,
    ranked.visibility::text,
    ranked.created_at,
    ranked.updated_at,
    ranked.embedding_id,
    ranked.chunk_key,
    ranked.chunk_kind,
    ranked.embedding_model,
    ranked.source_hash,
    ranked.source_text,
    ranked.vector_score,
    ranked.text_score,
    ranked.hybrid_score
  from ranked
  order by hybrid_score desc, ranked.vector_score desc, ranked.updated_at desc, ranked.id desc
  limit (select match_count from query_input)
$$;

revoke all on function public.search_project_asset_embeddings(
  uuid,
  uuid,
  text,
  text,
  text,
  public.asset_media,
  public.graph_asset_kind,
  text,
  integer
) from public;
grant execute on function public.search_project_asset_embeddings(
  uuid,
  uuid,
  text,
  text,
  text,
  public.asset_media,
  public.graph_asset_kind,
  text,
  integer
) to authenticated, service_role;
