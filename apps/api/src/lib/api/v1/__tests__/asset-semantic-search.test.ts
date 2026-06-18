import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../errors";
import {
  ASSET_EMBEDDING_DIMENSIONS,
  parseAssetSemanticSearch,
} from "../schemas";

function embedding(fill = 0.01): number[] {
  return Array.from({ length: ASSET_EMBEDDING_DIMENSIONS }, () => fill);
}

test("parseAssetSemanticSearch accepts a valid project asset search body", () => {
  const input = parseAssetSemanticSearch({
    q: "sunset beach b-roll",
    queryEmbedding: embedding(),
    limit: 12,
    embeddingModel: "text-embedding-3-small",
    media: "video",
    kind: "source_footage",
    role: "b_roll",
  });

  assert.equal(input.q, "sunset beach b-roll");
  assert.equal(input.queryEmbedding.length, ASSET_EMBEDDING_DIMENSIONS);
  assert.equal(input.limit, 12);
  assert.equal(input.embeddingModel, "text-embedding-3-small");
  assert.equal(input.media, "video");
  assert.equal(input.kind, "source_footage");
  assert.equal(input.role, "b_roll");
});

test("parseAssetSemanticSearch requires the configured vector dimensions", () => {
  assert.throws(
    () =>
      parseAssetSemanticSearch({
        q: "poster",
        queryEmbedding: [0.1, 0.2, 0.3],
      }),
    (error) => error instanceof ApiError && error.code === "validation_failed"
  );
});

test("parseAssetSemanticSearch rejects invalid filters", () => {
  assert.throws(
    () =>
      parseAssetSemanticSearch({
        q: "voiceover",
        queryEmbedding: embedding(),
        media: "reference",
      }),
    (error) => error instanceof ApiError && error.code === "validation_failed"
  );

  assert.throws(
    () =>
      parseAssetSemanticSearch({
        q: "voiceover",
        queryEmbedding: embedding(),
        kind: "unknown_kind",
      }),
    (error) => error instanceof ApiError && error.code === "validation_failed"
  );
});
