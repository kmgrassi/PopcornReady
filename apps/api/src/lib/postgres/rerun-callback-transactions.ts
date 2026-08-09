import { createHash } from "node:crypto";
import { ApiError } from "@/core/errors";
import {
  lifecycleTransaction,
  lockExecution,
  lockWork,
  requireRow,
  sameJson,
} from "./rerun-lifecycle-common";

export async function recordCallbackTransaction(input: {
  projectId: string;
  reservationId: string;
  workItemId: string;
  executorId: string;
  callbackToken: string;
  callbackGeneration: number;
  outcome: "completed" | "failed";
  result: Record<string, unknown>;
}): Promise<boolean> {
  return lifecycleTransaction("rerunLifecycle.recordCallback", async (client) => {
    // Universal order: execution -> work -> callback.
    const execution = await lockExecution(client, input.projectId, input.reservationId);
    const work = await lockWork(client, execution.id, input.workItemId);
    if (!work) throw new ApiError("not_found", "Rerun callback not found.");
    const callback = requireRow((await client.query<Record<string, unknown>>(
      `select id, execution_reservation_id, work_reservation_id, project_id,
              executor_id, binding_subset, callback_token_hash,
              callback_generation, job_ids, status, callback_result,
              child_run_id, report_action_id, reconciliation_action_id,
              primitive_action_ids, budget_reservation_keys,
              binding_results, expires_at,
              expires_at > now() as callback_live
         from public.rerun_execution_callbacks
        where work_reservation_id=$1 and executor_id=$2 for update`,
      [work.id, input.executorId]
    )).rows, "Rerun callback not found.");
    const tokenHash = createHash("sha256").update(input.callbackToken).digest("hex");
    if (
      callback.callback_generation !== input.callbackGeneration ||
      callback.callback_token_hash !== tokenHash
    ) {
      throw new ApiError("idempotency_in_progress", "Stale callback fence.");
    }
    if (callback.status === "completed" || callback.status === "failed") {
      if (
        callback.status !== input.outcome ||
        !sameJson(callback.callback_result, input.result.providerResult ?? null) ||
        callback.child_run_id !== (input.result.childRunId ?? null) ||
        callback.report_action_id !== (input.result.reportActionId ?? null) ||
        callback.reconciliation_action_id !==
          (input.result.reconciliationActionId ?? null) ||
        !sameJson(callback.primitive_action_ids, input.result.primitiveActionIds ?? []) ||
        !sameJson(callback.budget_reservation_keys, input.result.budgetReservationKeys ?? []) ||
        !sameJson(callback.binding_results, input.result.outputs ?? [])
      ) {
        throw new ApiError("idempotency_conflict", "Callback replay outcome changed.");
      }
      return true;
    }
    if (
      callback.status !== "pending" ||
      !["running", "waiting"].includes(execution.status) ||
      work.status !== "running" ||
      callback.callback_live !== true
    ) {
      throw new ApiError("idempotency_in_progress", "Stale callback fence.");
    }
    await client.query(
      `update public.rerun_execution_callbacks set status=$2,
         callback_result=$3::jsonb,child_run_id=$4,report_action_id=$5,
         reconciliation_action_id=$6,primitive_action_ids=$7,
         budget_reservation_keys=$8,binding_results=$9::jsonb,
         completed_at=now() where id=$1`,
      [
        callback.id, input.outcome,
        JSON.stringify(input.result.providerResult ?? null),
        input.result.childRunId ?? null, input.result.reportActionId ?? null,
        input.result.reconciliationActionId ?? null,
        input.result.primitiveActionIds ?? [],
        input.result.budgetReservationKeys ?? [],
        JSON.stringify(input.result.outputs ?? []),
      ]
    );
    return false;
  });
}

export async function reserveChildBudgetTransaction(input: {
  projectId: string;
  executionReservationId: string;
  workItemId: string;
  actionId: string;
  childRunId?: string;
  jobId?: string;
  reservationKey: string;
  estimatedUsd: number;
}): Promise<{ reservationId: string; replayed: boolean }> {
  return lifecycleTransaction("rerunLifecycle.reserveChildBudget", async (client) => {
    if (input.estimatedUsd < 0) {
      throw new ApiError("validation_failed", "Invalid child budget estimate.");
    }
    const execution = await lockExecution(
      client, input.projectId, input.executionReservationId
    );
    if (!["running", "waiting"].includes(execution.status)) {
      throw new ApiError("not_found", "Active rerun execution not found.");
    }
    const work = await lockWork(client, execution.id, input.workItemId);
    if (!work || !["reserved", "running"].includes(String(work.status))) {
      throw new ApiError("not_found", "Active rerun work item not found.");
    }
    if (input.actionId === work.dispatch_action_id) {
      if (input.childRunId) {
        throw new ApiError("validation_failed", "Dispatch budget cannot claim a child run.");
      }
    } else {
      if (!input.childRunId) {
        throw new ApiError("validation_failed", "Child budget action requires a causally bound child run.");
      }
      const causation = await client.query(
        `select 1
           from public.orchestrator_runs child
           join public.actions primitive on primitive.id=$1
          where child.id=$2 and child.project_id=$3
            and child.parent_run_id=$4
            and child.root_action_id=$5
            and child.task_params#>>'{approvalContext,proposalActionId}'=$6
            and child.task_params#>>'{approvalContext,executionReservationId}'=$7
            and primitive.project_id=$3
            and primitive.orchestrator_run_id=child.id
            and primitive.status in ('running','applied')`,
        [
          input.actionId, input.childRunId, input.projectId,
          execution.root_run_id, work.dispatch_action_id,
          execution.proposal_action_id, execution.id,
        ]
      );
      if (!causation.rowCount) {
        throw new ApiError("validation_failed", "Child budget action is outside proposal causation.");
      }
    }
    const existing = (await client.query<{
      id: string; parent_reservation_id: string; action_id: string;
      orchestrator_run_id: string; job_id: string | null; estimated_usd: number;
    }>(
      `select id, project_id, orchestrator_run_id, root_run_id, action_id,
              job_id, reservation_key, reservation_scope, estimated_usd,
              actual_usd, status, proposal_action_id, parent_reservation_id
         from public.orchestrator_budget_reservations
        where project_id=$1 and reservation_key=$2 for update`,
      [input.projectId, input.reservationKey]
    )).rows[0];
    if (existing) {
      if (
        existing.parent_reservation_id !== execution.budget_reservation_id ||
        existing.action_id !== input.actionId ||
        existing.orchestrator_run_id !== (input.childRunId ?? execution.root_run_id) ||
        existing.job_id !== (input.jobId ?? null) ||
        existing.estimated_usd !== input.estimatedUsd
      ) {
        throw new ApiError("idempotency_conflict", "Child budget replay input changed.");
      }
      return { reservationId: existing.id, replayed: true };
    }
    const row = requireRow((await client.query<{ id: string }>(
      `insert into public.orchestrator_budget_reservations (
         project_id,orchestrator_run_id,root_run_id,action_id,job_id,
         reservation_key,reservation_scope,estimated_usd,parent_reservation_id
       ) values ($1,$2,$3,$4,$5,$6,'operation',$7,$8) returning id`,
      [
        input.projectId, input.childRunId ?? execution.root_run_id,
        execution.root_run_id, input.actionId, input.jobId ?? null,
        input.reservationKey, input.estimatedUsd, execution.budget_reservation_id,
      ]
    )).rows, "Could not reserve child budget.");
    await client.query(
      `update public.rerun_execution_work_items
          set budget_reservation_keys=array_append(budget_reservation_keys,$2)
        where id=$1 and not ($2=any(budget_reservation_keys))`,
      [work.id, input.reservationKey]
    );
    return { reservationId: row.id, replayed: false };
  });
}
