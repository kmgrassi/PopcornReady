-- Direct rerun transactions read the semantic scene snapshot pointer, while
-- stable story identity is resolved by the service client or inside the
-- bounded security-definer application function. Keep the production role's
-- exact column grants aligned with that direct-Postgres boundary.

revoke select (stable_id)
  on table public.story_blueprint_scenes from popcorn_api;
revoke select (stable_id)
  on table public.story_beats from popcorn_api;
