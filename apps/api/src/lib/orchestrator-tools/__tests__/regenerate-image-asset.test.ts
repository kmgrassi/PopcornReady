import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import { createRegenerateImageAssetTool } from "../regenerate-image-asset";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

test("regenerate_image_asset applies the replacement prompt to the selected image", async () => {
  let received: unknown;
  const tool = createRegenerateImageAssetTool({
    regenerateImageAsset: async (input) => {
      received = input;
      return {
        assetId: "anchor_2",
        url: "https://example.test/replacement.png",
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
    },
  });

  const result = await tool.execute(
    { assetId: "anchor_1", prompt: "Make the storefront colder.", provider: "openai" },
    { auth, projectId: "proj_1", requestId: "req_1" }
  );

  assert.deepEqual(received, {
    workspaceId: "ws_1",
    assetId: "anchor_1",
    prompt: "Make the storefront colder.",
    provider: "openai",
    requestId: "req_1",
    repointSurfaces: true,
  });
  assert.deepEqual(result, {
    status: "succeeded",
    resourceIds: ["anchor_2"],
    output: { assetId: "anchor_2", url: "https://example.test/replacement.png" },
  });
});

test("domain regeneration stays pooled and forces minor-safe image routing", async () => {
  let received: unknown;
  const tool = createRegenerateImageAssetTool({
    regenerateImageAsset: async (input) => {
      received = input;
      return {
        assetId: "image_2",
        url: "https://example.test/image-2.png",
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
    },
  });
  await tool.execute(
    { assetId: "image_1", prompt: "A photoreal teenage boy at the station." },
    {
      auth,
      projectId: "proj_1",
      domainTask: {} as never,
      actionId: "action-1",
      orchestratorRunId: "run-1",
      sessionClaimGeneration: 8,
    }
  );
  assert.deepEqual(received, {
    workspaceId: "ws_1",
    assetId: "image_1",
    prompt: "A photoreal teenage boy at the station.",
    provider: "gemini",
    actionId: "action-1",
    orchestratorRunId: "run-1",
    sessionClaimGeneration: 8,
    repointSurfaces: false,
  });
});
