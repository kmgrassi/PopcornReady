import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { V1Store } from "@/lib/v1/store";
import type { VersionedTimeline } from "@popcorn/shared/v1/types";
import { createCritiqueTimelineTool } from "../critique-timeline";
import type { CritiqueTimelineOutput } from "../critique-timeline";
import { ToolInputError, type ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const timeline: VersionedTimeline = {
  id: "timeline_1",
  schemaVersion: "timeline.v1",
  projectId: "proj_1",
  briefVersionId: "brief_1",
  aspectRatio: "16:9",
  fps: 30,
  segments: [
    {
      id: "seg_1",
      clipId: "clip_1",
      sourceInSec: 0,
      sourceOutSec: 4,
      role: "Hook",
      reason: "Open with the strongest visual.",
    },
  ],
  provenance: {
    briefVersionId: "brief_1",
    sourceAssetIds: ["clip_1"],
    generatedAssetJobIds: [],
    criticReport: null,
    appliedPatchCount: 0,
  },
  createdBy: { jobId: "job_1" },
  createdAt: "2026-06-17T00:00:00.000Z",
};

function storeWithTimelines(timelines: VersionedTimeline[]): V1Store {
  return {
    async listTimelinesForProject(projectId) {
      return timelines.filter((item) => item.projectId === projectId);
    },
    async getProject() {
      throw new Error("not used");
    },
    async getBriefVersion() {
      throw new Error("not used");
    },
    async getAsset() {
      throw new Error("not used");
    },
    async listAssets() {
      throw new Error("not used");
    },
    async getComposition() {
      throw new Error("not used");
    },
    async getJob() {
      throw new Error("not used");
    },
    async saveJob() {
      throw new Error("not used");
    },
    async getEditGraph() {
      throw new Error("not used");
    },
    async saveEditGraph() {
      throw new Error("not used");
    },
    async getTimeline() {
      throw new Error("not used");
    },
    async saveTimeline() {
      throw new Error("not used");
    },
    async getIdempotency() {
      throw new Error("not used");
    },
    async saveIdempotency() {
      throw new Error("not used");
    },
    async saveProject() {
      throw new Error("not used");
    },
    async saveBriefVersion() {
      throw new Error("not used");
    },
    async saveAsset() {
      throw new Error("not used");
    },
    async saveComposition() {
      throw new Error("not used");
    },
  } as V1Store;
}

test("critique_timeline requires an active timeline", async () => {
  const tool = createCritiqueTimelineTool({
    getStore: () => storeWithTimelines([]),
    runTimelineCritique: async () => {
      throw new Error("must not critique without a timeline");
    },
    ensureProjectTimelineAsset: async () => {
      throw new Error("must not create a timeline asset without a timeline");
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

test("critique_timeline projects the timeline and persists linked critique output", async () => {
  const calls: string[] = [];
  const tool = createCritiqueTimelineTool({
    getStore: () => storeWithTimelines([timeline]),
    ensureProjectTimelineAsset: async (input) => {
      calls.push(`timeline:${input.timelineId}`);
      assert.equal(input.workspaceId, "ws_1");
      assert.equal(input.projectId, "proj_1");
      assert.equal(input.timeline, timeline);
      return { assetId: "timeline_asset_1", contentHash: "timeline_hash" };
    },
    runTimelineCritique: async (input) => {
      calls.push(`critique:${input.timelineId}`);
      assert.equal(input.workspaceId, "ws_1");
      assert.equal(input.projectId, "proj_1");
      return {
        timelineId: input.timelineId,
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
        patches: [],
      };
    },
    addProjectTimelineCritique: async (input) => {
      calls.push(`persist:${input.timelineAssetId}`);
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
        patches: [],
      });
      return { critiqueAssetId: "critique_asset_1" };
    },
  });

  const result = (await tool.execute(
    {},
    { auth, projectId: "proj_1" }
  )) as ToolCallResult<CritiqueTimelineOutput>;
  assert.equal(result.status, "succeeded");
  assert.deepEqual(calls, [
    "timeline:timeline_1",
    "critique:timeline_1",
    "persist:timeline_asset_1",
  ]);
  if (result.status === "succeeded") {
    assert.deepEqual(result.resourceIds, ["critique_asset_1"]);
    assert.equal(result.output?.timelineAssetId, "timeline_asset_1");
    assert.equal(result.output?.critiqueAssetId, "critique_asset_1");
  }
});

test("critique_timeline rejects unsupported input fields", () => {
  const tool = createCritiqueTimelineTool();
  assert.throws(() => tool.parseInput({ timelineId: "timeline_1" }), ToolInputError);
  assert.throws(() => tool.parseInput("review this"), ToolInputError);
});
