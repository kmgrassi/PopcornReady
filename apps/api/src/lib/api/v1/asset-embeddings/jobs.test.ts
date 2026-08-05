import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAssetEmbeddingChunks, staleAssetEmbeddingChunkKeys } from "./jobs";
import type { AssetEmbeddingSourceChunk } from "./source";

function chunk(chunkKey: string): AssetEmbeddingSourceChunk {
  return {
    chunkKey,
    chunkKind: "asset_summary",
    sourceText: `Source for ${chunkKey}`,
    sourceHash: `hash:${chunkKey}`,
  };
}

test("staleAssetEmbeddingChunkKeys returns existing keys missing from rebuilt chunks", () => {
  assert.deepEqual(
    staleAssetEmbeddingChunkKeys(
      ["asset.summary", "asset.transcript", "asset.old"],
      [chunk("asset.summary")]
    ),
    ["asset.transcript", "asset.old"]
  );
});

test("staleAssetEmbeddingChunkKeys marks all existing keys stale when no chunks rebuild", () => {
  assert.deepEqual(
    staleAssetEmbeddingChunkKeys(["asset.summary", "asset.transcript"], []),
    ["asset.summary", "asset.transcript"]
  );
});

test("loadAssetEmbeddingChunks uses persisted graph identity from its source loader", async () => {
  const calls: string[][] = [];
  const { asset, chunks } = await loadAssetEmbeddingChunks(
    { workspaceId: "workspace_1", projectId: "project_1", assetId: "asset_1" },
    async (...args) => {
      calls.push(args);
      return {
        id: "asset_1",
        schemaVersion: "asset.v1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        kind: "image",
        graphKind: "image",
        media: "image",
        role: "standalone_image",
        filename: "generated.png",
        status: "ready",
        source: { type: "generated", generatedAssetId: "provider_asset_1" },
        userContext: { description: "Generated standalone artwork." },
        provenance: { provider: "openai", prompt: "Standalone artwork." },
        createdAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
      };
    }
  );

  assert.deepEqual(calls, [["workspace_1", "project_1", "asset_1"]]);
  assert.equal(asset.graphKind, "image");
  assert.match(chunks[0]?.sourceText ?? "", /Graph kind: image/);
  assert.doesNotMatch(chunks[0]?.sourceText ?? "", /Graph kind: keyframe/);
});
