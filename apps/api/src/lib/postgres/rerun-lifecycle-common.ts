import type { PoolClient, QueryResultRow } from "pg";
import { ApiError } from "@/core/errors";
import { withTransaction } from "./transactions";

export type RerunTransaction = typeof withTransaction;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function lifecycleTransaction<T>(
  operation: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withTransaction(operation, callback).catch((error: unknown) => {
    if (error instanceof ApiError) throw error;
    const candidate = error as { code?: string; message?: string; detail?: string };
    const message = `${candidate.message ?? ""} ${candidate.detail ?? ""}`;
    if (message.includes("stale_proposal")) {
      throw new ApiError("stale_proposal", "Proposal inputs changed; refresh before continuing.");
    }
    if (
      message.includes("replay_mismatch") ||
      message.includes("idempotency_conflict") ||
      candidate.code === "23505"
    ) {
      throw new ApiError("idempotency_conflict", "Idempotency key was reused with different input.");
    }
    if (message.includes("lease") || message.includes("callback_fence")) {
      throw new ApiError("idempotency_in_progress", "Another execution worker owns the active lease.");
    }
    if (message.includes("budget") || message.includes("ceiling")) {
      throw new ApiError("budget_exceeded", "The approved or root budget cannot admit this work.");
    }
    if (candidate.code === "P0002") {
      throw new ApiError("not_found", "Proposal lifecycle record was not found.");
    }
    throw error;
  });
}

export function requireRow<Row extends QueryResultRow>(
  rows: Row[],
  message: string
): Row {
  const row = rows[0];
  if (!row) throw new ApiError("not_found", message);
  return row;
}

export interface LockedExecution extends QueryResultRow {
  id: string;
  proposal_action_id: string;
  project_id: string;
  root_run_id: string;
  approval_action_id: string;
  budget_reservation_id: string;
  owns_materialized_root: boolean;
  approved_max_cost_usd: number;
  status: string;
  lease_token: string | null;
  lease_generation: number;
  lease_expires_at: Date | string | null;
  lease_live: boolean;
  lease_expired: boolean;
  execution_result_action_id: string | null;
}

export async function lockExecution(
  client: PoolClient,
  projectId: string,
  reservationId: string
): Promise<LockedExecution> {
  const result = await client.query<LockedExecution>(
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
      where id = $1 and project_id = $2
      for update`,
    [reservationId, projectId]
  );
  return requireRow(result.rows, "Execution reservation not found.");
}

export function assertLiveLease(
  execution: LockedExecution,
  token: string,
  generation: number
): void {
  if (
    execution.status !== "running" ||
    execution.lease_token !== token ||
    execution.lease_generation !== generation ||
    !execution.lease_live
  ) {
    throw new ApiError(
      "idempotency_in_progress",
      "Another execution worker owns the active lease."
    );
  }
}

export async function lockWork(
  client: PoolClient,
  reservationId: string,
  workItemId: string
) {
  const result = await client.query(
    `select id, execution_reservation_id, project_id, work_item_id,
            request_fingerprint, dispatch_action_id, child_run_id,
            report_action_id, reconciliation_action_id, status,
            lease_generation, output_asset_ids, binding_results,
            accepted_callbacks, blocked_precondition, primitive_action_ids,
            budget_reservation_keys, error
       from public.rerun_execution_work_items
      where execution_reservation_id = $1 and work_item_id = $2
      for update`,
    [reservationId, workItemId]
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

export function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
