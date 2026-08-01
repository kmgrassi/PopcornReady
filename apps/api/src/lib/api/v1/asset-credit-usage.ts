import { getRequestSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";

interface AssetActionRow {
  id: string;
  output_asset_ids: string[];
}

interface CreditDebitRow {
  action_id: string | null;
  delta_credits: number;
}

interface AssetCreditUsageDeps {
  listAssetActions: (projectId: string, assetId: string) => Promise<AssetActionRow[]>;
  listGenerationDebits: (actionIds: string[]) => Promise<CreditDebitRow[]>;
}

async function listAssetActions(projectId: string, assetId: string): Promise<AssetActionRow[]> {
  const rows = await runQuery(
    "assetCreditUsage.assetActions",
    getRequestSupabase()
      .from("actions")
      .select("id,output_asset_ids")
      .eq("project_id", projectId)
      .contains("output_asset_ids", [assetId])
  );
  return (rows ?? []) as AssetActionRow[];
}

async function listGenerationDebits(actionIds: string[]): Promise<CreditDebitRow[]> {
  if (actionIds.length === 0) return [];
  const rows = await runQuery(
    "assetCreditUsage.generationDebits",
    getRequestSupabase()
      .from("credit_transactions")
      .select("action_id,delta_credits")
      .eq("reason", "generation_debit")
      .in("action_id", actionIds)
  );
  return (rows ?? []) as CreditDebitRow[];
}

const defaultDeps: AssetCreditUsageDeps = {
  listAssetActions,
  listGenerationDebits,
};

export async function getAssetCreditsCharged(
  projectId: string,
  assetId: string,
  deps: AssetCreditUsageDeps = defaultDeps
): Promise<number | null> {
  const actions = await deps.listAssetActions(projectId, assetId);
  const attributableIds = actions
    .filter((action) =>
      action.output_asset_ids.length === 1 && action.output_asset_ids[0] === assetId
    )
    .map((action) => action.id);
  if (attributableIds.length === 0) return null;

  const debits = await deps.listGenerationDebits(attributableIds);
  const creditsCharged = debits.reduce((total, row) => {
    if (!row.action_id || !attributableIds.includes(row.action_id) || row.delta_credits >= 0) {
      return total;
    }
    return total + Math.abs(row.delta_credits);
  }, 0);
  return creditsCharged > 0 ? creditsCharged : null;
}
