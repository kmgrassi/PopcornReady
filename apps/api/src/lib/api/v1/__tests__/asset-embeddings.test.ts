import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAssetEmbeddingSourceChunks,
  type AssetEmbeddingSourceAsset,
} from "@popcorn/shared/assets/embeddings";
import { assetEmbeddingSourceHash } from "../asset-embeddings";

test("buildAssetEmbeddingSourceChunks skips pending assets", () => {
  const chunks = buildAssetEmbeddingSourceChunks({
    id: "asset_1",
    projectId: "project_1",
    kind: "clip",
    media: "video",
    status: "pending",
    description: "A useful generated clip.",
  });

  assert.deepEqual(chunks, []);
});

test("buildAssetEmbeddingSourceChunks builds typed media summary and transcript chunks", () => {
  const asset: AssetEmbeddingSourceAsset = {
    id: "asset_1",
    projectId: "project_1",
    ref: "clip_ab12cd",
    kind: "clip",
    media: "video",
    status: "ready",
    role: "beat_clip",
    filename: "launch.mp4",
    description: "Hero customer launch shot.",
    params: {
      prompt: "Create a kinetic product launch clip.",
      providerResponse: { raw: "ignored" },
    },
    context: {
      summary: "Customer walks on stage.",
      transcriptText: "We built this for teams who move fast.",
      tags: ["launch", "customer"],
    },
    semanticAnalysis: {
      segments: [
        {
          visualDescription: "Bright stage with a founder presenting.",
          semanticTags: ["stage", "founder"],
        },
      ],
    },
  };

  const chunks = buildAssetEmbeddingSourceChunks(asset);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].chunkKey, "asset.summary");
  assert.equal(chunks[0].chunkKind, "media_description");
  assert.match(chunks[0].sourceText, /Kind: clip/);
  assert.match(chunks[0].sourceText, /Prompt: Create a kinetic product launch clip/);
  assert.match(chunks[0].sourceText, /Visual description: Bright stage/);
  assert.doesNotMatch(chunks[0].sourceText, /providerResponse/);
  assert.equal(chunks[1].chunkKey, "asset.transcript");
  assert.equal(chunks[1].chunkKind, "media_transcript");
  assert.match(chunks[1].sourceText, /We built this for teams who move fast/);
});

test("buildAssetEmbeddingSourceChunks embeds planning data from allowed typed fields", () => {
  const chunks = buildAssetEmbeddingSourceChunks({
    id: "asset_2",
    projectId: "project_1",
    kind: "brief",
    media: "data",
    status: "ready",
    content: {
      goal: "Explain the product in 30 seconds.",
      audience: "Busy operators",
      constraints: {
        brandVoice: "Plainspoken",
      },
      providerPayload: {
        rawCompletion: "ignored",
      },
    },
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunkKind, "planning_document");
  assert.match(chunks[0].sourceText, /Goal: Explain the product/);
  assert.match(chunks[0].sourceText, /Audience: Busy operators/);
  assert.match(chunks[0].sourceText, /Constraints:/);
  assert.doesNotMatch(chunks[0].sourceText, /rawCompletion/);
});

test("assetEmbeddingSourceHash is deterministic and changes with source text", () => {
  const [chunk] = buildAssetEmbeddingSourceChunks({
    id: "asset_3",
    projectId: "project_1",
    kind: "poster",
    media: "image",
    status: "ready",
    description: "Noir poster with a red umbrella.",
  });
  const changed = { ...chunk, sourceText: `${chunk.sourceText}\nSubject: umbrella` };

  assert.equal(assetEmbeddingSourceHash(chunk), assetEmbeddingSourceHash(chunk));
  assert.notEqual(assetEmbeddingSourceHash(chunk), assetEmbeddingSourceHash(changed));
});
