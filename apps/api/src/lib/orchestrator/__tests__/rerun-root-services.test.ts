import assert from "node:assert/strict";
import test from "node:test";
import { existingRootResult } from "../rerun-root-services";

test("pooled root replay returns the action-scoped measured cost", async () => {
  const result = await existingRootResult(
    {
      workspaceId: "workspace-1",
      projectId: "project-1",
      assetId: "asset-1",
      kind: "composite",
      role: "timeline",
      primitiveActionId: "action-1",
    },
    {
      getSnapshot: async () => ({
        id: "asset-1",
        kind: "composite",
        role: "timeline",
        content: {},
        contentHash: "hash-1",
      }),
      sumCost: async (actionId) => {
        assert.equal(actionId, "action-1");
        return 0.073;
      },
    }
  );

  assert.deepEqual(result, {
    assetId: "asset-1",
    intrinsicRole: "timeline",
    actualCostUsd: 0.073,
  });
});
