-- Inspiration posters now live in one DB-generated system project per generated
-- story concept instead of the single shared Inspiration Poster Cache project.
-- Keep the safety checks for poster assets, but allow any project owned by the
-- seeded system workspace.

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

  if v_asset_workspace_id <> '00000000-0000-4000-a000-000000000002'::uuid then
    raise exception 'story concept poster asset must belong to the system workspace'
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

comment on table public.story_concept_posters is
  'Reusable poster generations for a global story_concept. Poster image bytes live in normal project-scoped assets, using one system-owned project per generated concept.';
comment on column public.story_concept_posters.poster_asset_id is
  'Ready poster image asset for this concept. Expected to be a public poster image in a system-owned Inspiration project.';
