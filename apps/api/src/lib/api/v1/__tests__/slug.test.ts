import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSlug } from "../naming";

test("normalizeSlug lowercases and hyphenates", () => {
  assert.equal(normalizeSlug("Homeowner"), "homeowner");
  assert.equal(normalizeSlug("Leaf Blower Cleanup"), "leaf-blower-cleanup");
});

test("normalizeSlug collapses underscores and punctuation so read/write agree", () => {
  // The anchor plan ids use underscores ("character_homeowner"); a slug lookup
  // must normalize to the same value the asset was stored under.
  assert.equal(normalizeSlug("character_homeowner"), "character-homeowner");
  assert.equal(normalizeSlug("location__driveway!!"), "location-driveway");
});

test("normalizeSlug trims leading/trailing separators", () => {
  assert.equal(normalizeSlug("  --Hero Shot--  "), "hero-shot");
});

test("normalizeSlug returns null for empty/garbage input", () => {
  assert.equal(normalizeSlug("!!!"), null);
  assert.equal(normalizeSlug(""), null);
  assert.equal(normalizeSlug("   "), null);
  assert.equal(normalizeSlug(undefined), null);
  assert.equal(normalizeSlug(42), null);
});

test("normalizeSlug caps length", () => {
  const slug = normalizeSlug("a".repeat(200));
  assert.ok(slug && slug.length <= 48);
});
