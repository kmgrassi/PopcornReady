begin;

-- Script review locks both active pointers so the least-privilege API role can
-- reject a stale outline/script pair before approving or requesting changes.
grant select (current_story_blueprint_id)
  on table public.projects to popcorn_api;
grant select (story_blueprint_id)
  on table public.script_drafts to popcorn_api;

commit;
