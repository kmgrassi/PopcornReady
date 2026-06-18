-- script_drafts (20260617110000) adds a composite FK to
-- story_blueprints(project_id, id), which requires a matching unique constraint.
-- The original story_blueprints migration (20260616121000, already applied) only
-- declared `id` as primary key, so the composite key was missing and the FK
-- creation failed. Add it here (additive; runs before script_drafts).
--
-- `id` is already the primary key, so (project_id, id) is trivially unique on
-- existing rows — this constraint is satisfied regardless of data.

do $$
begin
  alter table public.story_blueprints
    add constraint story_blueprints_project_id_id_unique unique (project_id, id);
exception
  when duplicate_table then null;  -- constraint already exists
  when duplicate_object then null;
end $$;
