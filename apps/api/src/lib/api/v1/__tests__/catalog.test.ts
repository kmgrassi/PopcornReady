import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalogAssetSource, buildSearchText, searchCatalogEntries } from "../catalog";
import type { CatalogDb } from "../catalog-types";
import { ApiError } from "../errors";
import {
  parseCatalogEntriesQuery,
  parsePublishCatalogEntry,
  parseUseCatalogEntry,
  parseUpdateCatalogEntry,
} from "../schemas";

function fakeRpcDb() {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const from: CatalogDb["from"] = () => {
    throw new Error("fakeRpcDb.from should not be called in searchCatalogEntries tests");
  };
  const rpc: CatalogDb["rpc"] = (name, params) => {
    calls.push({ name, params: params ?? {} });
    return Promise.resolve({ data: [], error: null });
  };
  return {
    calls,
    db: { from, rpc } satisfies CatalogDb,
  };
}

test("searchCatalogEntries passes the curated-text query embedding to the RPC", async () => {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const { calls, db } = fakeRpcDb();
    await searchCatalogEntries(
      { q: "cyberpunk hero", limit: 10, cursor: null },
      { db, embeddingProvider: { embed: async () => [0.1, 0.2, 0.3] } }
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "search_public_catalog_entries");
    assert.equal(calls[0].params.query_embedding, "[0.1,0.2,0.3]");
    assert.equal(typeof calls[0].params.query_model, "string");
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  }
});

test("searchCatalogEntries falls back to full-text (null embedding) without an API key", async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { calls, db } = fakeRpcDb();
    let embedCalls = 0;
    await searchCatalogEntries(
      { q: "cyberpunk hero", limit: 10, cursor: null },
      {
        db,
        embeddingProvider: {
          embed: async () => {
            embedCalls += 1;
            return [0.1, 0.2, 0.3];
          },
        },
      }
    );
    assert.equal(embedCalls, 0, "must not embed without an API key");
    assert.equal(calls[0].params.query_embedding, null);
    assert.equal(calls[0].params.query_model, null);
  } finally {
    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
  }
});

test("parsePublishCatalogEntry accepts image-backed entries", () => {
  assert.deepEqual(
    parsePublishCatalogEntry({
      kind: "image",
      sourceAssetId: "asset_1",
      title: "Cafe palette",
      summary: "Warm neighborhood cafe reference.",
      tags: ["cafe", "warm"],
    }),
    {
      kind: "image",
      sourceAssetId: "asset_1",
      title: "Cafe palette",
      summary: "Warm neighborhood cafe reference.",
      tags: ["cafe", "warm"],
      status: "published",
    }
  );
});

test("parsePublishCatalogEntry rejects story entries without a blueprint source", () => {
  assert.throws(() => parsePublishCatalogEntry({ kind: "story", title: "Missing source" }), {
    name: "ApiError",
  });
  try {
    parsePublishCatalogEntry({ kind: "story", title: "Missing source" });
  } catch (err) {
    assert.ok(err instanceof ApiError);
    assert.equal(err.details?.fields?.[0]?.path, "sourceStoryBlueprintId");
  }
});

test("parsePublishCatalogEntry rejects draft status until private draft previews exist", () => {
  try {
    parsePublishCatalogEntry({
      kind: "image",
      sourceAssetId: "asset_1",
      title: "Draft image",
      status: "draft",
    });
    assert.fail("Expected draft publish validation to fail.");
  } catch (err) {
    assert.ok(err instanceof ApiError);
    assert.equal(err.details?.fields?.[0]?.path, "status");
  }
});

test("parsePublishCatalogEntry requires kind before publish side effects", () => {
  try {
    parsePublishCatalogEntry({
      sourceAssetId: "asset_1",
      title: "Missing kind",
    });
    assert.fail("Expected missing kind to fail.");
  } catch (err) {
    assert.ok(err instanceof ApiError);
    assert.equal(err.details?.fields?.[0]?.path, "kind");
  }
});

test("parseUpdateCatalogEntry allows archive status", () => {
  assert.deepEqual(parseUpdateCatalogEntry({ status: "archived" }), {
    status: "archived",
  });
});

test("parseUpdateCatalogEntry rejects draft status", () => {
  try {
    parseUpdateCatalogEntry({ status: "draft" });
    assert.fail("Expected draft update validation to fail.");
  } catch (err) {
    assert.ok(err instanceof ApiError);
    assert.equal(err.details?.fields?.[0]?.path, "status");
  }
});

test("parseCatalogEntriesQuery validates catalog kind", () => {
  const params = new URLSearchParams("kind=character&limit=25&cursor=50");
  assert.deepEqual(parseCatalogEntriesQuery(params), {
    kind: "character",
    limit: 25,
    cursor: "50",
  });
});

test("buildSearchText compacts whitespace and caps length", () => {
  const text = buildSearchText(["  Hero   anchor ", undefined, " cafe\nstory "]);
  assert.equal(text, "Hero anchor cafe story");
  assert.equal(buildSearchText(["x".repeat(6000)]).length, 5000);
});

test("parseUseCatalogEntry requires a target project", () => {
  assert.deepEqual(parseUseCatalogEntry({ targetProjectId: "project_1" }), {
    targetProjectId: "project_1",
  });
  assert.throws(() => parseUseCatalogEntry({}), { name: "ApiError" });
});

test("buildCatalogAssetSource stamps asset clone provenance in assets.source", () => {
  assert.deepEqual(
    buildCatalogAssetSource({
      catalogEntryId: "entry_1",
      sourceAssetId: "asset_source_1",
    }),
    {
      type: "catalog",
      catalogEntryId: "entry_1",
      sourceAssetId: "asset_source_1",
    }
  );
});

test("buildCatalogAssetSource stamps story clone provenance without live references", () => {
  assert.deepEqual(
    buildCatalogAssetSource({
      catalogEntryId: "entry_2",
      sourceStoryBlueprintId: "story_source_1",
    }),
    {
      type: "catalog",
      catalogEntryId: "entry_2",
      sourceStoryBlueprintId: "story_source_1",
    }
  );
});
