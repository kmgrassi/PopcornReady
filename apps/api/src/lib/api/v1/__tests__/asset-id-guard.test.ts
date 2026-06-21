import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeAssetIds, getAsset, getAssetMediaUrls } from "../store";
import { ApiError } from "../errors";

// A non-UUID asset reference must never hit the uuid `assets.id` column (that
// produced the opaque Postgres `22P02` error that aborted runs as
// `provider_failed`). `getAssetRow` now routes a non-UUID reference to the
// project-scoped `slug` column instead — so a handle like "character_homeowner"
// RESOLVES to the asset the generating agent named, rather than short-circuiting.
//
// Two paths still short-circuit to `not_found` before any query, so no live
// Supabase is needed here:
//   * a reference that normalizes to an empty slug (no resolvable handle), and
//   * `getAssetMediaUrls`, which has no projectId and so can't resolve a
//     project-scoped slug.
// Slug resolution for a well-formed handle is exercised by integration tests.
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

async function withDummySupabaseEnv(fn: () => Promise<void>): Promise<void> {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL ??= "https://dummy.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy-service-role-key";
  try {
    await fn();
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
}

const isNotFound = (assetId: string) => (err: unknown) =>
  err instanceof ApiError &&
  err.code === "not_found" &&
  new RegExp(assetId).test(err.message);

test("getAsset maps an unresolvable (empty-slug) reference to not_found without a DB round-trip", async () => {
  await withDummySupabaseEnv(async () => {
    // "!!!" normalizes to no slug, so there is nothing to resolve — not_found
    // before any query, never a 22P02 against the uuid id column.
    await assert.rejects(getAsset(WORKSPACE_ID, PROJECT_ID, "!!!"), isNotFound("!!!"));
  });
});

test("getAssetMediaUrls maps a non-UUID id to not_found without a DB round-trip", async () => {
  await withDummySupabaseEnv(async () => {
    await assert.rejects(
      getAssetMediaUrls(WORKSPACE_ID, "character_homeowner"),
      isNotFound("character_homeowner")
    );
  });
});

// Slug references must be canonicalized to uuids before they reach a uuid write
// column (input_asset_ids, asset_edges), or Postgres 22P02s on the write — the
// hazard a slug-tolerant read path would otherwise reintroduce.
test("canonicalizeAssetIds passes uuids through untouched (no DB round-trip)", async () => {
  await withDummySupabaseEnv(async () => {
    const ids = [
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ];
    assert.deepEqual(await canonicalizeAssetIds(WORKSPACE_ID, PROJECT_ID, ids), ids);
  });
});

test("canonicalizeAssetIds returns [] for an empty list", async () => {
  await withDummySupabaseEnv(async () => {
    assert.deepEqual(await canonicalizeAssetIds(WORKSPACE_ID, PROJECT_ID, []), []);
  });
});

test("canonicalizeAssetIds rejects an unresolvable (empty-slug) reference", async () => {
  await withDummySupabaseEnv(async () => {
    await assert.rejects(
      canonicalizeAssetIds(WORKSPACE_ID, PROJECT_ID, ["!!!"]),
      isNotFound("!!!")
    );
  });
});
