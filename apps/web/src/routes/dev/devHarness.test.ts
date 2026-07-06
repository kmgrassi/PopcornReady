import test from "node:test";
import assert from "node:assert/strict";
import {
  devHarnessRoutes,
  harnessRoutesForBuild,
  landingUploadHarnessItems,
  landingUploadStatusCounts,
  mediaGalleryHarnessAssets,
  mediaGalleryIntentPresets,
  selectedGalleryAssets,
  type LandingUploadHarnessStatus,
} from "./devHarness";

test("dev harness routes are included only for dev builds", () => {
  assert.deepEqual(harnessRoutesForBuild(false), []);
  assert.deepEqual(harnessRoutesForBuild(true), Object.values(devHarnessRoutes));
});

test("landing upload fixture covers every mobile upload state", () => {
  const counts = landingUploadStatusCounts(landingUploadHarnessItems);
  const requiredStatuses: LandingUploadHarnessStatus[] = [
    "queued",
    "uploading",
    "processing",
    "ready",
    "failed",
  ];

  for (const status of requiredStatuses) {
    assert.equal(counts[status] > 0, true, `${status} fixture is missing`);
  }
});

test("media gallery fixture covers asset statuses and ordered selection", () => {
  const statuses = new Set(mediaGalleryHarnessAssets.map((asset) => asset.status));

  assert.deepEqual(statuses, new Set(["ready", "processing", "pending", "failed"]));
  assert.deepEqual(
    selectedGalleryAssets(mediaGalleryHarnessAssets).map((asset) => asset.id),
    ["asset-selected-1", "asset-selected-2"],
  );
});

test("media gallery intent bar has exactly one active preset", () => {
  assert.equal(
    mediaGalleryIntentPresets.filter((preset) => preset.active).length,
    1,
  );
});
