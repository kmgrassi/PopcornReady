import assert from "node:assert/strict";
import { test } from "node:test";
import type { V1Asset } from "../store";
import { assetEmbeddingConfig } from "./config";
import { buildAssetEmbeddingSourceChunks } from "./source";

function asset(overrides: Partial<V1Asset> = {}): V1Asset {
  return {
    id: "asset_1",
    schemaVersion: "asset.v1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    kind: "video",
    filename: "launch.mp4",
    status: "ready",
    source: { type: "remote_url", url: "https://cdn.example.com/launch.mp4" },
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

test("buildAssetEmbeddingSourceChunks skips assets that are not ready", () => {
  const chunks = buildAssetEmbeddingSourceChunks(
    asset({
      status: "pending",
      userContext: { description: "A launch keynote." },
    })
  );
  assert.deepEqual(chunks, []);
});

test("buildAssetEmbeddingSourceChunks skips ready assets without searchable text", () => {
  const chunks = buildAssetEmbeddingSourceChunks(asset());
  assert.deepEqual(chunks, []);
});

test("buildAssetEmbeddingSourceChunks emits stable labeled summary and transcript chunks", () => {
  const chunks = buildAssetEmbeddingSourceChunks(
    asset({
      userContext: {
        title: "Launch keynote",
        description: "Founder introduces the product to customers.",
        people: ["Maya"],
        intendedUse: ["primary_footage"],
      },
      context: {
        transcriptText: "Today we are launching the fastest workflow.",
        moments: [{ startSec: 0, endSec: 4, label: "hook" }],
      },
      agentContext: {
        summary: "A confident product launch on stage.",
        mediaType: "video",
        subjects: ["founder", "stage"],
        actions: ["announces product"],
        likelyUses: ["primary_footage"],
        cautions: [],
        confidence: "high",
        sampledAssetIds: [],
        model: { provider: "openai", model: "gpt-4o-mini" },
      },
      semanticAnalysis: {
        schemaVersion: "semanticAnalysis.v1",
        assetId: "asset_1",
        createdAt: "2026-06-18T00:00:00.000Z",
        transcript: [],
        segments: [
          {
            id: "segment_1",
            assetId: "asset_1",
            startMs: 0,
            endMs: 4000,
            visualDescription: "Founder on a bright stage.",
            semanticTags: ["keynote", "launch"],
          },
        ],
      },
    })
  );

  assert.deepEqual(
    chunks.map((chunk) => [chunk.chunkKey, chunk.chunkKind]),
    [
      ["asset.summary", "asset_summary"],
      ["asset.transcript", "transcript"],
    ]
  );
  assert.match(chunks[0].sourceText, /Description: Founder introduces/);
  assert.match(chunks[0].sourceText, /Visual description: Founder on a bright stage/);
  assert.match(chunks[1].sourceText, /Transcript: Today we are launching/);
  assert.equal(chunks[0].sourceHash.length, 64);
});

test("assetEmbeddingConfig pins model dimensions to the migration vector size", () => {
  assert.deepEqual(assetEmbeddingConfig({}), {
    model: "text-embedding-3-small",
    dimensions: 1536,
  });

  assert.throws(
    () => assetEmbeddingConfig({ ASSET_EMBEDDING_DIMENSIONS: "3072" }),
    /migration is changed/
  );
});
