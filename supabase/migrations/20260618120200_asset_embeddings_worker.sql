-- Asset embedding worker support.
--
-- The canonical public.asset_embeddings table, owner policy, and updated-at
-- trigger live in 20260618120000_asset_embeddings.sql. This migration only adds
-- the worker's net-new objects: the embedding job type, perf indexes, and the
-- visibility-scoped public-read policy. (Consolidated from a parallel migration
-- that re-created the table at a colliding version.)

do $$
begin
  alter type public.job_type add value if not exists 'asset_embedding';
exception
  when duplicate_object then null;
end $$;

create index if not exists asset_embeddings_project_idx
  on public.asset_embeddings (workspace_id, project_id);

create index if not exists asset_embeddings_asset_idx
  on public.asset_embeddings (asset_id);

create index if not exists asset_embeddings_model_hash_idx
  on public.asset_embeddings (embedding_model, source_hash);

drop policy if exists asset_embeddings_public_read on public.asset_embeddings;
create policy asset_embeddings_public_read on public.asset_embeddings
  for select to anon, authenticated
  using (public.asset_is_effectively_public(asset_id));
