import assert from "node:assert/strict";
import { test } from "node:test";
import { staleAssetEmbeddingChunkKeys } from "./jobs";
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
