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
      return { url: "https://example.test/replacement.png", expiresAt: "2099-01-01T00:00:00.000Z" };
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
  });
  assert.deepEqual(result, {
    status: "succeeded",
    resourceIds: ["anchor_1"],
    output: { assetId: "anchor_1", url: "https://example.test/replacement.png" },
  });
});
