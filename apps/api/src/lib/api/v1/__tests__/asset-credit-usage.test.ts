import assert from "node:assert/strict";
import test from "node:test";
import { getAssetCreditsCharged } from "../asset-credit-usage";

function deps(input: {
  actions?: Array<{ id: string; output_asset_ids: string[] }>;
  debits?: Array<{ action_id: string | null; delta_credits: number }>;
}) {
  return {
    listAssetActions: async () => input.actions ?? [],
    listGenerationDebits: async () => input.debits ?? [],
  };
}

test("returns the gross credits debited for an exact single-output asset action", async () => {
  const charged = await getAssetCreditsCharged("project", "asset", deps({
    actions: [{ id: "action", output_asset_ids: ["asset"] }],
    debits: [
      { action_id: "action", delta_credits: -40 },
      { action_id: "action", delta_credits: -44 },
      { action_id: "action", delta_credits: 10 },
    ],
  }));
  assert.equal(charged, 84);
});

test("returns null when attribution is absent, multi-output, or has no visible debit", async () => {
  assert.equal(await getAssetCreditsCharged("project", "asset", deps({})), null);
  assert.equal(await getAssetCreditsCharged("project", "asset", deps({
    actions: [{ id: "action", output_asset_ids: ["asset", "other"] }],
    debits: [{ action_id: "action", delta_credits: -84 }],
  })), null);
  assert.equal(await getAssetCreditsCharged("project", "asset", deps({
    actions: [{ id: "action", output_asset_ids: ["asset"] }],
    debits: [{ action_id: null, delta_credits: -84 }],
  })), null);
});
