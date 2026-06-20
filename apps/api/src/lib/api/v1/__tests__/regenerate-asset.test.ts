import assert from "node:assert/strict";
import test from "node:test";

import { regenerateImageAsset } from "../regenerate-asset";
import { ApiError } from "../errors";
import type { V1Asset } from "../store";

function imageAsset(overrides: Partial<V1Asset> = {}): V1Asset {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    schemaVersion: "asset.v1",
    workspaceId: "ws-1",
    projectId: "proj-1",
    kind: "image",
    filename: "old.png",
    status: "ready",
    source: { type: "generated", generatedAssetId: "" },
    visibility: "public",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    provenance: { provider: "openai", model: "gpt-image-1.5", prompt: "a saved prompt" },
    ...overrides,
  } as V1Asset;
}

function makeDeps(asset: V1Asset) {
  const calls: {
    generateImage?: { provider: string; model?: string; prompt: string };
    writeObject?: { assetId: string; filename: string; visibility: string };
    applyMedia?: { assetId: string; update: Record<string, unknown> };
  } = {};
  return {
    calls,
    deps: {
      getAsset: async () => asset,
      generateImage: async (input: { provider: string; model?: string; prompt: string }) => {
        calls.generateImage = input;
        return {
          kind: "image" as const,
          bytes: Buffer.from("png-bytes"),
          extension: "png",
          mimeType: "image/png",
          provider: "openai" as const,
          model: "gpt-image-1.5",
          prompt: input.prompt,
        };
      },
      writeObject: async (input: {
        assetId: string;
        filename: string;
        visibility: string;
      }) => {
        calls.writeObject = {
          assetId: input.assetId,
          filename: input.filename,
          visibility: input.visibility,
        };
        return {
          storageKey: `ws-1/proj-1/${input.assetId}/${input.filename}`,
          storageBucket: "popcornready-assets-public",
          contentType: "image/png",
        };
      },
      applyMedia: async (
        _workspaceId: string,
        assetId: string,
        update: Record<string, unknown>
      ) => {
        calls.applyMedia = { assetId, update };
        return {
          url: "https://cdn.example/new.png",
          thumbnailUrl: "https://cdn.example/new.png",
          expiresAt: "2026-06-20T01:00:00.000Z",
        };
      },
    },
  };
}

test("regenerates from the saved prompt and swaps media in place", async () => {
  const asset = imageAsset();
  const { calls, deps } = makeDeps(asset);

  const media = await regenerateImageAsset({
    workspaceId: "ws-1",
    assetId: asset.id,
    deps,
  });

  assert.equal(calls.generateImage?.prompt, "a saved prompt");
  assert.equal(calls.generateImage?.provider, "openai");
  assert.equal(calls.generateImage?.model, "gpt-image-1.5");
  // In-place: applyMedia targets the same asset id, with the live bucket set.
  assert.equal(calls.applyMedia?.assetId, asset.id);
  assert.equal(calls.applyMedia?.update.storageBucket, "popcornready-assets-public");
  assert.equal((calls.applyMedia?.update.provenance as { prompt: string }).prompt, "a saved prompt");
  assert.equal(media.url, "https://cdn.example/new.png");
});

test("a caller-supplied prompt wins over the saved one and is persisted", async () => {
  const asset = imageAsset();
  const { calls, deps } = makeDeps(asset);

  await regenerateImageAsset({
    workspaceId: "ws-1",
    assetId: asset.id,
    prompt: "  a brand new prompt  ",
    deps,
  });

  assert.equal(calls.generateImage?.prompt, "a brand new prompt");
  assert.equal((calls.applyMedia?.update.provenance as { prompt: string }).prompt, "a brand new prompt");
});

test("throws prompt_required when no prompt is saved or provided", async () => {
  const asset = imageAsset({ provenance: undefined });
  const { deps } = makeDeps(asset);

  await assert.rejects(
    regenerateImageAsset({ workspaceId: "ws-1", assetId: asset.id, deps }),
    (err: unknown) => err instanceof ApiError && err.code === "prompt_required"
  );
});

test("rejects non-image assets with asset_invalid", async () => {
  const asset = imageAsset({ kind: "video" });
  const { deps } = makeDeps(asset);

  await assert.rejects(
    regenerateImageAsset({ workspaceId: "ws-1", assetId: asset.id, deps }),
    (err: unknown) => err instanceof ApiError && err.code === "asset_invalid"
  );
});
