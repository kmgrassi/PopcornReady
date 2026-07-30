// The cost/usage sidecar to `actions`.
//
// One row per model/API call: what the call cost us (provider cost), with the
// raw quantity so cost can be recomputed when rates improve. `actions` stays a
// pure provenance log; this is the optional ledger the core never depends on.
// Distinct from credit_transactions (what we charge the user).

import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";

export type CostUnit = "tokens" | "characters" | "seconds" | "images";

export interface RecordModelCallCostInput {
  projectId: string;
  /** The provenance action this cost belongs to; omit for agent reasoning glue. */
  actionId?: string;
  runId?: string;
  provider: string;
  model?: string;
  unit: CostUnit;
  quantity: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  /** false once cost is a measured/reconciled figure rather than a modeled rate. */
  isEstimate?: boolean;
  /** Stable provider/model-call identity; makes crash retries a no-op. */
  idempotencyKey?: string;
}

export async function recordModelCallCost(
  input: RecordModelCallCostInput
): Promise<void> {
  await runQuery(
    "store.recordModelCallCost",
    getServiceSupabase()
      .from("model_call_costs")
      .upsert({
        project_id: input.projectId,
        action_id: input.actionId ?? null,
        run_id: input.runId ?? null,
        provider: input.provider,
        model: input.model ?? null,
        unit: input.unit,
        quantity: input.quantity,
        input_tokens: input.inputTokens ?? null,
        output_tokens: input.outputTokens ?? null,
        cost_usd: input.costUsd,
        is_estimate: input.isEstimate ?? true,
        idempotency_key: input.idempotencyKey ?? null,
      }, { onConflict: "idempotency_key", ignoreDuplicates: true })
  );
}

// Total recorded cost for an orchestrator run (used by budget gating). Calls are
// reserved at start, so in-flight generations are already counted here; callers
// add the about-to-spend estimate for the call they're checking.
export async function sumRunCostUsd(runId: string): Promise<number> {
  const rows = await runQuery(
    "store.sumRunCostUsd",
    getServiceSupabase()
      .from("model_call_costs")
      .select("cost_usd")
      .eq("run_id", runId)
  );
  return ((rows ?? []) as Array<{ cost_usd: number | null }>).reduce(
    (sum, row) => sum + (row.cost_usd ?? 0),
    0
  );
}

export async function sumActionCostUsd(actionId: string): Promise<number> {
  const rows = await runQuery(
    "store.sumActionCostUsd",
    getServiceSupabase()
      .from("model_call_costs")
      .select("cost_usd")
      .eq("action_id", actionId)
  );
  return ((rows ?? []) as Array<{ cost_usd: number | null }>).reduce(
    (sum, row) => sum + (row.cost_usd ?? 0),
    0
  );
}
