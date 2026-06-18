-- Public semantic discovery over asset embeddings.
--
-- The RPC is intentionally separate from project-scoped asset search so public
-- discovery can enforce project + asset effective public visibility in SQL.

create or replace function public.search_public_asset_embeddings(
  p_query text,
  p_query_embedding text,
  p_embedding_model text,
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
      on e.embedding_model = p_embedding_model
    join public.assets a
      on a.id = e.asset_id
     and a.project_id = e.project_id
     and a.workspace_id = e.workspace_id
    join public.projects p
      on p.id = a.project_id
     and p.workspace_id = a.workspace_id
    join public.workspaces w
      on w.id = a.workspace_id
    where p.status <> 'deleted'
      and p.visibility = 'public'
      and w.purpose = 'user'
      and a.status = 'ready'
      and a.visibility = 'public'
      and a.media <> 'data'
      and (p_media_filter is null or a.media = p_media_filter)
      and (p_kind_filter is null or a.kind = p_kind_filter)
      and (p_role_filter is null or a.role = p_role_filter)
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

revoke all on function public.search_public_asset_embeddings(
  text,
  text,
  text,
  public.asset_media,
  public.graph_asset_kind,
  text,
  integer
) from public;
grant execute on function public.search_public_asset_embeddings(
  text,
  text,
  text,
  public.asset_media,
  public.graph_asset_kind,
  text,
  integer
) to anon, authenticated, service_role;
