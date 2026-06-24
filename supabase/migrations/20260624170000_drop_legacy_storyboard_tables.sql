-- Story spine unification, PR 3: destructive cleanup.
--
-- PRs 1 and 2 moved the live paths onto:
--   story_blueprints -> story_blueprint_scenes -> story_beats -> story_panels
--
-- The search projections were repointed in 20260624162000. This migration only
-- removes the retired legacy table family left behind by the additive backfill.

drop table if exists public.storyboard_panels;
drop table if exists public.storyboard_beats;
drop table if exists public.storyboard_scenes;
drop table if exists public.storyboards;
drop function if exists public.storyboard_beats_require_snapshot();
