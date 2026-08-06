-- Let the least-privilege API health probe compare its immutable build
-- migration set with Supabase's applied migration ledger. The role receives no
-- statements, names, timestamps, mutation privileges, or table-wide grant.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'popcorn_api') then
    grant usage on schema supabase_migrations to popcorn_api;
    revoke all on table supabase_migrations.schema_migrations from popcorn_api;
    grant select (version)
      on table supabase_migrations.schema_migrations to popcorn_api;
  end if;
end;
$$;
