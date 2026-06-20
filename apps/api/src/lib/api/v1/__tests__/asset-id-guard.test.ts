import assert from "node:assert/strict";
import test from "node:test";

import { getAsset } from "../store";
import { ApiError } from "../errors";

// Regression: a non-UUID asset id must surface as a typed `not_found`
// precondition, not an opaque Postgres `22P02` (invalid input syntax for type
// uuid) database_error that aborts the run.
//
// Production failure this guards against: the character-anchor stage passed a
// character slug ("character_homeowner") into `getAsset`, which queries the
// uuid `assets.id` column. Postgres rejected it, the error escaped the
// `generateCharacterAnchor` autocreate self-heal (it only catches `not_found`),
// and the whole generation run failed as `provider_failed`.
//
// The guard short-circuits before any query, so no live Supabase is needed —
// dummy creds only satisfy lazy client construction (no network is performed).
test("getAsset maps a non-UUID id to not_found without a DB round-trip", async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL ??= "https://dummy.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy-service-role-key";
  try {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const projectId = "22222222-2222-4222-8222-222222222222";
    await assert.rejects(
      getAsset(workspaceId, projectId, "character_homeowner"),
      (err: unknown) =>
        err instanceof ApiError &&
        err.code === "not_found" &&
        /character_homeowner/.test(err.message)
    );
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});
