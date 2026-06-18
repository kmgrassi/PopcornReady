-- Anchor Catalog publication table.
--
-- The catalog owns its presentation snapshot and public preview object. Source
-- links are lineage only and may be nulled if the publisher deletes the source.

set check_function_bodies = off;

create type public.catalog_entry_kind as enum ('character', 'story', 'image');
create type public.catalog_entry_status as enum ('draft', 'published', 'archived');

-- array_to_string() is only STABLE, so it cannot appear directly in an index
-- expression (Postgres requires IMMUTABLE). Wrap it for the search GIN index and
-- reuse it in the search RPC so the predicate matches the indexed expression.
create or replace function public.catalog_entry_tags_search_text(input_tags text[])
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(array_to_string(input_tags, ' '), '')
$$;

create table public.catalog_entries (
  id                         uuid primary key default gen_random_uuid(),
  schema_version             text not null default 'catalogEntry.v1',
  kind                       public.catalog_entry_kind not null,
  status                     public.catalog_entry_status not null default 'published',
  publisher_user_id          uuid not null references public.users(id) on delete cascade,
  source_workspace_id        uuid references public.workspaces(id) on delete set null,
  source_project_id          uuid references public.projects(id) on delete set null,
  source_asset_id            uuid references public.assets(id) on delete set null,
  source_story_blueprint_id  uuid references public.story_blueprints(id) on delete set null,
  title                      text not null,
  summary                    text,
  tags                       text[] not null default '{}',
  preview_storage_key        text,
  preview_storage_bucket     text,
  preview_content_type       text,
  snapshot                   jsonb not null default '{}'::jsonb,
  use_count                  integer not null default 0,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint catalog_entry_source_by_kind check (
    (kind in ('character','image') and source_story_blueprint_id is null)
    or (kind = 'story' and source_asset_id is null)
  )
);

create trigger catalog_entries_set_updated_at
  before update on public.catalog_entries
  for each row execute function public.set_updated_at();

create index catalog_entries_published_feed_idx
  on public.catalog_entries (created_at desc, id desc)
  where status = 'published';
create index catalog_entries_kind_idx on public.catalog_entries (kind)
  where status = 'published';
create index catalog_entries_publisher_idx on public.catalog_entries (publisher_user_id);
create index catalog_entries_search_idx on public.catalog_entries
  using gin (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' ||
    public.catalog_entry_tags_search_text(tags) || ' ' ||
    coalesce(snapshot ->> 'searchText', '')))
  where status = 'published';

create or replace function public.search_public_catalog_entries(
  search_query text,
  kind_filter public.catalog_entry_kind default null,
  limit_count integer default 51,
  offset_count integer default 0
)
returns setof public.catalog_entries
language sql
stable
security definer
set search_path = public
as $$
  select e.*
  from public.catalog_entries e
  where e.status = 'published'
    and (kind_filter is null or e.kind = kind_filter)
    and to_tsvector(
      'english',
      coalesce(e.title, '') || ' ' || coalesce(e.summary, '') || ' ' ||
      public.catalog_entry_tags_search_text(e.tags) || ' ' ||
      coalesce(e.snapshot ->> 'searchText', '')
    ) @@ plainto_tsquery('english', search_query)
  order by e.created_at desc, e.id desc
  limit greatest(1, least(limit_count, 101))
  offset greatest(0, offset_count)
$$;
revoke all on function public.search_public_catalog_entries(
  text,
  public.catalog_entry_kind,
  integer,
  integer
) from public;
grant execute on function public.search_public_catalog_entries(
  text,
  public.catalog_entry_kind,
  integer,
  integer
) to anon, authenticated, service_role;

alter table public.catalog_entries enable row level security;

create policy catalog_entries_public_read on public.catalog_entries
  for select to anon, authenticated
  using (status = 'published');

create policy catalog_entries_owner_read on public.catalog_entries
  for select to authenticated
  using (publisher_user_id = public.current_app_user_id());

create policy catalog_entries_owner_insert on public.catalog_entries
  for insert to authenticated
  with check (publisher_user_id = public.current_app_user_id());

create policy catalog_entries_owner_update on public.catalog_entries
  for update to authenticated
  using (publisher_user_id = public.current_app_user_id())
  with check (publisher_user_id = public.current_app_user_id());

create policy catalog_entries_owner_delete on public.catalog_entries
  for delete to authenticated
  using (publisher_user_id = public.current_app_user_id());
