import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { V1Asset } from "@/lib/api/v1/store";
import type { Timeline } from "@popcorn/shared/types";
import { createCritiqueTimelineTool } from "../critique-timeline";
import type { CritiqueTimelineOutput } from "../critique-timeline";
import { ToolInputError, type ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const timeline: Timeline = {
  aspectRatio: "16:9",
  fps: 30,
  segments: [
    {
      id: "seg_1",
      clipId: "clip_1",
      sourceInSec: 0,
      sourceOutSec: 4,
      role: "Hook",
      beatId: "beat_1",
      reason: "Open with the strongest visual.",
    },
  ],
};

const clipAsset: V1Asset = {
  id: "clip_1",
  schemaVersion: "asset.v1",
  workspaceId: "ws_1",
  projectId: "proj_1",
  kind: "video",
  filename: "clip.mp4",
  status: "ready",
  source: { type: "generated", generatedAssetId: "generated_clip" },
  remoteUrl: "https://example.invalid/clip.mp4",
  durationSec: 4,
  createdAt: "2026-06-17T00:00:00.000Z",
  updatedAt: "2026-06-17T00:00:00.000Z",
};

test("critique_timeline requires an active timeline graph asset", async () => {
  const tool = createCritiqueTimelineTool({
    getActiveProjectTimelineAsset: async () => null,
    listAssets: async () => {
      throw new Error("must not list assets without a timeline");
    },
    critique: async () => {
      throw new Error("must not critique without a timeline");
    },
    addProjectTimelineCritique: async () => {
      throw new Error("must not persist a critique without a timeline");
    },
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "assemble_timeline");
  }
});

test("critique_timeline reads the active timeline graph asset and persists linked critique output", async () => {
  const calls: string[] = [];
  const tool = createCritiqueTimelineTool({
    getActiveProjectTimelineAsset: async (input) => {
      calls.push("read-timeline");
      assert.equal(input.workspaceId, "ws_1");
      assert.equal(input.projectId, "proj_1");
      return {
        assetId: "timeline_asset_1",
        contentHash: "timeline_hash",
        timelineId: "timeline_1",
        timeline,
      };
    },
    listAssets: async (workspaceId, projectId) => {
      calls.push("list-assets");
      assert.equal(workspaceId, "ws_1");
      assert.equal(projectId, "proj_1");
      return { items: [clipAsset], nextCursor: null };
    },
    critique: async (input) => {
      calls.push("critique");
      assert.equal(input.timeline, timeline);
      assert.deepEqual(
        input.clips.map((clip) => clip.id),
        ["clip_1"]
      );
      assert.equal(input.plan.scenes[0]?.beats[0]?.id, "beat_1");
      return {
        report: {
          scores: {
            hook_score: 8,
            clarity_score: 7,
            pacing_score: 9,
            visual_variety: 8,
            script_coverage: 7,
            emotional_arc: 8,
            repetition_penalty: 1,
          },
          summary: "Strong cut; tighten the middle beat.",
        },
      };
    },
    addProjectTimelineCritique: async (input) => {
      calls.push("persist");
      assert.equal(input.timelineAssetId, "timeline_asset_1");
      assert.equal(input.timelineContentHash, "timeline_hash");
      assert.deepEqual(input.critique, {
        timelineId: "timeline_1",
        report: {
          scores: {
            hook_score: 8,
            clarity_score: 7,
            pacing_score: 9,
            visual_variety: 8,
            script_coverage: 7,
            emotional_arc: 8,
            repetition_penalty: 1,
          },
          summary: "Strong cut; tighten the middle beat.",
        },
      });
      return { critiqueAssetId: "critique_asset_1" };
    },
  });

  const result = (await tool.execute(
    {},
    { auth, projectId: "proj_1" }
  )) as ToolCallResult<CritiqueTimelineOutput>;
  assert.equal(result.status, "succeeded");
  assert.deepEqual(calls, ["read-timeline", "list-assets", "critique", "persist"]);
  if (result.status === "succeeded") {
    assert.deepEqual(result.resourceIds, ["critique_asset_1"]);
    assert.equal(result.output?.timelineId, "timeline_1");
    assert.equal(result.output?.timelineAssetId, "timeline_asset_1");
    assert.equal(result.output?.critiqueAssetId, "critique_asset_1");
  }
});

test("critique_timeline rejects unsupported input fields", () => {
  const tool = createCritiqueTimelineTool();
  assert.throws(() => tool.parseInput({ timelineId: "timeline_1" }), ToolInputError);
  assert.throws(() => tool.parseInput({ feedback: "focus on pacing" }), ToolInputError);
  assert.throws(() => tool.parseInput("review this"), ToolInputError);
});
