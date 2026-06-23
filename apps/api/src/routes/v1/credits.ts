import { Router } from "express";
import { route } from "@/core/adapter";
import { getRequestSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { CREDIT_VALUE_USD } from "@/lib/api/v1/credits";

export const creditsRouter = Router();

interface CreditTxRow {
  id: string;
  seq: number;
  delta_credits: number;
  reason: string;
  balance_after: number;
  cost_usd: number | null;
  created_at: string;
}

function toWire(row: CreditTxRow) {
  return {
    id: row.id,
    deltaCredits: row.delta_credits,
    reason: row.reason,
    balanceAfter: row.balance_after,
    costUsd: row.cost_usd ?? null,
    createdAt: row.created_at,
  };
}

// Current balance. Reads through the RLS-enforced client, so it can only ever
// return the caller's own balance. Local-auth mode has no per-user wallet.
creditsRouter.get(
  "/credits",
  route(async ({ auth }) => {
    if (auth.isLocal) {
      return {
        status: 200,
        body: { balanceCredits: null, creditValueUsd: CREDIT_VALUE_USD, isLocal: true },
        headers: { "Cache-Control": "no-store" },
      };
    }
    const row = await runQuery(
      "credits.balance",
      getRequestSupabase().from("user_credits").select("balance_credits").maybeSingle()
    );
    const balanceCredits = (row as { balance_credits: number } | null)?.balance_credits ?? 0;
    return {
      status: 200,
      body: { balanceCredits, creditValueUsd: CREDIT_VALUE_USD },
      headers: { "Cache-Control": "no-store" },
    };
  })
);

// Ledger history (newest first), for the account/usage view.
creditsRouter.get(
  "/credits/transactions",
  route(async ({ auth, req }) => {
    if (auth.isLocal) {
      return { status: 200, body: { transactions: [] } };
    }
    const requested = Number(req.searchParams.get("limit") ?? 50);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 50, 1), 100);
    const rows = await runQuery(
      "credits.transactions",
      getRequestSupabase()
        .from("credit_transactions")
        .select("id,seq,delta_credits,reason,balance_after,cost_usd,created_at")
        .order("seq", { ascending: false })
        .limit(limit)
    );
    return {
      status: 200,
      body: { transactions: ((rows ?? []) as CreditTxRow[]).map(toWire) },
    };
  })
);
