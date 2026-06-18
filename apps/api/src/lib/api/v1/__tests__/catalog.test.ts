import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchText } from "../catalog";
import { ApiError } from "../errors";
import {
  parseCatalogEntriesQuery,
  parsePublishCatalogEntry,
  parseUpdateCatalogEntry,
} from "../schemas";

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

test("parseUpdateCatalogEntry allows archive status", () => {
  assert.deepEqual(parseUpdateCatalogEntry({ status: "archived" }), {
    status: "archived",
  });
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
