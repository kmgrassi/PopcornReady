import type {
  AssetFingerprintPin,
  RerunProposalLifecycleStatus,
  RerunProposalV2,
  SelectionSequencePin,
  StorySnapshotPin,
} from "@popcorn/shared/rerun-proposal";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { ApiError } from "@/core/errors";
import {
  databaseError,
  type SupabaseErrorLike,
} from "@/lib/supabase/db-errors";
import { withTransaction } from "./transactions.js";

export type RerunProposalTransactionRunner = <T>(
  operation: string,
  callback: (client: PoolClient) => Promise<T>
) => Promise<T>;

export interface ApproveRerunProposalTransactionInput {
  projectId: string;
  proposalActionId: string;
  approvalActionId: string;
  actorId: string;
  approvedMaxCostUsd: number;
  approvalFingerprint: string;
  autonomous: boolean;
}

export interface CreateRerunProposalSuccessorTransactionInput {
  projectId: string;
  priorActionId: string;
  successorActionId: string;
  requestFingerprint: string;
  cause: "refresh" | "clarification_answer";
  rootRunId: string | null;
  params: Record<string, unknown>;
  proposal: RerunProposalV2;
  inputAssetIds: string[];
  rationale: string;
}

interface ProposalRow extends QueryResultRow {
  id: string;
  orchestrator_run_id: string | null;
  status: RerunProposalLifecycleStatus;
  tool: string;
  proposal: RerunProposalV2;
}

interface ApprovalRow extends QueryResultRow {
  id: string;
  project_id: string;
  tool: string;
  params: Record<string, unknown>;
}

class LifecycleTransactionFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LifecycleTransactionFailure";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new LifecycleTransactionFailure(code, message);
}

function firstRow<T extends QueryResultRow>(result: QueryResult<T>): T | null {
  return result.rows[0] ?? null;
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

function mapLifecycleError(operation: string, error: unknown): never {
  if (error instanceof ApiError) throw error;
  const mapped = postgresError(error);
  const message = `${mapped.message ?? ""} ${mapped.details ?? ""}`;
  if (message.includes("stale_proposal")) {
    throw new ApiError(
      "stale_proposal",
      "Proposal inputs changed; refresh before continuing."
    );
  }
  if (
    message.includes("replay_mismatch") ||
    message.includes("idempotency_conflict") ||
    message.includes("unique constraint")
  ) {
    throw new ApiError(
      "idempotency_conflict",
      "Idempotency key was reused with different input."
    );
  }
  if (mapped.code === "P0002") {
    throw new ApiError("not_found", "Proposal lifecycle record was not found.");
  }
  throw databaseError(operation, mapped);
}

async function lockProposal(
  client: PoolClient,
  projectId: string,
  actionId: string
): Promise<ProposalRow | null> {
  return firstRow(
    await client.query<ProposalRow>(
      `select id, orchestrator_run_id, status::text as status, tool, proposal
         from public.actions
        where id = $1::uuid and project_id = $2::uuid
        for update`,
      [actionId, projectId]
    )
  );
}

async function assetPinIsFresh(
  client: PoolClient,
  projectId: string,
  pin: AssetFingerprintPin
): Promise<boolean> {
  const row = firstRow(
    await client.query<{
      content_hash: string | null;
      inputs_fingerprint: string | null;
    }>(
      `select content_hash, inputs_fingerprint
         from public.assets
        where id = $1::uuid and project_id = $2::uuid
        for update`,
      [pin.assetId, projectId]
    )
  );
  return (
    row !== null &&
    row.content_hash === pin.contentHash &&
    row.inputs_fingerprint === pin.inputsFingerprint
  );
}

async function selectionPinIsFresh(
  client: PoolClient,
  projectId: string,
  pin: SelectionSequencePin
): Promise<boolean> {
  const row = firstRow(
    await client.query<{
      active_asset_id: string | null;
      seq: number;
    }>(
      `select active_asset_id, seq
         from public.selections
        where project_id = $1::uuid
          and slot_owner_lineage_id is not distinct from $2::uuid
          and slot_role = $3
        order by seq desc
        limit 1`,
      [projectId, pin.slotOwnerLineageId, pin.slotRole]
    )
  );
  return (
    (row?.seq ?? 0) === pin.expectedSeq &&
    (row?.active_asset_id ?? null) === pin.expectedActiveAssetId
  );
}

const STORY_PIN_SQL: Record<StorySnapshotPin["rowKind"], string> = {
  storyboard: `select nullif(provenance ->> 'planAssetId', '')::uuid as snapshot_asset_id
      from public.story_blueprints
     where id = $1::uuid and project_id = $2::uuid
     for update`,
  story_blueprint: `select asset_id as snapshot_asset_id
      from public.story_blueprints
     where id = $1::uuid and project_id = $2::uuid
     for update`,
  story_scene: `select scene_asset_id as snapshot_asset_id
      from public.story_blueprint_scenes
     where id = $1::uuid and project_id = $2::uuid
     for update`,
  story_beat: `select beat_asset_id as snapshot_asset_id
      from public.story_beats
     where id = $1::uuid and project_id = $2::uuid
     for update`,
};

async function storyPinIsFresh(
  client: PoolClient,
  projectId: string,
  pin: StorySnapshotPin
): Promise<boolean> {
  const row = firstRow(
    await client.query<{ snapshot_asset_id: string | null }>(
      STORY_PIN_SQL[pin.rowKind],
      [pin.rowId, projectId]
    )
  );
  return (
    row !== null && row.snapshot_asset_id === pin.expectedSnapshotAssetId
  );
}

async function proposalPinsAreFresh(
  client: PoolClient,
  projectId: string,
  _proposal: RerunProposalV2,
  proposalActionId?: string
): Promise<boolean> {
  if (!proposalActionId) return false;
  await client.query("savepoint rerun_freshness");
  try {
    await client.query(
      "select public.assert_rerun_proposal_pins_fresh($1, $2)",
      [projectId, proposalActionId]
    );
    await client.query("release savepoint rerun_freshness");
    return true;
  } catch {
    await client.query("rollback to savepoint rerun_freshness");
    return false;
  }
}

export function createApproveRerunProposalTransaction(
  runTransaction: RerunProposalTransactionRunner = withTransaction
) {
  return async function approveRerunProposalTransaction(
    input: ApproveRerunProposalTransactionInput
  ): Promise<{
    proposal_status: RerunProposalLifecycleStatus;
    approval_action_id: string | null;
    replayed: boolean;
    stale: boolean;
  }> {
    const operation = "rerunLifecycleStore.approve";
    try {
      return await runTransaction(operation, async (client) => {
        if (
          input.approvedMaxCostUsd < 0 ||
          input.approvalFingerprint.trim().length === 0 ||
          input.actorId.trim().length === 0
        ) {
          fail("22023", "invalid rerun approval input");
        }
        const proposal = await lockProposal(
          client,
          input.projectId,
          input.proposalActionId
        );
        if (
          !proposal ||
          proposal.tool !== "rerun_proposal" ||
          proposal.proposal?.schemaVersion !== "RerunProposal.v2" ||
          proposal.proposal.outcome !== "revision"
        ) {
          fail("P0002", "rerun proposal not found");
        }
        const existing = firstRow(
          await client.query<ApprovalRow>(
            `select id, project_id, tool, params
               from public.actions
              where id = $1::uuid`,
            [input.approvalActionId]
          )
        );
        if (existing) {
          const params = existing.params;
          if (
            existing.project_id !== input.projectId ||
            existing.tool !== "rerun_proposal_approval" ||
            params.proposalActionId !== input.proposalActionId ||
            params.approvalFingerprint !== input.approvalFingerprint ||
            Number(params.approvedMaxCostUsd) !== input.approvedMaxCostUsd ||
            params.actorId !== input.actorId ||
            params.autonomous !== input.autonomous
          ) {
            fail("23505", "rerun_approval_replay_mismatch");
          }
          return {
            proposal_status: proposal.status,
            approval_action_id: existing.id,
            replayed: true,
            stale: false,
          };
        }
        if (proposal.status !== "proposed") {
          fail(
            "55000",
            `proposal is not approvable from status ${proposal.status}`
          );
        }
        if (
          !(await proposalPinsAreFresh(
            client,
            input.projectId,
            proposal.proposal,
            input.proposalActionId
          ))
        ) {
          await client.query(
            `update public.actions
                set status = 'failed',
                    error = jsonb_build_object(
                      'schema_version', 'action_error.v1',
                      'kind', 'stale_proposal',
                      'message', 'stale_proposal_pin'
                    )
              where id = $1::uuid`,
            [input.proposalActionId]
          );
          return {
            proposal_status: "failed",
            approval_action_id: null,
            replayed: false,
            stale: true,
          };
        }
        if (proposal.proposal.requiresApproval && input.autonomous) {
          fail("23514", "creator approval is required");
        }
        if (
          input.approvedMaxCostUsd !== proposal.proposal.estimate.maxCostUsd
        ) {
          fail("23514", "approved maximum must equal proposal ceiling");
        }
        await client.query(
          `insert into public.actions (
             id, schema_version, project_id, orchestrator_run_id, tool, status,
             params, input_asset_ids, rationale, proposal, job_ids,
             output_asset_ids
           ) values (
             $1::uuid, 'action.v1', $2::uuid, $3::uuid,
             'rerun_proposal_approval', 'applied',
             jsonb_build_object(
               'schema_version', 'action_params.v1',
               'schemaVersion', 'RerunProposalApproval.v1',
               'proposalActionId', $4::uuid,
               'actorId', $5::text,
               'approvedMaxCostUsd', $6::double precision,
               'approvalFingerprint', $7::text,
               'autonomous', $8::boolean
             ),
             '{}'::uuid[],
             'Creator approved the immutable selective-regeneration proposal.',
             null, '{}'::uuid[], '{}'::uuid[]
           )`,
          [
            input.approvalActionId,
            input.projectId,
            proposal.orchestrator_run_id,
            input.proposalActionId,
            input.actorId,
            input.approvedMaxCostUsd,
            input.approvalFingerprint,
            input.autonomous,
          ]
        );
        await client.query(
          "update public.actions set status = 'approved' where id = $1::uuid",
          [input.proposalActionId]
        );
        return {
          proposal_status: "approved",
          approval_action_id: input.approvalActionId,
          replayed: false,
          stale: false,
        };
      });
    } catch (error) {
      mapLifecycleError(operation, error);
    }
  };
}

export function createRejectRerunProposalTransaction(
  runTransaction: RerunProposalTransactionRunner = withTransaction
) {
  return async function rejectRerunProposalTransaction(input: {
    projectId: string;
    proposalActionId: string;
  }): Promise<RerunProposalLifecycleStatus> {
    const operation = "rerunLifecycleStore.reject";
    try {
      return await runTransaction(operation, async (client) => {
        const proposal = await lockProposal(
          client,
          input.projectId,
          input.proposalActionId
        );
        if (!proposal || proposal.tool !== "rerun_proposal") {
          fail("P0002", "rerun proposal not found");
        }
        if (proposal.status === "rejected") return proposal.status;
        if (proposal.status !== "proposed") {
          fail(
            "55000",
            `proposal is not rejectable from status ${proposal.status}`
          );
        }
        await client.query(
          "update public.actions set status = 'rejected' where id = $1::uuid",
          [input.proposalActionId]
        );
        return "rejected";
      });
    } catch (error) {
      mapLifecycleError(operation, error);
    }
  };
}

export function createRerunProposalSuccessorTransaction(
  runTransaction: RerunProposalTransactionRunner = withTransaction
) {
  return async function createRerunProposalSuccessorTransaction(
    input: CreateRerunProposalSuccessorTransactionInput
  ): Promise<{ successor_action_id: string; replayed: boolean }> {
    const operation = "rerunLifecycleStore.createSuccessor";
    try {
      return await runTransaction(operation, async (client) => {
        const successorStatus =
          input.proposal.outcome === "no_op" ? "applied" : "proposed";
        const prior = await lockProposal(
          client,
          input.projectId,
          input.priorActionId
        );
        if (!prior || prior.tool !== "rerun_proposal") {
          fail("P0002", "prior rerun proposal not found");
        }
        const link = firstRow(
          await client.query<{
            successor_proposal_action_id: string;
            request_fingerprint: string;
            cause: string;
          }>(
            `select successor_proposal_action_id, request_fingerprint, cause
               from public.rerun_proposal_successors
              where prior_proposal_action_id = $1::uuid`,
            [input.priorActionId]
          )
        );
        if (link) {
          if (
            link.request_fingerprint !== input.requestFingerprint ||
            link.cause !== input.cause
          ) {
            fail("23505", "rerun_successor_replay_mismatch");
          }
          return {
            successor_action_id: link.successor_proposal_action_id,
            replayed: true,
          };
        }
        if (prior.status !== "proposed") {
          fail(
            "55000",
            `proposal is not refreshable from status ${prior.status}`
          );
        }
        await client.query(
          `insert into public.actions (
             id, schema_version, project_id, orchestrator_run_id, tool, status,
             params, input_asset_ids, rationale, proposal, job_ids,
             output_asset_ids
           ) values (
             $1::uuid, 'action.v1', $2::uuid, $3::uuid, 'rerun_proposal',
             $4::public.action_status,
             jsonb_build_object('schema_version', 'action_params.v1') ||
               $5::jsonb,
             $6::uuid[], $7::text,
             jsonb_build_object('schema_version', 'action_proposal.v1') ||
               $8::jsonb,
             '{}'::uuid[], '{}'::uuid[]
           )`,
          [
            input.successorActionId,
            input.projectId,
            input.rootRunId,
            successorStatus,
            JSON.stringify(input.params),
            input.inputAssetIds,
            input.rationale,
            JSON.stringify(input.proposal),
          ]
        );
        await client.query(
          `insert into public.rerun_proposal_successors (
             prior_proposal_action_id, successor_proposal_action_id,
             project_id, request_fingerprint, cause
           ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text)`,
          [
            input.priorActionId,
            input.successorActionId,
            input.projectId,
            input.requestFingerprint,
            input.cause,
          ]
        );
        await client.query(
          `update public.actions
              set status = 'failed',
                  error = jsonb_build_object(
                    'schema_version', 'action_error.v1',
                    'kind', 'proposal_superseded',
                    'successorActionId', $2::uuid,
                    'cause', $3::text
                  )
            where id = $1::uuid`,
          [input.priorActionId, input.successorActionId, input.cause]
        );
        return {
          successor_action_id: input.successorActionId,
          replayed: false,
        };
      });
    } catch (error) {
      mapLifecycleError(operation, error);
    }
  };
}

export const approveRerunProposalTransaction =
  createApproveRerunProposalTransaction();
export const rejectRerunProposalTransaction =
  createRejectRerunProposalTransaction();
export const createRerunProposalSuccessorDirectTransaction =
  createRerunProposalSuccessorTransaction();
