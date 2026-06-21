-- AI-generated name + slug metadata for assets and projects.
--
-- The generating agent now supplies a human display `name` and a stable, lowercase
-- `slug` as part of the tool call that produces an asset (or a project). The slug
-- is a first-class, project-scoped handle the agent can reference assets by — e.g.
-- "homeowner" instead of a bare uuid. This turns the previous slug<->uuid mismatch
-- (see 20260620* / the character-anchor `provider_failed` fix) into a real feature:
-- `getAssetRow` resolves a non-uuid reference by (project_id, slug).
--
-- `name` is display metadata (mutable). `slug` is an identity handle: set once by
-- the app at insert, then immutable (null -> value allowed once, like content_hash).

-- ---------------------------------------------------------------------------
-- Assets: name (display) + slug (resolvable handle)
-- ---------------------------------------------------------------------------
alter table public.assets add column if not exists name text;
alter table public.assets add column if not exists slug text;

comment on column public.assets.name is
  'Human-facing display name, written by the generating agent (falls back to a derived name).';
comment on column public.assets.slug is
  'Stable, project-scoped, lowercase handle written by the generating agent. Agents may reference an asset by (project, slug); resolved in getAssetRow. Immutable once set.';

-- One slug per project (when present). Partial so legacy rows without a slug coexist.
create unique index if not exists assets_project_slug_idx
  on public.assets (project_id, slug)
  where slug is not null;

-- ---------------------------------------------------------------------------
-- Projects: slug (resolvable handle; `name` already exists)
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists slug text;

comment on column public.projects.slug is
  'Stable, workspace-scoped, lowercase handle written by the generating agent. Immutable once set.';

create unique index if not exists projects_workspace_slug_idx
  on public.projects (workspace_id, slug)
  where slug is not null;

-- ---------------------------------------------------------------------------
-- Keep the asset slug immutable once set (it is an identity handle, like `ref`).
-- `name` stays mutable (display). Re-create the guard to add the slug check.
-- ---------------------------------------------------------------------------
create or replace function public.assets_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.kind                    is distinct from old.kind
     or new.media                is distinct from old.media
     or new.ref                  is distinct from old.ref
     or new.lineage_id           is distinct from old.lineage_id
     or new.version              is distinct from old.version
     or new.role                 is distinct from old.role
     or new.content              is distinct from old.content
     or new.params               is distinct from old.params
     or new.inputs               is distinct from old.inputs
     or new.inputs_fingerprint   is distinct from old.inputs_fingerprint
     or new.project_id           is distinct from old.project_id
     or new.workspace_id         is distinct from old.workspace_id
     or new.source               is distinct from old.source
     or new.created_by_action_id is distinct from old.created_by_action_id
     or (old.content_hash is not null
         and new.content_hash is distinct from old.content_hash)
     or (old.slug is not null
         and new.slug is distinct from old.slug)
  then
    raise exception 'asset semantic fields are immutable — insert a new version'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
