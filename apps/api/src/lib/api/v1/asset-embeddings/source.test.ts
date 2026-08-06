import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapAssetEmbeddingSourceRow,
  type V1AssetEmbeddingSource,
} from "../store";
import { assetEmbeddingConfig } from "./config";
import { buildAssetEmbeddingSourceChunks } from "./source";

function asset(
  overrides: Partial<V1AssetEmbeddingSource> = {}
): V1AssetEmbeddingSource {
  return {
    id: "asset_1",
    schemaVersion: "asset.v1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    kind: "video",
    graphKind: "source_footage",
    media: "video",
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

test("buildAssetEmbeddingSourceChunks preserves persisted generic image identity", () => {
  const [chunk] = buildAssetEmbeddingSourceChunks(
    asset({
      kind: "image",
      graphKind: "image",
      media: "image",
      role: "standalone_image",
      filename: "diner.png",
      userContext: { description: "A moonlit diner exterior." },
      provenance: {
        provider: "openai",
        prompt: "A moonlit diner exterior.",
      },
    })
  );

  assert.ok(chunk);
  assert.match(chunk.sourceText, /Asset kind: image/);
  assert.match(chunk.sourceText, /Graph kind: image/);
  assert.match(chunk.sourceText, /Role: standalone_image/);
  assert.match(chunk.sourceText, /Generation prompt: A moonlit diner exterior/);
  assert.doesNotMatch(chunk.sourceText, /Graph kind: keyframe/);
});

test("database row projection preserves graph kind over conflicting role and provenance", () => {
  const row = {
    id: "asset_db_1",
    schema_version: "asset.v1",
    workspace_id: "workspace_1",
    project_id: "project_1",
    lineage_id: "lineage_1",
    version: 1,
    kind: "image" as const,
    media: "image" as const,
    status: "ready" as const,
    role: "standalone_image",
    name: "Moonlit diner",
    slug: "moonlit-diner",
    filename: "diner.png",
    content: null,
    params: {
      schema_version: "asset_params.v1",
      provenance: {
        provider: "openai",
        prompt: "A moonlit diner exterior.",
      },
    },
    inputs: [],
    content_hash: "content_hash_1",
    inputs_fingerprint: "inputs_fingerprint_1",
    remote_url: null,
    storage_key: "projects/project_1/assets/asset_db_1/diner.png",
    storage_bucket: "media",
    source: { type: "generated" as const, generatedAssetId: "provider_asset_1" },
    duration_sec: null,
    description: "A moonlit diner exterior.",
    context: {
      userContext: {
        description: "A moonlit diner exterior.",
        tags: ["diner", "night"],
      },
    },
    semantic_analysis: null,
    created_at: "2026-08-05T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
  };

  const genericImage = mapAssetEmbeddingSourceRow(row);
  const keyframe = mapAssetEmbeddingSourceRow({ ...row, kind: "keyframe" });
  const [genericChunk] = buildAssetEmbeddingSourceChunks(genericImage);
  const [keyframeChunk] = buildAssetEmbeddingSourceChunks(keyframe);

  assert.equal(genericImage.graphKind, "image");
  assert.equal(genericImage.media, "image");
  assert.equal(genericImage.provenance?.provider, "openai");
  assert.deepEqual(genericImage.userContext?.tags, ["diner", "night"]);
  assert.match(genericChunk.sourceText, /Graph kind: image/);
  assert.match(genericChunk.sourceText, /Generation prompt: A moonlit diner exterior/);
  assert.match(genericChunk.sourceText, /Tags: diner, night/);
  assert.match(keyframeChunk.sourceText, /Graph kind: keyframe/);
});

test("buildAssetEmbeddingSourceChunks trusts persisted keyframe identity", () => {
  const [chunk] = buildAssetEmbeddingSourceChunks(
    asset({
      kind: "image",
      graphKind: "keyframe",
      media: "image",
      role: "standalone_image",
      userContext: { description: "A persisted keyframe." },
    })
  );

  assert.ok(chunk);
  assert.match(chunk.sourceText, /Graph kind: keyframe/);
});

test("buildAssetEmbeddingSourceChunks rejects invalid persisted kind and media pairs", () => {
  assert.deepEqual(
    buildAssetEmbeddingSourceChunks(
      asset({
        kind: "video",
        graphKind: "keyframe",
        media: "video",
        userContext: { description: "Invalid keyframe media." },
      })
    ),
    []
  );
  assert.deepEqual(
    buildAssetEmbeddingSourceChunks(
      asset({
        kind: "video",
        graphKind: "brief",
        media: "data",
        userContext: { description: "Planning content needs a typed source path." },
      })
    ),
    []
  );
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
