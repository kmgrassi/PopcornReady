import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildAssetEmbeddingSourceChunks } from "@popcorn/shared/assets/embeddings";
import { graphKindForMediaAsset } from "../store-content";

test("generic stills map to image while explicit production roles retain their kinds", () => {
  assert.equal(
    graphKindForMediaAsset({ kind: "image", role: "standalone_image", generated: true }),
    "image"
  );
  assert.equal(
    graphKindForMediaAsset({ kind: "image", role: null, generated: false }),
    "image"
  );
  assert.equal(
    graphKindForMediaAsset({ kind: "image", role: "character_anchor", generated: true }),
    "anchor"
  );
  for (const role of ["beat_keyframe", "beat_storyboard", "scene_storyboard", "act_mockup"]) {
    assert.equal(
      graphKindForMediaAsset({ kind: "image", role, generated: true }),
      "keyframe",
      role
    );
  }
});

test("generic image participates in media embedding source generation", () => {
  const chunks = buildAssetEmbeddingSourceChunks({
    id: "asset-image",
    projectId: "project-1",
    kind: "image",
    media: "image",
    status: "ready",
    role: "standalone_image",
    description: "A moonlit diner exterior.",
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.chunkKind, "media_description");
});

test("generic image enum and constraint/ref changes are split across migrations", () => {
  const enumSql = readFileSync(
    new URL("../../../../../../../supabase/migrations/20260727180000_generic_image_asset_kind_enum.sql", import.meta.url),
    "utf8"
  );
  const wiringSql = readFileSync(
    new URL("../../../../../../../supabase/migrations/20260727181000_generic_image_asset_kind.sql", import.meta.url),
    "utf8"
  );
  const pooledRegenerationSql = readFileSync(
    new URL("../../../../../../../supabase/migrations/20260727182000_pooled_image_regeneration.sql", import.meta.url),
    "utf8"
  );
  assert.match(enumSql, /add value if not exists 'image'/);
  assert.doesNotMatch(enumSql, /assets_kind_media/);
  assert.ok(wiringSql.includes("kind in ('image','anchor','keyframe','poster')"));
  assert.match(wiringSql, /when 'image'\s+then 'img'/);
  assert.match(pooledRegenerationSql, /v_old\.kind, v_old\.media/);
  assert.match(pooledRegenerationSql, /s\.claim_generation = p_session_claim_generation/);
  assert.match(pooledRegenerationSql, /s\.active_run_id = r\.id/);
  assert.doesNotMatch(pooledRegenerationSql, /update public\.story_panels/);
  assert.doesNotMatch(pooledRegenerationSql, /insert into public\.selections/);
});
