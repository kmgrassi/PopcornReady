import test from "node:test";
import assert from "node:assert/strict";
import {
  assetDisplayTitle,
  formatDuration,
  galleryRenderState,
  projectMediaQueryKey,
  projectMediaQueryParams,
  shouldPollProjectMediaAssets,
  statusLabel,
} from "./projectMediaGallery";

test("project media query key is stable by project and params", () => {
  assert.deepEqual(projectMediaQueryParams(), { limit: 100 });
  assert.deepEqual(projectMediaQueryKey("project_123"), [
    "projects",
    "project_123",
    "assets",
    { limit: 100 },
  ]);
});

test("project media polling is active only while assets are processing", () => {
  assert.equal(shouldPollProjectMediaAssets([]), false);
  assert.equal(
    shouldPollProjectMediaAssets([{ status: "ready" }, { status: "failed" }]),
    false,
  );
  assert.equal(
    shouldPollProjectMediaAssets([{ status: "ready" }, { status: "processing" }]),
    true,
  );
});

test("gallery render state prioritizes loading and error states", () => {
  assert.equal(galleryRenderState({ loading: true, error: null, assets: [] }), "loading");
  assert.equal(
    galleryRenderState({ loading: false, error: new Error("nope"), assets: [] }),
    "error",
  );
  assert.equal(galleryRenderState({ loading: false, error: null, assets: [] }), "empty");
  assert.equal(
    galleryRenderState({
      loading: false,
      error: null,
      assets: [
        {
          id: "asset_1",
          schemaVersion: "asset.v1",
          workspaceId: "workspace_1",
          projectId: "project_1",
          kind: "video",
          status: "ready",
          filename: "clip.mp4",
          url: "https://example.invalid/clip.mp4",
          durationSec: 12,
          source: "upload",
          createdAt: "2026-07-06T00:00:00.000Z",
          updatedAt: "2026-07-06T00:00:00.000Z",
        },
      ],
    }),
    "ready",
  );
});

test("gallery formatting helpers keep tile labels compact", () => {
  assert.equal(assetDisplayTitle({ id: "asset_1", filename: "clip.mp4" }), "clip.mp4");
  assert.equal(
    assetDisplayTitle({ id: "asset_1", filename: "clip.mp4", name: "Opening shot" }),
    "Opening shot",
  );
  assert.equal(formatDuration(64.2), "1:04");
  assert.equal(formatDuration(undefined), null);
  assert.equal(statusLabel("pending"), "Processing");
  assert.equal(statusLabel("failed"), "Failed");
});
