-- Global story concept cache for Inspiration combinations and reusable posters.
--
-- A concept is the canonical combination of selected story_elements, e.g.
-- plot + setting + arc. We do not pre-materialize the whole combinatorial space;
-- rows are created lazily when a user sees/generates a combination. Posters stay
-- first-class assets in a stable system-owned project, while these tables provide
-- the global uniqueness key so a later user with the same combination can reuse
-- the existing poster.

set check_function_bodies = off;

-- Stable system project that owns globally reusable Inspiration posters. The
-- system publisher user/workspace are seeded in 20260620180000_system_publisher.
insert into public.projects (id, workspace_id, name, status, visibility, slug)
values (
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000002',
  'Inspiration Poster Cache',
  'active',
  'public',
  'inspiration-poster-cache'
)
on conflict (id) do nothing;

create table public.story_concepts (
  id                   uuid primary key default gen_random_uuid(),
  schema_version       text not null default 'storyConcept.v1',
  concept_key          text not null,
  concept_hash         text not null,
  title                text,
  formula              text,
  logline              text,
  status               text not null default 'draft'
    check (status in ('draft', 'ready', 'archived')),
  created_by_action_id uuid references public.actions(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (concept_key),
  unique (concept_hash)
);

create index story_concepts_status_idx on public.story_concepts(status, created_at desc);
create index story_concepts_search_idx on public.story_concepts
  using gin (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(logline, '') || ' ' || coalesce(formula, '')));

create trigger story_concepts_set_updated_at
  before update on public.story_concepts
  for each row execute function public.set_updated_at();

comment on table public.story_concepts is
  'Global, lazily materialized cache key for reusable story-element combinations such as plot + setting + arc.';
comment on column public.story_concepts.concept_key is
  'Deterministic readable key built from sorted role/category/element slugs.';
comment on column public.story_concepts.concept_hash is
  'Deterministic hash of the canonical concept payload; used for compact lookup and idempotency.';

create table public.story_concept_elements (
  id               uuid primary key default gen_random_uuid(),
  story_concept_id uuid not null references public.story_concepts(id) on delete cascade,
  story_element_id uuid not null references public.story_elements(id) on delete restrict,
  role             text not null check (
    role in ('plot', 'setting', 'arc', 'belief_shift', 'structure', 'theme', 'stakes', 'genre', 'tone', 'pov', 'antagonist_type')
  ),
  position         integer not null default 0 check (position >= 0),
  created_at       timestamptz not null default now(),
  unique (story_concept_id, role, position),
  unique (story_concept_id, story_element_id, role)
);

create index story_concept_elements_concept_idx on public.story_concept_elements(story_concept_id, role, position);
create index story_concept_elements_element_idx on public.story_concept_elements(story_element_id);

comment on table public.story_concept_elements is
  'Relational selected story_elements that define a reusable story_concept combination.';

create table public.story_concept_posters (
  id                   uuid primary key default gen_random_uuid(),
  story_concept_id     uuid not null references public.story_concepts(id) on delete cascade,
  poster_asset_id      uuid references public.assets(id) on delete set null,
  prompt               text not null,
  prompt_hash          text not null,
  provider             text,
  model                text,
  variant_label        text,
  is_primary           boolean not null default true,
  status               text not null default 'queued'
    check (status in ('queued', 'generating', 'ready', 'failed')),
  error                jsonb,
  created_by_action_id uuid references public.actions(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint story_concept_posters_ready_asset check (
    status <> 'ready' or poster_asset_id is not null
  ),
  constraint story_concept_posters_error_shape check (
    error is null or jsonb_typeof(error) = 'object'
  )
);

create index story_concept_posters_concept_idx on public.story_concept_posters(story_concept_id, created_at desc);
create index story_concept_posters_asset_idx on public.story_concept_posters(poster_asset_id);
create index story_concept_posters_status_idx on public.story_concept_posters(status, created_at desc);
create unique index story_concept_posters_generation_key_idx
  on public.story_concept_posters (
    story_concept_id,
    prompt_hash,
    coalesce(provider, ''),
    coalesce(model, '')
  );
create unique index story_concept_posters_primary_idx
  on public.story_concept_posters(story_concept_id)
  where is_primary;

create trigger story_concept_posters_set_updated_at
  before update on public.story_concept_posters
  for each row execute function public.set_updated_at();

comment on table public.story_concept_posters is
  'Reusable poster generations for a global story_concept. The image bytes live in assets, usually under the system Inspiration Poster Cache project.';
comment on column public.story_concept_posters.poster_asset_id is
  'Ready poster image asset for this concept. Expected to be a public poster image in the system Inspiration Poster Cache project.';

create or replace function public.validate_story_concept_element_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_slug text;
begin
  select c.slug into v_category_slug
  from public.story_elements e
  join public.story_element_categories c on c.id = e.category_id
  where e.id = new.story_element_id;

  if v_category_slug is null then
    raise exception 'story concept element does not exist (%)', new.story_element_id
      using errcode = 'foreign_key_violation';
  end if;

  if (new.role = 'plot' and v_category_slug <> 'plot_type')
     or (new.role = 'setting' and v_category_slug <> 'setting')
     or (new.role = 'arc' and v_category_slug <> 'character_arc')
     or (new.role = 'belief_shift' and v_category_slug <> 'belief_shift')
     or (new.role = 'structure' and v_category_slug <> 'structure')
     or (new.role = 'theme' and v_category_slug <> 'theme')
     or (new.role = 'stakes' and v_category_slug <> 'stakes')
     or (new.role = 'genre' and v_category_slug <> 'genre')
     or (new.role = 'tone' and v_category_slug <> 'tone')
     or (new.role = 'pov' and v_category_slug <> 'pov')
     or (new.role = 'antagonist_type' and v_category_slug <> 'antagonist_type') then
    raise exception 'story concept role % does not match story element category %',
      new.role, v_category_slug
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_story_concept_element_refs() from public;

create trigger story_concept_elements_validate_refs
  before insert or update of story_element_id, role
  on public.story_concept_elements
  for each row execute function public.validate_story_concept_element_refs();

create or replace function public.validate_story_concept_poster_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_project_id uuid;
  v_asset_workspace_id uuid;
  v_asset_kind public.graph_asset_kind;
  v_asset_media public.asset_media;
  v_asset_visibility public.visibility;
begin
  if new.poster_asset_id is null then
    return new;
  end if;

  select a.project_id, a.workspace_id, a.kind, a.media, a.visibility
  into v_asset_project_id, v_asset_workspace_id, v_asset_kind, v_asset_media, v_asset_visibility
  from public.assets a
  where a.id = new.poster_asset_id;

  if v_asset_project_id is null then
    raise exception 'story concept poster asset does not exist (%)', new.poster_asset_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_asset_workspace_id <> '00000000-0000-4000-a000-000000000002'::uuid
     or v_asset_project_id <> '00000000-0000-4000-a000-000000000003'::uuid then
    raise exception 'story concept poster asset must belong to the system Inspiration Poster Cache project'
      using errcode = 'check_violation';
  end if;

  if v_asset_kind <> 'poster'::public.graph_asset_kind or v_asset_media <> 'image'::public.asset_media then
    raise exception 'story concept poster asset must be a poster image asset'
      using errcode = 'check_violation';
  end if;

  if v_asset_visibility <> 'public'::public.visibility then
    raise exception 'story concept poster asset must be public'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_story_concept_poster_refs() from public;

create trigger story_concept_posters_validate_refs
  before insert or update of poster_asset_id
  on public.story_concept_posters
  for each row execute function public.validate_story_concept_poster_refs();

alter table public.story_concepts enable row level security;
alter table public.story_concept_elements enable row level security;
alter table public.story_concept_posters enable row level security;

-- These are global public inspiration/catalog cache rows. Writes are performed
-- by trusted API/service-role code; clients can read them to reuse generated
-- concepts and posters.
create policy story_concepts_public_read on public.story_concepts
  for select to anon, authenticated using (status <> 'archived');
create policy story_concept_elements_public_read on public.story_concept_elements
  for select to anon, authenticated using (
    exists (
      select 1 from public.story_concepts c
      where c.id = story_concept_id and c.status <> 'archived'
    )
  );
create policy story_concept_posters_public_read on public.story_concept_posters
  for select to anon, authenticated using (
    exists (
      select 1 from public.story_concepts c
      where c.id = story_concept_id and c.status <> 'archived'
    )
  );
