-- Least-privilege direct-Postgres access for creator-direct proposal
-- confirmation. The role stays subject to RLS and receives policies only on
-- the tables used by this transaction.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'popcorn_api') then
    execute
      'create role popcorn_api nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 10';
  end if;
end;
$$;

-- Hosted Supabase's migration role may create ordinary roles but cannot alter
-- protected role attributes. Production provisioning owns those attributes;
-- readiness below verifies that the authenticated role remains NOBYPASSRLS.

grant connect on database postgres to popcorn_api;
grant usage on schema public to popcorn_api;

revoke all on table public.projects from popcorn_api;
revoke all on table public.orchestrator_runs from popcorn_api;
revoke all on table public.orchestrator_run_gates from popcorn_api;
revoke all on table public.idempotency from popcorn_api;

grant select (id, workspace_id)
  on table public.projects to popcorn_api;
grant select (id, project_id, origin_kind, status)
  on table public.orchestrator_runs to popcorn_api;
-- PostgreSQL requires UPDATE privilege for SELECT ... FOR UPDATE. The direct
-- workflow never changes this column; the grant exists only to permit the
-- queued-run row lock.
grant update (updated_at)
  on table public.orchestrator_runs to popcorn_api;
grant select (
  id,
  orchestrator_run_id,
  subject_proposal_action_id,
  gate_kind,
  project_id,
  actor_id,
  request_digest,
  approved_max_usd,
  approval_token_hash,
  expires_at,
  token_consumed_at,
  status
) on table public.orchestrator_run_gates to popcorn_api;
grant update (status, token_consumed_at, decided_at, updated_at)
  on table public.orchestrator_run_gates to popcorn_api;
grant select (scope, key, body_hash, response_body)
  on table public.idempotency to popcorn_api;
grant insert (scope, key, body_hash, status, response_body)
  on table public.idempotency to popcorn_api;

drop policy if exists projects_popcorn_api_confirmation_select
  on public.projects;
create policy projects_popcorn_api_confirmation_select
  on public.projects for select to popcorn_api
  using (true);

drop policy if exists orchestrator_runs_popcorn_api_confirmation_select
  on public.orchestrator_runs;
create policy orchestrator_runs_popcorn_api_confirmation_select
  on public.orchestrator_runs for select to popcorn_api
  using (origin_kind = 'creator_direct');

drop policy if exists orchestrator_runs_popcorn_api_confirmation_lock
  on public.orchestrator_runs;
create policy orchestrator_runs_popcorn_api_confirmation_lock
  on public.orchestrator_runs for update to popcorn_api
  using (origin_kind = 'creator_direct')
  with check (origin_kind = 'creator_direct');

drop policy if exists orchestrator_run_gates_popcorn_api_confirmation_select
  on public.orchestrator_run_gates;
create policy orchestrator_run_gates_popcorn_api_confirmation_select
  on public.orchestrator_run_gates for select to popcorn_api
  using (gate_kind = 'creator_direct_proposal');

drop policy if exists orchestrator_run_gates_popcorn_api_confirmation_update
  on public.orchestrator_run_gates;
create policy orchestrator_run_gates_popcorn_api_confirmation_update
  on public.orchestrator_run_gates for update to popcorn_api
  using (gate_kind = 'creator_direct_proposal')
  with check (gate_kind = 'creator_direct_proposal');

drop policy if exists idempotency_popcorn_api_confirmation_select
  on public.idempotency;
create policy idempotency_popcorn_api_confirmation_select
  on public.idempotency for select to popcorn_api
  using (scope like 'creator-direct-confirm:%');

drop policy if exists idempotency_popcorn_api_confirmation_insert
  on public.idempotency;
create policy idempotency_popcorn_api_confirmation_insert
  on public.idempotency for insert to popcorn_api
  with check (scope like 'creator-direct-confirm:%');

revoke all on function public.reserve_orchestrator_run_budget(
  uuid, uuid, uuid, uuid, text, double precision, text
) from popcorn_api;
revoke all on function public.wake_orchestrator_dispatch(uuid)
  from popcorn_api;
grant execute on function public.reserve_orchestrator_run_budget(
  uuid, uuid, uuid, uuid, text, double precision, text
) to popcorn_api;
grant execute on function public.wake_orchestrator_dispatch(uuid)
  to popcorn_api;
