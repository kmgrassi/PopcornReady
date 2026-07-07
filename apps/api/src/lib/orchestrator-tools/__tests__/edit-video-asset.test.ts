import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { V1Asset } from "@/lib/api/v1/store";
import { createEditVideoAssetTool } from "../edit-video-asset";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

function sourceAsset(overrides: Partial<V1Asset> = {}): V1Asset {
  return {
    id: overrides.id ?? "source_1",
    schemaVersion: "asset.v1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    kind: overrides.kind ?? "video",
    role: overrides.role ?? "beat_clip",
    filename: overrides.filename ?? "source.mp4",
    status: overrides.status ?? "ready",
    source: overrides.source ?? { type: "generated", generatedAssetId: "source_1" },
    storageKey: overrides.storageKey ?? "assets/source.mp4",
    durationSec: overrides.durationSec ?? 6,
    contentHash: overrides.contentHash ?? "source_hash",
    createdAt: "t",
    updatedAt: "t",
  };
}

test("edit_video_asset replays terminal jobs as succeeded tool results", async () => {
  let kicked = false;
  const tool = createEditVideoAssetTool({
    getAsset: async () => sourceAsset(),
    createJob: async () => ({
      created: false,
      job: {
        id: "job_1",
        type: "asset_generation",
        status: "succeeded",
        projectId: "proj_1",
        result: { assetIds: ["edited_1"], sourceAssetId: "source_1" },
        createdAt: "t",
        updatedAt: "t",
      },
    }),
    runEditVideoAssetJob: async () => {
      kicked = true;
    },
  });

  const result = await tool.execute(
    { sourceAssetId: "source_1", instruction: "Add a dinosaur." },
    { auth, projectId: "proj_1" }
  );

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.resourceIds, ["edited_1"]);
    assert.deepEqual(result.output?.assetIds, ["edited_1"]);
  }
  assert.equal(kicked, false);
});

test("edit_video_asset idempotency separates beat targets", async () => {
  const keys: string[] = [];
  const tool = createEditVideoAssetTool({
    getAsset: async () => sourceAsset(),
    createJob: async (input) => {
      keys.push(input.idempotencyKey ?? "");
      return {
        created: false,
        job: {
          id: `job_${keys.length}`,
          type: "asset_generation",
          status: "queued",
          projectId: "proj_1",
          createdAt: "t",
          updatedAt: "t",
        },
      };
    },
    runEditVideoAssetJob: async () => {},
  });

  await tool.execute(
    { sourceAssetId: "source_1", instruction: "Add a dinosaur.", beatId: "beat_1" },
    { auth, projectId: "proj_1" }
  );
  await tool.execute(
    { sourceAssetId: "source_1", instruction: "Add a dinosaur.", beatId: "beat_2" },
    { auth, projectId: "proj_1" }
  );

  assert.notEqual(keys[0], keys[1]);
});
