import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "@/core/errors";
import {
  assertLiveLease,
  isoTimestamp,
  lifecycleTransaction,
  lockExecution,
  requireRow,
  type LockedExecution,
} from "./rerun-lifecycle-common";

export interface ExecutionLease {
  reservationId: string;
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
}

export async function reserveExecutionTransaction(input: {
  projectId: string;
  proposalActionId: string;
  approvalActionId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  approvedMaxCostUsd: number;
  approvalFingerprint: string;
}) {
  return lifecycleTransaction("rerunLifecycle.reserveExecution", async (client) => {
    type Replay = {
      id: string; proposal_action_id: string; request_fingerprint: string;
      approved_max_cost_usd: number; approval_action_id: string;
      budget_reservation_id: string; root_run_id: string; status: string;
      lease_generation: number; execution_result_action_id: string | null;
    };
    const replayResult = (replay: Replay) => {
      if (
        replay.proposal_action_id !== input.proposalActionId ||
        replay.request_fingerprint !== input.requestFingerprint ||
        replay.approved_max_cost_usd !== input.approvedMaxCostUsd ||
        replay.approval_action_id !== input.approvalActionId
      ) {
        throw new ApiError("idempotency_conflict", "Execution replay input changed.");
      }
      return {
        reservation_id: replay.id,
        budget_reservation_id: replay.budget_reservation_id,
        root_run_id: replay.root_run_id,
        status: replay.status,
        lease_generation: replay.lease_generation,
        execution_result_action_id: replay.execution_result_action_id,
        replayed: true,
      };
    };
    // Existing executions are always locked before their proposal so
    // finalization and replay share execution -> proposal ordering.
    const replay = (await client.query<Replay>(
      `select id, proposal_action_id, request_fingerprint,
              approved_max_cost_usd, approval_action_id,
              budget_reservation_id, root_run_id, status, lease_generation,
              execution_result_action_id
         from public.rerun_execution_reservations
        where project_id = $1 and idempotency_key = $2 for update`,
      [input.projectId, input.idempotencyKey]
    )).rows[0];
    if (replay) return replayResult(replay);
    const proposal = requireRow((await client.query<{
      id: string; status: string; orchestrator_run_id: string | null;
      proposal: Record<string, unknown>;
    }>(
      `select id, status, orchestrator_run_id, proposal
         from public.actions
        where id = $1 and project_id = $2 and tool = 'rerun_proposal'
        for update`,
      [input.proposalActionId, input.projectId]
    )).rows, "Rerun proposal not found.");
    // A concurrent first admission may have committed while this transaction
    // waited on the proposal lock.
    const concurrentReplay = (await client.query<Replay>(
      `select id, proposal_action_id, request_fingerprint,
              approved_max_cost_usd, approval_action_id,
              budget_reservation_id, root_run_id, status, lease_generation,
              execution_result_action_id
         from public.rerun_execution_reservations
        where project_id = $1 and idempotency_key = $2 for update`,
      [input.projectId, input.idempotencyKey]
    )).rows[0];
    if (concurrentReplay) return replayResult(concurrentReplay);
    if (proposal.status !== "approved") {
      throw new ApiError("validation_failed", "Proposal is not executable.");
    }
    const estimate = proposal.proposal.estimate as
      | { maxCostUsd?: number }
      | undefined;
    if (estimate?.maxCostUsd !== input.approvedMaxCostUsd) {
      throw new ApiError(
        "validation_failed",
        "Execution ceiling differs from the immutable proposal."
      );
    }
    const approval = (await client.query(
      `select 1 from public.actions
        where id = $1 and project_id = $2
          and tool = 'rerun_proposal_approval' and status = 'applied'
          and params ->> 'schemaVersion' = 'RerunProposalApproval.v1'
          and params ->> 'proposalActionId' = $3
          and params ->> 'approvalFingerprint' = $4
          and (params ->> 'approvedMaxCostUsd')::double precision = $5
          and length(trim(coalesce(params ->> 'actorId',''))) > 0`,
      [
        input.approvalActionId,
        input.projectId,
        input.proposalActionId,
        input.approvalFingerprint,
        input.approvedMaxCostUsd,
      ]
    )).rowCount;
    if (!approval) throw new ApiError("not_found", "Proposal approval action not found.");
    await client.query(
      "select public.assert_rerun_proposal_pins_fresh($1, $2)",
      [input.projectId, input.proposalActionId]
    );
    let rootRunId = proposal.orchestrator_run_id;
    let ownsRoot = false;
    if (!rootRunId) {
      rootRunId = requireRow((await client.query<{ id: string }>(
        `insert into public.orchestrator_runs (
           schema_version, project_id, status, input_summary, budget_usd,
           spent_usd, agent_role, root_execution_profile
         ) values (
           'orchestrator_run.v1', $1, 'running',
           'Approved selective regeneration', $2, 0,
           'creative_director', 'creative_director'
         ) returning id`,
        [input.projectId, input.approvedMaxCostUsd]
      )).rows, "Could not materialize execution root.").id;
      ownsRoot = true;
    } else {
      const root = await client.query(
        `select id from public.orchestrator_runs
          where id = $1 and project_id = $2
            and agent_role = 'creative_director'
            and root_execution_profile = 'creative_director'
            and status in ('queued', 'running', 'waiting')
          for update`,
        [rootRunId, input.projectId]
      );
      if (!root.rowCount) throw new ApiError("not_found", "Authorized execution root not found.");
    }
    const budgetId = requireRow((await client.query<{ id: string }>(
      `insert into public.orchestrator_budget_reservations (
         project_id, orchestrator_run_id, root_run_id, action_id,
         reservation_key, reservation_scope, estimated_usd, proposal_action_id
       ) values ($1, $2, $2, $3, $4, 'proposal_ceiling', $5, $3)
       returning id`,
      [
        input.projectId,
        rootRunId,
        input.proposalActionId,
        `rerun-proposal:${input.proposalActionId}`,
        input.approvedMaxCostUsd,
      ]
    )).rows, "Could not reserve proposal budget.").id;
    const reservation = requireRow((await client.query<{
      id: string; lease_generation: number; status: string;
    }>(
      `insert into public.rerun_execution_reservations (
         proposal_action_id, project_id, root_run_id, approval_action_id,
         budget_reservation_id, idempotency_key, request_fingerprint,
         approved_max_cost_usd, owns_materialized_root
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id, lease_generation, status`,
      [
        input.proposalActionId, input.projectId, rootRunId,
        input.approvalActionId, budgetId, input.idempotencyKey,
        input.requestFingerprint, input.approvedMaxCostUsd, ownsRoot,
      ]
    )).rows, "Could not reserve execution.");
    await client.query("update public.actions set status = 'running' where id = $1", [
      input.proposalActionId,
    ]);
    return {
      reservation_id: reservation.id,
      budget_reservation_id: budgetId,
      root_run_id: rootRunId,
      status: reservation.status,
      lease_generation: reservation.lease_generation,
      execution_result_action_id: null,
      replayed: false,
    };
  });
}

export async function claimExecutionTransaction(input: {
  projectId: string;
  reservationId: string;
  leaseSeconds?: number;
}): Promise<ExecutionLease | null> {
  return lifecycleTransaction("rerunLifecycle.claimExecution", async (client) => {
    const seconds = input.leaseSeconds ?? 60;
    if (seconds < 5 || seconds > 900) {
      throw new ApiError("validation_failed", "Invalid lease duration.");
    }
    const execution = await lockExecution(client, input.projectId, input.reservationId);
    const activeCallbacks = await client.query(
      `select 1 from public.rerun_execution_callbacks
        where execution_reservation_id = $1 and status = 'pending'
          and cardinality(job_ids) > 0 and expires_at > now() limit 1`,
      [execution.id]
    );
    const blocked = await client.query(
      `select 1 from public.rerun_execution_work_items
        where execution_reservation_id = $1 and status = 'blocked' limit 1`,
      [execution.id]
    );
    const expired = !execution.lease_expires_at || execution.lease_expired;
    if (execution.status === "running" && expired && activeCallbacks.rowCount) {
      await client.query(
        `update public.rerun_execution_reservations
            set status='waiting', lease_token=null, lease_expires_at=null
          where id=$1`,
        [execution.id]
      );
      return null;
    }
    if (
      (execution.status === "waiting" &&
        (Boolean(activeCallbacks.rowCount) || Boolean(blocked.rowCount))) ||
      !["reserved", "running", "waiting"].includes(execution.status) ||
      (execution.lease_expires_at !== null && !expired)
    ) {
      throw new ApiError("idempotency_in_progress", "Execution lease is unavailable.");
    }
    const token = randomUUID();
    const row = requireRow((await client.query<{
      lease_generation: number; lease_expires_at: Date | string;
    }>(
      `update public.rerun_execution_reservations
          set status='running', lease_token=$2,
              lease_generation=lease_generation+1,
              lease_expires_at=now() + make_interval(secs => $3)
        where id=$1 returning lease_generation, lease_expires_at`,
      [execution.id, token, seconds]
    )).rows, "Could not claim execution.");
    return {
      reservationId: execution.id,
      leaseToken: token,
      leaseGeneration: row.lease_generation,
      leaseExpiresAt: isoTimestamp(row.lease_expires_at),
    };
  });
}

export async function renewExecutionTransaction(input: {
  projectId: string;
  lease: ExecutionLease;
}): Promise<ExecutionLease> {
  return lifecycleTransaction("rerunLifecycle.renewExecution", async (client) => {
    const row = requireRow((await client.query<{ lease_expires_at: Date | string }>(
      `update public.rerun_execution_reservations
          set lease_expires_at = now() + interval '60 seconds'
        where id=$1 and project_id=$2 and status='running'
          and lease_token=$3 and lease_generation=$4
          and lease_expires_at > now()
        returning lease_expires_at`,
      [
        input.lease.reservationId, input.projectId,
        input.lease.leaseToken, input.lease.leaseGeneration,
      ]
    )).rows, "Stale execution lease.");
    return { ...input.lease, leaseExpiresAt: isoTimestamp(row.lease_expires_at) };
  });
}

export async function parkExecutionTransaction(input: {
  projectId: string;
  lease: ExecutionLease;
}): Promise<void> {
  return lifecycleTransaction("rerunLifecycle.parkExecution", async (client) => {
    const execution = await lockExecution(
      client, input.projectId, input.lease.reservationId
    );
    assertLiveLease(execution, input.lease.leaseToken, input.lease.leaseGeneration);
    const parkable = await client.query(
      `select 1 from public.rerun_execution_work_items
        where execution_reservation_id=$1
          and status in ('running','blocked') limit 1`,
      [execution.id]
    );
    if (!parkable.rowCount) {
      throw new ApiError(
        "validation_failed",
        "Execution has no running or blocked work to park."
      );
    }
    await client.query(
      `update public.rerun_execution_reservations
          set status='waiting', lease_token=null, lease_expires_at=null
        where id=$1`,
      [execution.id]
    );
  });
}

async function finalizeLocked(
  client: PoolClient,
  input: {
    projectId: string;
    execution: LockedExecution;
    leaseToken: string;
    leaseGeneration: number;
    executionActionId: string;
    outcome: "applied" | "failed";
    reconciliationActionId?: string;
    error?: Record<string, unknown>;
  }
): Promise<string> {
  const execution = input.execution;
  if (execution.execution_result_action_id) {
    if (execution.execution_result_action_id !== input.executionActionId) {
      throw new ApiError("idempotency_conflict", "Execution result replay changed.");
    }
    const replay = requireRow((await client.query<{
      status: string;
      reconciliation_action_id: string | null;
    }>(
      `select status,params->>'reconciliationActionId' as reconciliation_action_id
         from public.actions where id=$1`,
      [execution.execution_result_action_id]
    )).rows, "Execution result action not found.");
    if (
      replay.status !== input.outcome ||
      replay.reconciliation_action_id !== (input.reconciliationActionId ?? null)
    ) {
      throw new ApiError("idempotency_conflict", "Execution result replay changed.");
    }
    return execution.execution_result_action_id;
  }
  assertLiveLease(execution, input.leaseToken, input.leaseGeneration);
  const proposal = requireRow((await client.query<{
    id: string; proposal: Record<string, unknown>; input_asset_ids: string[];
  }>("select id, proposal, input_asset_ids from public.actions where id=$1", [
    execution.proposal_action_id,
  ])).rows, "Rerun proposal not found.");
  if (input.outcome === "failed") {
    await client.query(
      `update public.rerun_execution_work_items set status='canceled',
         error=coalesce(error,$2::jsonb)
       where execution_reservation_id=$1 and status in ('reserved','running','blocked')`,
      [execution.id, JSON.stringify({ schema_version: "rerun_work_error.v1", kind: "execution_failed" })]
    );
    await client.query(
      `update public.rerun_execution_callbacks set status='canceled'
        where execution_reservation_id=$1 and status='pending'`,
      [execution.id]
    );
    await client.query(
      `update public.orchestrator_budget_reservations
          set status='released', released_at=now(), updated_at=now()
        where parent_reservation_id=$1 and status='reserved'`,
      [execution.budget_reservation_id]
    );
  } else {
    const incomplete = await client.query(
      `select 1 from public.rerun_execution_work_items
        where execution_reservation_id=$1 and status <> 'completed' limit 1`,
      [execution.id]
    );
    const count = await client.query<{ count: string }>(
      "select count(*)::text as count from public.rerun_execution_work_items where execution_reservation_id=$1",
      [execution.id]
    );
    const selectedWork = Array.isArray(proposal.proposal.selectedWork)
      ? proposal.proposal.selectedWork.length
      : -1;
    if (incomplete.rowCount || Number(count.rows[0]?.count) !== selectedWork) {
      throw new ApiError("validation_failed", "Rerun execution has incomplete bound work.");
    }
    if (!input.reconciliationActionId) {
      throw new ApiError("validation_failed", "Applied rerun requires terminal reconciliation.");
    }
    const reconciliation = await client.query(
      `select 1 from public.actions where id=$1 and project_id=$2
        and orchestrator_run_id=$3 and tool='rerun_reconciliation'
        and status='applied' and params->>'proposalActionId'=$4
        and params->>'executionReservationId'=$5`,
      [
        input.reconciliationActionId, input.projectId, execution.root_run_id,
        execution.proposal_action_id, execution.id,
      ]
    );
    if (!reconciliation.rowCount) {
      throw new ApiError("validation_failed", "Applied rerun requires terminal reconciliation.");
    }
    const unsettled = await client.query(
      `select 1 from public.orchestrator_budget_reservations
        where parent_reservation_id=$1 and status='reserved' limit 1`,
      [execution.budget_reservation_id]
    );
    if (unsettled.rowCount) {
      throw new ApiError("validation_failed", "Rerun execution has unsettled child budget.");
    }
  }
  const cost = Number((await client.query<{ actual: number }>(
    `select coalesce(sum(actual_usd),0)::double precision as actual
       from public.orchestrator_budget_reservations
      where parent_reservation_id=$1 and status='settled'`,
    [execution.budget_reservation_id]
  )).rows[0]?.actual ?? 0);
  if (cost > execution.approved_max_cost_usd) {
    throw new ApiError("budget_exceeded", "Actual cost exceeds approved ceiling.");
  }
  const work = await client.query<{
    output_asset_ids: string[];
    child_run_id: string | null;
    status: string;
    work_item_id: string;
    error: unknown;
  }>(
    `select output_asset_ids, child_run_id, status, work_item_id, error
       from public.rerun_execution_work_items
      where execution_reservation_id=$1 order by work_item_id`,
    [execution.id]
  );
  const outputs = [...new Set(work.rows.flatMap((row) => row.output_asset_ids ?? []))];
  const callbackChildren = await client.query<{ child_run_id: string }>(
    `select child_run_id from public.rerun_execution_callbacks
      where execution_reservation_id=$1 and status='completed'
        and child_run_id is not null`,
    [execution.id]
  );
  const childRuns = [...new Set([
    ...work.rows.flatMap((row) => row.child_run_id ? [row.child_run_id] : []),
    ...callbackChildren.rows.map((row) => row.child_run_id),
  ])];
  const params = {
    schema_version: "action_params.v1",
    schemaVersion: "RerunExecution.v1",
    proposalActionId: execution.proposal_action_id,
    outcome: input.outcome,
    childRunIds: childRuns,
    outputAssetIds: outputs,
    movedSelections: [],
    preservedAssetIds: proposal.proposal.preservedAssetIds ?? [],
    failedWorkItems: work.rows.filter((row) => row.status === "failed")
      .map((row) => ({ workItemId: row.work_item_id, error: row.error })),
    actualCostUsd: cost,
    reconciliationActionId: input.reconciliationActionId ?? null,
  };
  await client.query(
    `insert into public.actions (
       id,schema_version,project_id,orchestrator_run_id,tool,status,params,
       input_asset_ids,rationale,proposal,job_ids,output_asset_ids,error
     ) values ($1,'action.v1',$2,$3,'rerun_execution',$4,$5::jsonb,$6,
       'Terminal selective-regeneration execution result.',null,'{}',$7,$8::jsonb)`,
    [
      input.executionActionId, input.projectId, execution.root_run_id,
      input.outcome, JSON.stringify(params), proposal.input_asset_ids,
      outputs, input.outcome === "failed"
        ? JSON.stringify({ schema_version: "action_error.v1", ...(input.error ?? {}) })
        : null,
    ]
  );
  await client.query(
    `insert into public.action_assets(project_id,action_id,asset_id,direction,role,ordinal)
     select $1,$2,asset_id,'output','rerun_output',ordinal-1
       from unnest($3::uuid[]) with ordinality output(asset_id,ordinal)`,
    [input.projectId, input.executionActionId, outputs]
  );
  await client.query("update public.actions set status=$2 where id=$1", [
    execution.proposal_action_id, input.outcome,
  ]);
  await client.query(
    `update public.rerun_execution_reservations
        set status=$2, execution_result_action_id=$3,
            lease_token=null, lease_expires_at=null
      where id=$1`,
    [
      execution.id,
      input.outcome === "applied" ? "completed" : "failed",
      input.executionActionId,
    ]
  );
  await client.query(
    `update public.orchestrator_budget_reservations
        set status='released', released_at=now(), updated_at=now()
      where id=$1 and status='reserved'`,
    [execution.budget_reservation_id]
  );
  if (execution.owns_materialized_root) {
    await client.query(
      `update public.orchestrator_runs set status=$2, completed_at=now(),
         error=$3::jsonb where id=$1`,
      [
        execution.root_run_id,
        input.outcome === "applied" ? "succeeded" :
          input.error?.kind === "execution_canceled" ? "canceled" : "failed",
        input.outcome === "failed"
          ? JSON.stringify({
            schema_version: "orchestrator_run_error.v1",
            kind: input.error?.kind ?? "rerun_execution_failed",
            message: input.error?.message ?? input.error?.reason,
          })
          : null,
      ]
    );
  }
  return input.executionActionId;
}

export async function finalizeExecutionTransaction(input: {
  projectId: string;
  lease: ExecutionLease;
  executionActionId: string;
  outcome: "applied" | "failed";
  reconciliationActionId?: string;
  error?: Record<string, unknown>;
}): Promise<string> {
  return lifecycleTransaction("rerunLifecycle.finalizeExecution", async (client) => {
    const execution = await lockExecution(
      client, input.projectId, input.lease.reservationId
    );
    return finalizeLocked(client, {
      ...input,
      execution,
      leaseToken: input.lease.leaseToken,
      leaseGeneration: input.lease.leaseGeneration,
    });
  });
}

export async function cancelExecutionTransaction(input: {
  projectId: string;
  proposalActionId: string;
  executionActionId: string;
  reason: string;
}): Promise<string> {
  return lifecycleTransaction("rerunLifecycle.cancelExecution", async (client) => {
    const row = requireRow((await client.query<LockedExecution>(
      `select id, proposal_action_id, project_id, root_run_id,
              approval_action_id, budget_reservation_id,
              owns_materialized_root, approved_max_cost_usd, status,
              lease_token, lease_generation, lease_expires_at,
              execution_result_action_id,
              lease_expires_at is not null and lease_expires_at > now()
                as lease_live,
              lease_expires_at is not null and lease_expires_at <= now()
                as lease_expired
         from public.rerun_execution_reservations
        where project_id=$1 and proposal_action_id=$2 for update`,
      [input.projectId, input.proposalActionId]
    )).rows, "Execution reservation not found.");
    if (row.execution_result_action_id) return row.execution_result_action_id;
    await client.query(
      `update public.rerun_execution_work_items set status='canceled',
       error=$2::jsonb where execution_reservation_id=$1
       and status in ('reserved','running','blocked')`,
      [
        row.id,
        JSON.stringify({
          schema_version: "rerun_work_error.v1",
          kind: "execution_canceled",
          reason: input.reason,
        }),
      ]
    );
    await client.query(
      `update public.rerun_execution_callbacks set status='canceled'
        where execution_reservation_id=$1 and status='pending'`,
      [row.id]
    );
    const token = randomUUID();
    await client.query(
      `update public.rerun_execution_reservations
          set status='running', lease_token=$2,
              lease_generation=lease_generation+1,
              lease_expires_at=now()+interval '1 minute'
        where id=$1`,
      [row.id, token]
    );
    const fenced = await lockExecution(client, input.projectId, row.id);
    return finalizeLocked(client, {
      projectId: input.projectId,
      execution: fenced,
      leaseToken: token,
      leaseGeneration: fenced.lease_generation,
      executionActionId: input.executionActionId,
      outcome: "failed",
      error: {
        kind: "execution_canceled",
        reason: input.reason,
        recoverable: false,
      },
    });
  });
}

export async function recoverExecutionTransaction(input: {
  projectId: string;
  reservationId: string;
  executionActionId: string;
  reason: string;
}): Promise<string> {
  return lifecycleTransaction("rerunLifecycle.recoverExecution", async (client) => {
    const execution = await lockExecution(
      client, input.projectId, input.reservationId
    );
    if (execution.execution_result_action_id) {
      return execution.execution_result_action_id;
    }
    const root = requireRow((await client.query<{ status: string }>(
      "select status from public.orchestrator_runs where id=$1",
      [execution.root_run_id]
    )).rows, "Execution root not found.");
    const liveExternal = await client.query(
      `select 1 from public.rerun_execution_callbacks
        where execution_reservation_id=$1 and status='pending'
          and cardinality(job_ids)>0 and expires_at>now() limit 1`,
      [execution.id]
    );
    const expiredCallback = await client.query(
      `select 1 from public.rerun_execution_callbacks
        where execution_reservation_id=$1 and status='pending'
          and expires_at<=now() limit 1`,
      [execution.id]
    );
    const leaseExpired = execution.lease_expired;
    if (
      !(leaseExpired && !liveExternal.rowCount) &&
      !expiredCallback.rowCount &&
      !["failed", "canceled", "timed_out", "superseded"].includes(root.status)
    ) {
      throw new ApiError("idempotency_in_progress", "Execution is not recoverable yet.");
    }
    await client.query(
      `update public.rerun_execution_work_items set status='canceled',
       error=$2::jsonb where execution_reservation_id=$1
       and status in ('reserved','running','blocked')`,
      [
        execution.id,
        JSON.stringify({
          schema_version: "rerun_work_error.v1",
          kind: input.reason,
        }),
      ]
    );
    await client.query(
      `update public.rerun_execution_callbacks set status='canceled'
        where execution_reservation_id=$1 and status='pending'`,
      [execution.id]
    );
    // Recovery always invalidates the expired worker and mints a distinct,
    // recovery-only terminal fence.
    const token = randomUUID();
    await client.query(
      `update public.rerun_execution_reservations
          set status='running', lease_token=$2,
              lease_generation=lease_generation+1,
              lease_expires_at=now()+interval '1 minute'
        where id=$1`,
      [execution.id, token]
    );
    const fenced = await lockExecution(client, input.projectId, execution.id);
    return finalizeLocked(client, {
      projectId: input.projectId,
      execution: fenced,
      leaseToken: token,
      leaseGeneration: fenced.lease_generation,
      executionActionId: input.executionActionId,
      outcome: "failed",
      error: { kind: input.reason, recoverable: true },
    });
  });
}
