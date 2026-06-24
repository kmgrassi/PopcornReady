-- The fixed Inspiration Poster Cache project was used before Inspiration
-- posters moved to one DB-generated system project per concept. Keep the row
-- for legacy asset references, but hide it from public project discovery so
-- /p/<id> does not look like a real user-facing project.

update public.projects
set
  name = 'Legacy Inspiration Poster Cache',
  slug = 'legacy-inspiration-poster-cache',
  visibility = 'private',
  updated_at = now()
where id = '00000000-0000-4000-a000-000000000003'::uuid
  and workspace_id = '00000000-0000-4000-a000-000000000002'::uuid;
