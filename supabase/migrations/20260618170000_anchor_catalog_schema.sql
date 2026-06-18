-- Anchor Catalog PR1: publication/discovery schema only.
-- API publish/use flows enforce source ownership and materialize public bytes.

create type public.catalog_entry_kind as enum ('character', 'story', 'image');
create type public.catalog_entry_status as enum ('draft', 'published', 'archived');

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

  constraint catalog_entries_use_count_nonnegative check (use_count >= 0),
  constraint catalog_entry_source_by_kind check (
    (kind in ('character', 'image') and source_story_blueprint_id is null)
    or (kind = 'story' and source_asset_id is null)
  )
);

create trigger catalog_entries_set_updated_at
  before update on public.catalog_entries
  for each row execute function public.set_updated_at();

create index catalog_entries_published_feed_idx
  on public.catalog_entries (created_at desc)
  where status = 'published';

create index catalog_entries_kind_idx
  on public.catalog_entries (kind)
  where status = 'published';

create index catalog_entries_publisher_idx
  on public.catalog_entries (publisher_user_id);

create index catalog_entries_search_idx
  on public.catalog_entries
  using gin (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      array_to_string(tags, ' ') || ' ' ||
      coalesce(snapshot ->> 'searchText', '')
    )
  )
  where status = 'published';

alter table public.catalog_entries enable row level security;

create policy catalog_entries_public_read on public.catalog_entries
  for select to anon, authenticated
  using (status = 'published');

create policy catalog_entries_owner on public.catalog_entries
  for all to authenticated
  using (publisher_user_id = (select public.current_app_user_id()))
  with check (publisher_user_id = (select public.current_app_user_id()));
