-- PR 5 orchestrator cutover: retire the staged generation-run controller state.
--
-- The live run model is now public.orchestrator_runs + public.actions
-- (actions.orchestrator_run_id). This migration removes the remaining slim
-- generation_runs table and the old actions.run_id compatibility link.

set check_function_bodies = off;

-- Studio drafts keep a run pointer, but it now points at orchestrator_runs.
drop trigger if exists studio_drafts_validate_refs on public.studio_drafts;
alter table public.studio_drafts
  drop constraint if exists studio_drafts_run_id_fkey;

create or replace function public.validate_studio_draft_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_workspace_id uuid;
  v_run_project_id uuid;
  v_run_workspace_id uuid;
begin
  if new.project_id is not null then
    select p.workspace_id into v_project_workspace_id
    from public.projects p
    where p.id = new.project_id;

    if v_project_workspace_id is null then
      raise exception 'studio draft project does not exist (%)', new.project_id
        using errcode = 'foreign_key_violation';
    end if;

    if v_project_workspace_id is distinct from new.workspace_id then
      raise exception 'studio draft project workspace % does not match draft workspace %',
        v_project_workspace_id, new.workspace_id
        using errcode = 'check_violation';
    end if;
  end if;

  if new.run_id is not null then
    select r.project_id, p.workspace_id
      into v_run_project_id, v_run_workspace_id
    from public.orchestrator_runs r
    join public.projects p on p.id = r.project_id
    where r.id = new.run_id;

    if v_run_project_id is null then
      raise exception 'studio draft run does not exist (%)', new.run_id
        using errcode = 'foreign_key_violation';
    end if;

    if v_run_workspace_id is distinct from new.workspace_id then
      raise exception 'studio draft run workspace % does not match draft workspace %',
        v_run_workspace_id, new.workspace_id
        using errcode = 'check_violation';
    end if;

    if new.project_id is not null and new.project_id is distinct from v_run_project_id then
      raise exception 'studio draft project % does not match run project %',
        new.project_id, v_run_project_id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

alter table public.studio_drafts
  add constraint studio_drafts_run_id_fkey
  foreign key (run_id) references public.orchestrator_runs (id) on delete set null;

create trigger studio_drafts_validate_refs
  before insert or update of workspace_id, project_id, run_id on public.studio_drafts
  for each row execute function public.validate_studio_draft_refs();

-- Actions now link only to orchestrator_runs.
drop trigger if exists actions_guard_immutable on public.actions;

create or replace function public.actions_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.project_id      is distinct from old.project_id
     or new.orchestrator_run_id is distinct from old.orchestrator_run_id
     or new.tool         is distinct from old.tool
     or new.params       is distinct from old.params
     or new.input_asset_ids is distinct from old.input_asset_ids
     or new.rationale    is distinct from old.rationale
     or new.proposal     is distinct from old.proposal
  then
    raise exception 'action decision fields are immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger actions_guard_immutable
  before update on public.actions
  for each row execute function public.actions_guard_immutable();

drop index if exists public.actions_run_id_idx;
alter table public.actions
  drop constraint if exists actions_run_id_fkey,
  drop column if exists run_id;

drop table if exists public.generation_runs cascade;
