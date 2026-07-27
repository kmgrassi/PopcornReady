// Runtime budget controls for finite orchestrator runs. These functions only
// admit/settle work; model_call_costs and credit_transactions remain the cost
// and charge records. All operations are one RPC so a concurrent domain fan-out
// cannot both pass a stale root-family budget check.

import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { ApiError } from "./errors";

export interface ReserveOrchestratorBudgetInput {
  projectId: string;
  runId?: string;
  actionId: string;
  jobId?: string;
  reservationKey: string;
  estimatedUsd: number;
  reservationScope?: "operation" | "run_ceiling";
}

export interface BudgetReservation {
  reservationId: string;
  rootRunId: string;
  reservedUsd: number;
  replayed: boolean;
}

function validAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Reserve before starting provider work. Requests without a durable run keep
 * the previous no-run behavior; all finite/root runs take the atomic path.
 */
export async function reserveOrchestratorBudget(
  input: ReserveOrchestratorBudgetInput
): Promise<BudgetReservation | null> {
  if (!input.runId) return null;
  if (!validAmount(input.estimatedUsd)) {
    throw new ApiError("validation_failed", "Budget estimate must be a non-negative number.");
  }
  const rows = await runQuery(
    "orchestratorBudget.reserve",
    getServiceSupabase().rpc("reserve_orchestrator_run_budget", {
      p_project_id: input.projectId,
      p_run_id: input.runId,
      p_action_id: input.actionId,
      p_job_id: input.jobId ?? null,
      p_reservation_key: input.reservationKey,
      p_estimated_usd: input.estimatedUsd,
      p_reservation_scope: input.reservationScope ?? "operation",
    })
  );
  const row = (rows as Array<{
    reservation_id: string;
    root_run_id: string;
    reserved_usd: number;
    replayed: boolean;
  }>)[0];
  if (!row) throw new ApiError("internal_error", "Budget reservation returned no result.");
  return {
    reservationId: row.reservation_id,
    rootRunId: row.root_run_id,
    reservedUsd: Number(row.reserved_usd),
    replayed: row.replayed,
  };
}

export async function settleOrchestratorBudget(input: {
  projectId: string;
  reservationKey: string;
  actualUsd: number;
  billingUserId?: string;
  billableUsd?: number;
}): Promise<{ settled: boolean; runId: string; actualUsd: number }> {
  if (!validAmount(input.actualUsd)) {
    throw new ApiError("validation_failed", "Actual cost must be a non-negative number.");
  }
  const rows = await runQuery(
    "orchestratorBudget.settle",
    getServiceSupabase().rpc("settle_orchestrator_run_budget", {
      p_project_id: input.projectId,
      p_reservation_key: input.reservationKey,
      p_actual_usd: input.actualUsd,
      p_billing_user_id: input.billingUserId ?? null,
      p_billable_usd: input.billableUsd ?? 0,
    })
  );
  const row = (rows as Array<{ settled: boolean; run_id: string; actual_usd: number }>)[0];
  if (!row) throw new ApiError("internal_error", "Budget settlement returned no result.");
  return { settled: row.settled, runId: row.run_id, actualUsd: Number(row.actual_usd) };
}

export async function recordOrchestratorBudgetBilling(input: {
  projectId: string;
  reservationKey: string;
  billingUserId: string;
  billableUsd: number;
}): Promise<void> {
  if (!validAmount(input.billableUsd)) {
    throw new ApiError("validation_failed", "Billable cost must be a non-negative number.");
  }
  await runQuery(
    "orchestratorBudget.recordBilling",
    getServiceSupabase().rpc("record_orchestrator_budget_billing", {
      p_project_id: input.projectId,
      p_reservation_key: input.reservationKey,
      p_billing_user_id: input.billingUserId,
      p_billable_usd: input.billableUsd,
    })
  );
}

export async function releaseOrchestratorBudget(input: {
  projectId: string;
  reservationKey: string;
  reason: string;
}): Promise<{ released: boolean; runId: string }> {
  const rows = await runQuery(
    "orchestratorBudget.release",
    getServiceSupabase().rpc("release_orchestrator_run_budget", {
      p_project_id: input.projectId,
      p_reservation_key: input.reservationKey,
      p_reason: input.reason,
    })
  );
  const row = (rows as Array<{ released: boolean; run_id: string }>)[0];
  if (!row) throw new ApiError("internal_error", "Budget release returned no result.");
  return { released: row.released, runId: row.run_id };
}
