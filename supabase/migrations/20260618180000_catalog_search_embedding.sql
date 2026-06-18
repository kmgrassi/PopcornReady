-- Semantic search for the anchor catalog.
--
-- Adds a catalog-OWNED search vector, built at publish by embedding only the
-- entry's curated public text (title/summary/tags + snapshot.searchText). We do
-- NOT copy the source asset's embedding: that vector encodes private prompt
-- intent / context / semantic-analysis the catalog never exposes, so ranking on
-- it could surface an entry via private terms absent from the public card.
-- Querying this catalog-owned column needs no asset/project join, so private-
-- source anchors stay searchable with no visibility leak. Type/dimension match
-- public.asset_embeddings (extensions.vector(1536)).

create extension if not exists vector with schema extensions;

alter table public.catalog_entries
  add column if not exists search_embedding extensions.vector(1536),
  add column if not exists search_model      text,
  add column if not exists search_dims       integer;

-- ANN index deferred to match public.asset_embeddings (which also ships without
-- one); exact cosine scan is fine for the launch-size catalog. A later PR adds:
--   create index catalog_entries_embedding_idx on public.catalog_entries
--     using hnsw (search_embedding extensions.vector_cosine_ops)
--     where status = 'published';

-- Replace the full-text-only RPC with a hybrid one. The two new params default
-- to null, so callers that omit them (e.g. an older API build mid-deploy) still
-- get the original full-text behavior.
drop function if exists public.search_public_catalog_entries(
  text, public.catalog_entry_kind, integer, integer
);

create or replace function public.search_public_catalog_entries(
  search_query text,
  kind_filter public.catalog_entry_kind default null,
  limit_count integer default 51,
  offset_count integer default 0,
  query_embedding text default null,
  query_model text default null
)
returns setof public.catalog_entries
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select
      nullif(btrim(coalesce(search_query, '')), '') as qtext,
      case
        when query_embedding is null or btrim(query_embedding) = '' then null
        else query_embedding::extensions.vector(1536)
      end as qvec
  )
  select e.*
  from public.catalog_entries e
  cross join q
  where e.status = 'published'
    and (kind_filter is null or e.kind = kind_filter)
    -- With a query vector we rank (not hard-filter) so semantically-close entries
    -- surface even without a keyword match. Without one, fall back to full-text.
    and (
      q.qvec is not null
      or q.qtext is null
      or to_tsvector('english',
           coalesce(e.title, '') || ' ' || coalesce(e.summary, '') || ' ' ||
           public.catalog_entry_tags_search_text(e.tags) || ' ' ||
           coalesce(e.snapshot ->> 'searchText', '')
         ) @@ plainto_tsquery('english', q.qtext)
    )
  order by
    -- Semantic distance first when we have a query vector and a comparable
    -- (same-model) entry vector; entries without one sort last.
    case
      when q.qvec is not null
       and e.search_embedding is not null
       and (query_model is null or e.search_model = query_model)
      then e.search_embedding <=> q.qvec
    end asc nulls last,
    -- Then lexical relevance, then recency.
    case
      when q.qtext is not null
      then ts_rank_cd(
        to_tsvector('english',
          coalesce(e.title, '') || ' ' || coalesce(e.summary, '') || ' ' ||
          public.catalog_entry_tags_search_text(e.tags) || ' ' ||
          coalesce(e.snapshot ->> 'searchText', '')),
        plainto_tsquery('english', q.qtext))
    end desc nulls last,
    e.created_at desc, e.id desc
  limit greatest(1, least(limit_count, 101))
  offset greatest(0, offset_count)
$$;

revoke all on function public.search_public_catalog_entries(
  text, public.catalog_entry_kind, integer, integer, text, text
) from public;
grant execute on function public.search_public_catalog_entries(
  text, public.catalog_entry_kind, integer, integer, text, text
) to anon, authenticated, service_role;
