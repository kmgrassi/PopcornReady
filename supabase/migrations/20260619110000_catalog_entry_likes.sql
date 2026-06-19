-- Likes for public anchor catalog entries.

alter table public.catalog_entries
  add column if not exists like_count integer not null default 0;

create table if not exists public.catalog_entry_likes (
  id uuid primary key default gen_random_uuid(),
  catalog_entry_id uuid not null references public.catalog_entries(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint catalog_entry_likes_unique_user_entry unique (catalog_entry_id, user_id)
);

create index if not exists catalog_entry_likes_user_idx
  on public.catalog_entry_likes (user_id, created_at desc);
create index if not exists catalog_entry_likes_entry_idx
  on public.catalog_entry_likes (catalog_entry_id);

create or replace function public.update_catalog_entry_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.catalog_entries
      set like_count = like_count + 1
      where id = new.catalog_entry_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.catalog_entries
      set like_count = greatest(0, like_count - 1)
      where id = old.catalog_entry_id;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists catalog_entry_likes_update_count on public.catalog_entry_likes;
create trigger catalog_entry_likes_update_count
  after insert or delete on public.catalog_entry_likes
  for each row execute function public.update_catalog_entry_like_count();

drop function if exists public.search_public_catalog_entries(
  text, public.catalog_entry_kind, integer, integer, text, text
);

create or replace function public.search_public_catalog_entries(
  search_query text,
  kind_filter public.catalog_entry_kind default null,
  limit_count integer default 51,
  offset_count integer default 0,
  query_embedding text default null,
  query_model text default null
)
returns table (
  id uuid,
  schema_version text,
  kind public.catalog_entry_kind,
  status public.catalog_entry_status,
  publisher_user_id uuid,
  source_workspace_id uuid,
  source_project_id uuid,
  source_asset_id uuid,
  source_story_blueprint_id uuid,
  title text,
  summary text,
  tags text[],
  preview_storage_key text,
  preview_storage_bucket text,
  preview_content_type text,
  snapshot jsonb,
  use_count integer,
  like_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
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
  ),
  scored as (
    select
      e.*,
      case
        when q.qvec is not null
         and e.search_embedding is not null
         and (query_model is null or e.search_model = query_model)
        then 1 - (e.search_embedding <=> q.qvec)
        else 0
      end as vscore,
      case
        when q.qtext is not null
        then least(
          ts_rank_cd(
            to_tsvector('english',
              coalesce(e.title, '') || ' ' || coalesce(e.summary, '') || ' ' ||
              public.catalog_entry_tags_search_text(e.tags) || ' ' ||
              coalesce(e.snapshot ->> 'searchText', '')),
            plainto_tsquery('english', q.qtext)),
          1.0)
        else 0
      end as tscore,
      case
        when q.qtext is null then true
        else to_tsvector('english',
               coalesce(e.title, '') || ' ' || coalesce(e.summary, '') || ' ' ||
               public.catalog_entry_tags_search_text(e.tags) || ' ' ||
               coalesce(e.snapshot ->> 'searchText', ''))
             @@ plainto_tsquery('english', q.qtext)
      end as text_match
    from public.catalog_entries e
    cross join q
    where e.status = 'published'
      and (kind_filter is null or e.kind = kind_filter)
  )
  select
    s.id, s.schema_version, s.kind, s.status, s.publisher_user_id,
    s.source_workspace_id, s.source_project_id, s.source_asset_id,
    s.source_story_blueprint_id, s.title, s.summary, s.tags,
    s.preview_storage_key, s.preview_storage_bucket, s.preview_content_type,
    s.snapshot, s.use_count, s.like_count, s.created_at, s.updated_at
  from scored s
  where s.text_match or s.vscore > 0
  order by (s.vscore * 0.75 + s.tscore * 0.25) desc, s.created_at desc, s.id desc
  limit greatest(1, least(limit_count, 101))
  offset greatest(0, offset_count)
$$;

revoke all on function public.search_public_catalog_entries(
  text, public.catalog_entry_kind, integer, integer, text, text
) from public;
grant execute on function public.search_public_catalog_entries(
  text, public.catalog_entry_kind, integer, integer, text, text
) to anon, authenticated, service_role;

alter table public.catalog_entry_likes enable row level security;

create policy catalog_entry_likes_owner_read on public.catalog_entry_likes
  for select to authenticated
  using (user_id = public.current_app_user_id());

create policy catalog_entry_likes_owner_insert on public.catalog_entry_likes
  for insert to authenticated
  with check (
    user_id = public.current_app_user_id()
    and exists (
      select 1
      from public.catalog_entries e
      where e.id = catalog_entry_id
        and e.status = 'published'
    )
  );

create policy catalog_entry_likes_owner_delete on public.catalog_entry_likes
  for delete to authenticated
  using (user_id = public.current_app_user_id());
