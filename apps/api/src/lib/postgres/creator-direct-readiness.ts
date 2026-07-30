import type { QueryResultRow } from "pg";
import { withTransaction } from "./transactions.js";
import type { TransactionRunner } from "./creator-direct-confirmation.js";

interface ReadinessRow extends QueryResultRow {
  correct_role: boolean;
  no_bypass_rls: boolean;
  no_superuser: boolean;
  safe_role_attributes: boolean;
  no_role_memberships: boolean;
  owns_no_protected_tables: boolean;
  no_table_wide_privileges: boolean;
  no_forbidden_column_privileges: boolean;
  projects_read: boolean;
  runs_read: boolean;
  runs_lock: boolean;
  gates_read: boolean;
  gates_update: boolean;
  idempotency_read: boolean;
  idempotency_insert: boolean;
  reserve_execute: boolean;
  wake_execute: boolean;
  policy_count: string | number;
}

export interface CreatorDirectDatabaseReadiness {
  ready: boolean;
  checked: boolean;
}

const REQUIRED_POLICIES = [
  "projects_popcorn_api_confirmation_select",
  "orchestrator_runs_popcorn_api_confirmation_select",
  "orchestrator_runs_popcorn_api_confirmation_lock",
  "orchestrator_run_gates_popcorn_api_confirmation_select",
  "orchestrator_run_gates_popcorn_api_confirmation_update",
  "idempotency_popcorn_api_confirmation_select",
  "idempotency_popcorn_api_confirmation_insert",
];

export function createCreatorDirectDatabaseReadiness(
  runTransaction: TransactionRunner = withTransaction,
  env: NodeJS.ProcessEnv = process.env
) {
  let passed = false;

  return async function creatorDirectDatabaseReadiness(): Promise<CreatorDirectDatabaseReadiness> {
    if (passed) return { ready: true, checked: true };
    const isRailway =
      Boolean(env.RAILWAY_ENVIRONMENT_ID) ||
      Boolean(env.RAILWAY_ENVIRONMENT_NAME) ||
      Boolean(env.RAILWAY_PROJECT_ID) ||
      Boolean(env.RAILWAY_SERVICE_ID);
    if (env.NODE_ENV !== "production" && !isRailway) {
      return { ready: true, checked: false };
    }
    if (!env.DATABASE_URL) return { ready: false, checked: false };

    try {
      const row = await runTransaction(
        "health.creatorDirectDatabaseReadiness",
        async (client) => {
          const result = await client.query<ReadinessRow>(
            `select
               current_user = 'popcorn_api' as correct_role,
               not coalesce((
                 select rolbypassrls from pg_roles where rolname = current_user
               ), true) as no_bypass_rls,
               not coalesce((
                 select rolsuper from pg_roles where rolname = current_user
               ), true) as no_superuser,
               coalesce((
                 select not rolcreatedb
                    and not rolcreaterole
                    and not rolreplication
                   from pg_roles
                  where rolname = current_user
               ), false) as safe_role_attributes,
               not exists (
                 select 1
                   from pg_auth_members m
                  where m.member = (
                    select oid from pg_roles where rolname = current_user
                  )
               ) as no_role_memberships,
               not exists (
                 select 1
                   from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public'
                    and c.relname = any($2::text[])
                    and pg_get_userbyid(c.relowner) = current_user
               ) as owns_no_protected_tables,
               not exists (
                 select 1
                   from unnest($2::text[]) as protected(table_name)
                  where has_table_privilege(
                          current_user,
                          format('public.%I', protected.table_name),
                          'SELECT'
                        )
                     or has_table_privilege(
                          current_user,
                          format('public.%I', protected.table_name),
                          'INSERT'
                        )
                     or has_table_privilege(
                          current_user,
                          format('public.%I', protected.table_name),
                          'UPDATE'
                        )
                     or has_table_privilege(
                          current_user,
                          format('public.%I', protected.table_name),
                          'DELETE'
                        )
                     or has_table_privilege(
                          current_user,
                          format('public.%I', protected.table_name),
                          'TRUNCATE'
                        )
                     or has_table_privilege(
                          current_user,
                          format('public.%I', protected.table_name),
                          'REFERENCES'
                        )
                     or has_table_privilege(
                          current_user,
                          format('public.%I', protected.table_name),
                          'TRIGGER'
                        )
               ) as no_table_wide_privileges,
               not exists (
                 select 1
                   from (
                     values
                       ('projects', array['id', 'workspace_id']::text[], array[]::text[], array[]::text[]),
                       ('orchestrator_runs', array['id', 'project_id', 'origin_kind', 'status']::text[], array['updated_at']::text[], array[]::text[]),
                       ('orchestrator_run_gates', array['id', 'orchestrator_run_id', 'subject_proposal_action_id', 'gate_kind', 'project_id', 'actor_id', 'request_digest', 'approved_max_usd', 'approval_token_hash', 'expires_at', 'token_consumed_at', 'status']::text[], array['status', 'token_consumed_at', 'decided_at', 'updated_at']::text[], array[]::text[]),
                       ('idempotency', array['scope', 'key', 'body_hash', 'response_body']::text[], array[]::text[], array['scope', 'key', 'body_hash', 'status', 'response_body']::text[])
                   ) as allowed(table_name, select_columns, update_columns, insert_columns)
                   join pg_class c on c.relname = allowed.table_name
                   join pg_namespace n
                     on n.oid = c.relnamespace and n.nspname = 'public'
                   join pg_attribute a
                     on a.attrelid = c.oid
                    and a.attnum > 0
                    and not a.attisdropped
                  where (
                    has_column_privilege(
                      current_user, c.oid, a.attname, 'SELECT'
                    ) and not a.attname = any(allowed.select_columns)
                  ) or (
                    has_column_privilege(
                      current_user, c.oid, a.attname, 'UPDATE'
                    ) and not a.attname = any(allowed.update_columns)
                  ) or (
                    has_column_privilege(
                      current_user, c.oid, a.attname, 'INSERT'
                    ) and not a.attname = any(allowed.insert_columns)
                  ) or has_column_privilege(
                    current_user, c.oid, a.attname, 'REFERENCES'
                  )
               ) as no_forbidden_column_privileges,
               has_column_privilege(current_user, 'public.projects', 'id', 'SELECT')
                 and has_column_privilege(current_user, 'public.projects', 'workspace_id', 'SELECT')
                 as projects_read,
               has_column_privilege(current_user, 'public.orchestrator_runs', 'id', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_runs', 'project_id', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_runs', 'origin_kind', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_runs', 'status', 'SELECT')
                 as runs_read,
               has_column_privilege(current_user, 'public.orchestrator_runs', 'updated_at', 'UPDATE')
                 as runs_lock,
               has_column_privilege(current_user, 'public.orchestrator_run_gates', 'id', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'orchestrator_run_id', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'subject_proposal_action_id', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'gate_kind', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'project_id', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'actor_id', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'request_digest', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'approved_max_usd', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'approval_token_hash', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'expires_at', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'token_consumed_at', 'SELECT')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'status', 'SELECT')
                 as gates_read,
               has_column_privilege(current_user, 'public.orchestrator_run_gates', 'status', 'UPDATE')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'token_consumed_at', 'UPDATE')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'decided_at', 'UPDATE')
                 and has_column_privilege(current_user, 'public.orchestrator_run_gates', 'updated_at', 'UPDATE')
                 as gates_update,
               has_column_privilege(current_user, 'public.idempotency', 'scope', 'SELECT')
                 and has_column_privilege(current_user, 'public.idempotency', 'key', 'SELECT')
                 and has_column_privilege(current_user, 'public.idempotency', 'body_hash', 'SELECT')
                 and has_column_privilege(current_user, 'public.idempotency', 'response_body', 'SELECT')
                 as idempotency_read,
               has_column_privilege(current_user, 'public.idempotency', 'scope', 'INSERT')
                 and has_column_privilege(current_user, 'public.idempotency', 'key', 'INSERT')
                 and has_column_privilege(current_user, 'public.idempotency', 'body_hash', 'INSERT')
                 and has_column_privilege(current_user, 'public.idempotency', 'status', 'INSERT')
                 and has_column_privilege(current_user, 'public.idempotency', 'response_body', 'INSERT')
                 as idempotency_insert,
               has_function_privilege(
                 current_user,
                 'public.reserve_orchestrator_run_budget(uuid,uuid,uuid,uuid,text,double precision,text)',
                 'EXECUTE'
               ) as reserve_execute,
               has_function_privilege(
                 current_user,
                 'public.wake_orchestrator_dispatch(uuid)',
                 'EXECUTE'
               ) as wake_execute,
               (
                 select count(*)
                   from pg_policies
                  where schemaname = 'public'
                    and policyname = any($1::text[])
                    and 'popcorn_api' = any(roles)
               ) as policy_count`,
            [
              REQUIRED_POLICIES,
              [
                "projects",
                "orchestrator_runs",
                "orchestrator_run_gates",
                "idempotency",
              ],
            ]
          );
          return result.rows[0] ?? null;
        }
      );
      passed = Boolean(
        row &&
          row.correct_role &&
          row.no_bypass_rls &&
          row.no_superuser &&
          row.safe_role_attributes &&
          row.no_role_memberships &&
          row.owns_no_protected_tables &&
          row.no_table_wide_privileges &&
          row.no_forbidden_column_privileges &&
          row.projects_read &&
          row.runs_read &&
          row.runs_lock &&
          row.gates_read &&
          row.gates_update &&
          row.idempotency_read &&
          row.idempotency_insert &&
          row.reserve_execute &&
          row.wake_execute &&
          Number(row.policy_count) === REQUIRED_POLICIES.length
      );
      return { ready: passed, checked: true };
    } catch {
      return { ready: false, checked: true };
    }
  };
}

export const creatorDirectDatabaseReadiness =
  createCreatorDirectDatabaseReadiness();
