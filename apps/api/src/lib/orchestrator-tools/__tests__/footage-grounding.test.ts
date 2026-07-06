import assert from "node:assert/strict";
import test from "node:test";

import { buildFootageGroundingContext, buildFootageGroundingPrompt } from "../footage-grounding";
import type { V1Asset } from "@/lib/api/v1/store";

const baseAsset: V1Asset = {
  id: "asset_1",
  schemaVersion: "asset.v1",
  workspaceId: "ws_1",
  projectId: "proj_1",
  kind: "video",
  filename: "birthday.mov",
  status: "ready",
  source: { type: "remote_url", url: "https://example.com/birthday.mov" },
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

test("buildFootageGroundingPrompt includes transcript excerpts and source windows", () => {
  const prompt = buildFootageGroundingPrompt([
    {
      assetId: "asset_1",
      label: "birthday.mov",
      transcript: "Maya says happy birthday",
      moments: [{ startSec: 1, endSec: 3.5, label: "candles" }],
    },
  ]);

  assert.match(prompt ?? "", /Maya says happy birthday/);
  assert.match(prompt ?? "", /1\.00-3\.50s/);
  assert.match(prompt ?? "", /sourceWindow/);
});

test("buildFootageGroundingContext omits assets without transcripts or moments", async () => {
  const result = await buildFootageGroundingContext({
    workspaceId: "ws_1",
    projectId: "proj_1",
    listAssets: async () => ({
      items: [
        baseAsset,
        {
          ...baseAsset,
          id: "asset_2",
          context: {
            transcriptText: "testing one two three",
            moments: [{ startSec: 0, endSec: 2, label: "spoken intro" }],
          },
        },
      ],
      nextCursor: null,
    }),
  });

  assert.equal(result.excerpts.length, 1);
  assert.equal(result.excerpts[0].assetId, "asset_2");
  assert.match(result.promptText ?? "", /testing one two three/);
});
