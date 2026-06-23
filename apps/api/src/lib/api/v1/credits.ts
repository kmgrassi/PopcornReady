// Server-side credit ledger access.
//
// All credit movement goes through the apply_credit_transaction RPC (atomic,
// balance-guarded, idempotent). This module is the typed server wrapper:
// generation debits (Phase 2) and Stripe purchases (Phase 3) call
// applyCreditTransaction; the read API and dashboards call getCreditBalance.
// 1 credit = $0.01.

import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";

export const CREDIT_VALUE_USD = 0.01;

export type CreditReason =
  | "signup_grant"
  | "purchase"
  | "generation_debit"
  | "refund"
  | "adjustment";

export interface ApplyCreditInput {
  userId: string;
  /** Positive to add (grant/purchase/refund), negative to debit. */
  deltaCredits: number;
  reason: CreditReason;
  runId?: string;
  actionId?: string;
  /** Raw provider cost a debit was derived from (audit only). */
  costUsd?: number;
  /** Dedupe key (e.g. a Stripe event id) — re-applying returns the prior tx. */
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface CreditTransaction {
  id: string;
  seq: number;
  deltaCredits: number;
  reason: CreditReason;
  balanceAfter: number;
  costUsd: number | null;
  createdAt: string;
}

interface CreditTxRow {
  id: string;
  seq: number;
  delta_credits: number;
  reason: CreditReason;
  balance_after: number;
  cost_usd: number | null;
  created_at: string;
}

function mapTx(row: CreditTxRow): CreditTransaction {
  return {
    id: row.id,
    seq: row.seq,
    deltaCredits: row.delta_credits,
    reason: row.reason,
    balanceAfter: row.balance_after,
    costUsd: row.cost_usd ?? null,
    createdAt: row.created_at,
  };
}

// Apply a credit delta atomically. Throws a `database_error` with dbCode 23514
// when a debit would overdraw the balance (callers surface that as
// `insufficient_credits`).
export async function applyCreditTransaction(
  input: ApplyCreditInput
): Promise<CreditTransaction> {
  const data = await runQuery(
    "credits.applyCreditTransaction",
    getServiceSupabase().rpc("apply_credit_transaction", {
      p_user_id: input.userId,
      p_delta: input.deltaCredits,
      p_reason: input.reason,
      p_run_id: input.runId ?? null,
      p_action_id: input.actionId ?? null,
      p_cost_usd: input.costUsd ?? null,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_metadata: input.metadata ?? {},
    })
  );
  return mapTx(data as CreditTxRow);
}

export async function getCreditBalance(userId: string): Promise<number> {
  const data = await runQuery(
    "credits.getCreditBalance",
    getServiceSupabase()
      .from("user_credits")
      .select("balance_credits")
      .eq("user_id", userId)
      .maybeSingle()
  );
  return (data as { balance_credits: number } | null)?.balance_credits ?? 0;
}
