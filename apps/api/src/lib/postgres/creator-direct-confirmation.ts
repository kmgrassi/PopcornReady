import { createHash } from "node:crypto";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { databaseError, type SupabaseErrorLike } from "../supabase/db-errors.js";
import { rootLogger } from "../v1/logger.js";
import { withTransaction } from "./transactions.js";

const OPERATION = "agentCreations.confirmProposal";
const IDEMPOTENCY_SCHEMA = "CreatorDirectConfirmation.v1";

export interface ConfirmCreatorDirectProposalInput {
  workspaceId: string;
  projectId: string;
  actorId: string;
  gateId: string;
  requestDigest: string;
  approvedMaxUsd: number;
  approvalToken: string;
  idempotencyKey: string;
}

export interface CreatorDirectConfirmation {
  runId: string;
  consumed: boolean;
  dispatchEnqueued: boolean;
}

export type TransactionRunner = <T>(
  operation: string,
  callback: (client: PoolClient) => Promise<T>
) => Promise<T>;

interface GateRow extends QueryResultRow {
  valid: boolean;
  input_approved_max_usd_text: string;
  orchestrator_run_id: string;
  subject_proposal_action_id: string;
  status: string;
  token_consumed_at: Date | string | null;
}

interface IdempotencyRow extends QueryResultRow {
  body_hash: string | null;
  response_body: unknown;
}

interface RunRow extends QueryResultRow {
  id: string;
  origin_kind: string;
  status: string;
}

class ConfirmationFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConfirmationFailure";
    this.code = code;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function failure(code: string, message: string): never {
  throw new ConfirmationFailure(code, message);
}

function firstRow<T extends QueryResultRow>(result: QueryResult<T>): T | null {
  return result.rows[0] ?? null;
}

function replayRunId(responseBody: unknown): string | null {
  if (
    typeof responseBody !== "object" ||
    responseBody === null ||
    Array.isArray(responseBody)
  ) {
    return null;
  }
  const runId = (responseBody as Record<string, unknown>).runId;
  return typeof runId === "string" && runId.length > 0 ? runId : null;
}

function postgresError(error: unknown): SupabaseErrorLike {
  if (!(error instanceof Error)) {
    return { code: "unknown", message: "Unknown database error." };
  }
  const value = error as Error & {
    code?: string;
    detail?: string;
    hint?: string;
  };
  return {
    code: value.code,
    message: value.message,
    details: value.detail,
    hint: value.hint,
  };
}

function mapDatabaseError(error: unknown): never {
  const mapped = postgresError(error);
  rootLogger.error("db_error", {
    operation: OPERATION,
    error: { code: mapped.code, message: mapped.message },
  });
  throw databaseError(OPERATION, mapped);
}

export function createConfirmCreatorDirectProposal(
  runTransaction: TransactionRunner = withTransaction
) {
  return async function confirmCreatorDirectProposal(
    input: ConfirmCreatorDirectProposalInput
  ): Promise<CreatorDirectConfirmation> {
    try {
      return await runTransaction(OPERATION, async (client) => {
        if (
          input.approvalToken.length < 16 ||
          input.idempotencyKey.trim().length === 0
        ) {
          failure(
            "22023",
            "creator-direct confirmation requires token and idempotency key"
          );
        }

        const approvalTokenHash = sha256(input.approvalToken);
        const gate = firstRow(
          await client.query<GateRow>(
            `select
               g.orchestrator_run_id,
               g.subject_proposal_action_id,
               g.status::text as status,
               g.token_consumed_at,
               $6::double precision::text as input_approved_max_usd_text,
               (
                 g.gate_kind = 'creator_direct_proposal'
                 and g.project_id = $2::uuid
                 and g.actor_id = $3::uuid
                 and g.request_digest = $4
                 and g.approved_max_usd is not distinct from $6::double precision
                 and g.approval_token_hash = $7
                 and g.expires_at > now()
                 and r.project_id = $2::uuid
                 and p.id = $2::uuid
                 and p.workspace_id = $5::uuid
               ) as valid
             from public.orchestrator_run_gates g
             join public.orchestrator_runs r on r.id = g.orchestrator_run_id
             join public.projects p on p.id = r.project_id
             where g.id = $1::uuid
             for update of g`,
            [
              input.gateId,
              input.projectId,
              input.actorId,
              input.requestDigest,
              input.workspaceId,
              input.approvedMaxUsd,
              approvalTokenHash,
            ]
          )
        );
        if (!gate?.valid) {
          failure("23514", "creator_direct_confirmation_invalid");
        }

        const bodyHash = sha256(
          `${input.gateId}:${input.actorId}:${input.requestDigest}:${gate.input_approved_max_usd_text}`
        );
        const idempotencyScope = `creator-direct-confirm:${input.projectId}`;
        const existing = firstRow(
          await client.query<IdempotencyRow>(
            `select body_hash, response_body
               from public.idempotency
              where scope = $1 and key = $2`,
            [idempotencyScope, input.idempotencyKey]
          )
        );
        if (existing) {
          if (existing.body_hash !== bodyHash) {
            failure(
              "23505",
              "creator_direct_confirmation_idempotency_conflict"
            );
          }
          const runId = replayRunId(existing.response_body);
          if (!runId) {
            failure(
              "55000",
              "creator_direct_confirmation_idempotency_response_invalid"
            );
          }
          return { runId, consumed: false, dispatchEnqueued: false };
        }

        if (
          gate.token_consumed_at !== null ||
          !["pending", "reached"].includes(gate.status)
        ) {
          failure("55000", "creator_direct_confirmation_already_consumed");
        }

        const run = firstRow(
          await client.query<RunRow>(
            `select id, origin_kind, status::text as status
               from public.orchestrator_runs
              where id = $1::uuid and project_id = $2::uuid
              for update`,
            [gate.orchestrator_run_id, input.projectId]
          )
        );
        if (
          !run ||
          run.origin_kind !== "creator_direct" ||
          run.status !== "queued"
        ) {
          failure("23514", "creator_direct_gate_run_not_queued");
        }

        await client.query(
          `select reservation_id
             from public.reserve_orchestrator_run_budget(
               $1::uuid, $2::uuid, $3::uuid, null, $4, $5::double precision, 'run_ceiling'
             )`,
          [
            input.projectId,
            run.id,
            gate.subject_proposal_action_id,
            `creator-direct-gate:${input.gateId}`,
            input.approvedMaxUsd,
          ]
        );

        const consumed = await client.query(
          `update public.orchestrator_run_gates
              set status = 'approved',
                  token_consumed_at = now(),
                  decided_at = now(),
                  updated_at = now()
            where id = $1::uuid
              and project_id = $2::uuid
              and actor_id = $3::uuid
              and token_consumed_at is null
              and status in ('pending', 'reached')`,
          [input.gateId, input.projectId, input.actorId]
        );
        if (consumed.rowCount !== 1) {
          failure("55000", "creator_direct_confirmation_lost_race");
        }

        await client.query(
          "select public.wake_orchestrator_dispatch($1::uuid)",
          [run.id]
        );
        await client.query(
          `insert into public.idempotency(
             scope, key, body_hash, status, response_body
           ) values (
             $1, $2, $3, 200,
             jsonb_build_object('schemaVersion', $4::text, 'runId', $5::uuid)
           )`,
          [
            idempotencyScope,
            input.idempotencyKey,
            bodyHash,
            IDEMPOTENCY_SCHEMA,
            run.id,
          ]
        );

        return { runId: run.id, consumed: true, dispatchEnqueued: true };
      });
    } catch (error) {
      mapDatabaseError(error);
    }
  };
}

export const confirmCreatorDirectProposal =
  createConfirmCreatorDirectProposal();
