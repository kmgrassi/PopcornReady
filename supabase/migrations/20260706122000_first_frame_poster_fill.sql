-- Fill an empty project poster slot from an uploaded video's first-frame image.
--
-- The first-frame image is a normal image asset with an input edge back to the
-- source video: inputs contains { relation: "input", role: "first_frame_of" }.
-- This function is intentionally CAS-like: the first finisher that sees an
-- empty poster slot wins, and later finishers leave the user's/generated poster
-- selection untouched.

create or replace function public.select_empty_project_poster_from_first_frame(
  p_project_id uuid,
  p_asset_id uuid,
  p_set_by_action_id uuid default null
)
returns boolean
language plpgsql
as $$
declare
  v_ready_first_frame boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project_id::text || ':poster', 0));

  select exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and a.project_id = p_project_id
      and a.media = 'image'::public.asset_media
      and a.status = 'ready'::public.asset_status
      and exists (
        select 1
        from jsonb_array_elements(a.inputs) input
        where input->>'relation' = 'input'
          and input->>'role' = 'first_frame_of'
      )
  ) into v_ready_first_frame;

  if not v_ready_first_frame then
    raise exception 'Asset % is not a ready first-frame image in project %', p_asset_id, p_project_id
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.current_selections s
    where s.project_id = p_project_id
      and s.slot_owner_lineage_id is null
      and s.slot_role = 'poster'
  ) then
    return false;
  end if;

  insert into public.selections (
    project_id,
    slot_owner_lineage_id,
    slot_role,
    active_asset_id,
    set_by_action_id
  ) values (
    p_project_id,
    null,
    'poster',
    p_asset_id,
    p_set_by_action_id
  );

  return true;
end;
$$;

comment on function public.select_empty_project_poster_from_first_frame(uuid, uuid, uuid)
  is 'Atomically selects a ready first-frame image as the project poster only when the project-scoped poster slot is empty.';
