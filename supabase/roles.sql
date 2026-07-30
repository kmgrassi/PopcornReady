-- Global role bootstrap used by `supabase db reset` before database migrations.
-- Production already provisions this LOGIN role with its password out of band;
-- the local role is intentionally NOLOGIN and is exercised through SET ROLE.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'popcorn_api') then
    create role popcorn_api
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls
      connection limit 10;
  end if;
end;
$$;
