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
  lifecycle_access_exact: boolean;
  lifecycle_routine_boundary: boolean;
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
  "actions_popcorn_api_rerun_select",
  "actions_popcorn_api_rerun_insert",
  "actions_popcorn_api_rerun_update",
  "action_assets_popcorn_api_rerun_select",
  "action_assets_popcorn_api_rerun_insert",
  "assets_popcorn_api_rerun_select",
  "selections_popcorn_api_rerun_select",
  "selections_popcorn_api_rerun_insert",
  "story_blueprints_popcorn_api_rerun_select",
  "story_scenes_popcorn_api_rerun_select",
  "story_beats_popcorn_api_rerun_select",
  "rerun_reservations_popcorn_api_all",
  "rerun_work_popcorn_api_all",
  "rerun_callbacks_popcorn_api_all",
  "rerun_successors_popcorn_api_all",
  "rerun_budget_popcorn_api_all",
  "orchestrator_runs_popcorn_api_rerun_select",
  "orchestrator_runs_popcorn_api_rerun_insert",
  "orchestrator_runs_popcorn_api_rerun_update",
];

const LIFECYCLE_COLUMN_PRIVILEGES = {
  assets: {
    SELECT: ["id","kind","project_id","role"],
    INSERT: [],
    UPDATE: [],
  },
  selections: {
    SELECT: ["active_asset_id","project_id","seq","slot_owner_lineage_id","slot_role"],
    INSERT: ["active_asset_id","project_id","seq","set_by_action_id","slot_owner_lineage_id","slot_role"],
    UPDATE: [],
  },
  story_blueprints: {
    SELECT: ["asset_id","id","project_id","provenance"],
    INSERT: [],
    UPDATE: [],
  },
  story_blueprint_scenes: {
    SELECT: ["id","project_id","scene_asset_id"],
    INSERT: [],
    UPDATE: [],
  },
  story_beats: {
    SELECT: ["beat_asset_id","id","project_id"],
    INSERT: [],
    UPDATE: [],
  },
  orchestrator_runs: {
    SELECT: ["agent_role","budget_usd","id","origin_kind","parent_run_id","project_id","root_action_id","spent_usd","status","task_params"],
    INSERT: ["agent_role","budget_usd","input_summary","project_id","schema_version","spent_usd","status"],
    UPDATE: ["completed_at","error","started_at","status","updated_at"],
  },
  actions: {
    SELECT: ["error","id","input_asset_ids","orchestrator_run_id","output_asset_ids","params","project_id","proposal","rationale","status","tool"],
    INSERT: ["error","id","input_asset_ids","job_ids","orchestrator_run_id","output_asset_ids","params","project_id","proposal","rationale","schema_version","status","tool"],
    UPDATE: ["error","output_asset_ids","status"],
  },
  action_assets: {
    SELECT: ["action_id","asset_id","direction","ordinal","project_id","role"],
    INSERT: ["action_id","asset_id","direction","ordinal","project_id","role"],
    UPDATE: [],
  },
  rerun_execution_reservations: {
    SELECT: ["approval_action_id","approved_max_cost_usd","budget_reservation_id","execution_result_action_id","id","idempotency_key","lease_expires_at","lease_generation","lease_token","owns_materialized_root","project_id","proposal_action_id","request_fingerprint","root_run_id","status"],
    INSERT: ["approval_action_id","approved_max_cost_usd","budget_reservation_id","idempotency_key","owns_materialized_root","project_id","proposal_action_id","request_fingerprint","root_run_id"],
    UPDATE: ["execution_result_action_id","lease_expires_at","lease_generation","lease_token","status","updated_at"],
  },
  rerun_execution_work_items: {
    SELECT: ["accepted_callbacks","binding_results","blocked_precondition","budget_reservation_keys","child_run_id","dispatch_action_id","error","execution_reservation_id","id","lease_generation","output_asset_ids","primitive_action_ids","project_id","reconciliation_action_id","report_action_id","request_fingerprint","status","work_item_id"],
    INSERT: ["dispatch_action_id","execution_reservation_id","lease_generation","project_id","request_fingerprint","status","work_item_id"],
    UPDATE: ["accepted_callbacks","binding_results","blocked_precondition","budget_reservation_keys","child_run_id","error","output_asset_ids","primitive_action_ids","reconciliation_action_id","report_action_id","status","updated_at"],
  },
  rerun_execution_callbacks: {
    SELECT: ["binding_results","binding_subset","budget_reservation_keys","callback_generation","callback_result","callback_token_hash","child_run_id","execution_reservation_id","executor_id","expires_at","id","job_ids","primitive_action_ids","project_id","reconciliation_action_id","report_action_id","status","work_reservation_id"],
    INSERT: ["binding_subset","callback_generation","callback_token_hash","execution_reservation_id","executor_id","project_id","work_reservation_id"],
    UPDATE: ["binding_results","budget_reservation_keys","callback_result","child_run_id","completed_at","job_ids","primitive_action_ids","reconciliation_action_id","report_action_id","status"],
  },
  rerun_proposal_successors: {
    SELECT: ["cause","prior_proposal_action_id","project_id","request_fingerprint","successor_proposal_action_id"],
    INSERT: ["cause","prior_proposal_action_id","project_id","request_fingerprint","successor_proposal_action_id"],
    UPDATE: [],
  },
  orchestrator_budget_reservations: {
    SELECT: ["action_id","actual_usd","estimated_usd","id","job_id","orchestrator_run_id","parent_reservation_id","project_id","proposal_action_id","reservation_key","reservation_scope","root_run_id","status"],
    INSERT: ["action_id","estimated_usd","job_id","orchestrator_run_id","parent_reservation_id","project_id","proposal_action_id","reservation_key","reservation_scope","root_run_id"],
    UPDATE: ["released_at","status","updated_at"],
  },
} as const;

const RETIRED_LIFECYCLE_ROUTINES = [
  "public.approve_rerun_proposal(uuid,uuid,uuid,text,double precision,text,boolean)",
  "public.reject_rerun_proposal(uuid,uuid)",
  "public.create_rerun_proposal_successor(uuid,uuid,uuid,text,text,uuid,jsonb,jsonb,uuid[],text,public.action_status)",
  "public.reserve_rerun_proposal_execution(uuid,uuid,uuid,text,text,double precision,text)",
  "public.claim_rerun_execution_lease(uuid,uuid,integer)",
  "public.renew_rerun_execution_lease(uuid,uuid,uuid,integer,integer)",
  "public.reserve_rerun_work_item(uuid,uuid,uuid,integer,text,text,uuid,jsonb,jsonb)",
  "public.reserve_rerun_child_budget(uuid,uuid,text,uuid,uuid,uuid,text,double precision)",
  "public.park_rerun_work_item(uuid,uuid,uuid,integer,text,jsonb,jsonb,jsonb,jsonb,uuid[],text[])",
  "public.park_rerun_execution(uuid,uuid,uuid,integer)",
  "public.record_rerun_executor_callback(uuid,uuid,text,text,text,integer,text,jsonb)",
  "public.complete_rerun_work_item(uuid,uuid,uuid,integer,text,uuid,uuid,uuid,jsonb,uuid[],text[])",
  "public.fail_rerun_work_item(uuid,uuid,uuid,integer,text,jsonb)",
  "public.finalize_rerun_execution(uuid,uuid,uuid,integer,uuid,text,uuid,jsonb)",
  "public.recover_rerun_execution(uuid,uuid,uuid,text)",
  "public.cancel_rerun_execution(uuid,uuid,uuid,text)",
] as const;

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
                       ('orchestrator_runs', array['id','project_id','origin_kind','status','parent_run_id','root_action_id','task_params','agent_role','budget_usd','spent_usd']::text[], array['updated_at','status','started_at','completed_at','error']::text[], array['schema_version','project_id','status','input_summary','budget_usd','spent_usd','agent_role']::text[]),
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
               not exists (
                 select 1
                   from jsonb_each($3::jsonb) expected_table
                   cross join lateral jsonb_each(expected_table.value)
                     expected_privilege
                  where exists (
                    select 1
                      from jsonb_array_elements_text(expected_privilege.value)
                        required_column
                     where not has_column_privilege(
                       current_user,
                       format('public.%I', expected_table.key),
                       required_column,
                       expected_privilege.key
                     )
                  )
                  or exists (
                    select 1
                      from information_schema.column_privileges actual
                     where actual.grantee = current_user
                       and actual.table_schema = 'public'
                       and actual.table_name = expected_table.key
                       and actual.privilege_type = expected_privilege.key
                       and not expected_privilege.value ? actual.column_name
                  )
               ) as lifecycle_access_exact,
               has_function_privilege(
                 current_user,
                 'public.assert_rerun_proposal_pins_fresh(uuid,uuid)',
                 'EXECUTE'
               )
               and has_function_privilege(
                 current_user,
                 'public.apply_rerun_story_pointer(uuid,uuid,uuid,text,uuid,uuid,uuid)',
                 'EXECUTE'
               )
               and not exists (
                 select 1 from unnest($4::text[]) routine(signature)
                  where has_function_privilege(
                    current_user, routine.signature, 'EXECUTE'
                  )
               ) as lifecycle_routine_boundary,
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
                "actions",
                "action_assets",
                "assets",
                "selections",
                "story_blueprints",
                "story_blueprint_scenes",
                "story_beats",
                "rerun_execution_reservations",
                "rerun_execution_work_items",
                "rerun_execution_callbacks",
                "rerun_proposal_successors",
                "orchestrator_budget_reservations",
              ],
              JSON.stringify(LIFECYCLE_COLUMN_PRIVILEGES),
              RETIRED_LIFECYCLE_ROUTINES,
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
          row.lifecycle_access_exact &&
          row.lifecycle_routine_boundary &&
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
