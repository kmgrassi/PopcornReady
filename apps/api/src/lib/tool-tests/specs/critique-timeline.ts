import { randomUUID } from "node:crypto";

import { addAsset, addProjectTimeline } from "@/lib/api/v1/store";
import type { Timeline } from "@popcorn/shared/types";
import type { ToolBattery } from "../types";

async function seedTimeline(sandbox: { workspaceId: string; projectId: string }) {
  const now = new Date().toISOString();
  const assetId = randomUUID();
  await addAsset({
    id: assetId,
    schemaVersion: "asset.v1",
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    kind: "video",
    status: "ready",
    filename: "tool-test-clip.mp4",
    remoteUrl: "https://example.invalid/tool-test-clip.mp4",
    durationSec: 4,
    source: { type: "generated", generatedAssetId: "tool_test_clip" },
    createdAt: now,
    updatedAt: now,
  });

  const timeline: Timeline = {
    aspectRatio: "16:9",
    fps: 30,
    segments: [
      {
        id: "segment_1",
        clipId: assetId,
        sourceInSec: 0,
        sourceOutSec: 4,
        role: "Hook",
        beatId: "beat_1",
        reason: "Open on the clearest generated visual.",
      },
    ],
  };
  await addProjectTimeline({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    timeline,
    graphInputs: [],
  });
}

export const critiqueTimelineBattery: ToolBattery = {
  tool: "critique_timeline",
  cases: [
    {
      name: "requires an assembled timeline before critiquing",
      instruction: "Review the assembled timeline and list targeted fixes.",
      expect: { tool: "critique_timeline", callStatus: "failed" },
      verify: ({ result }) => {
        const failures: string[] = [];
        if (result?.status !== "failed") {
          failures.push(`expected a failed result, got ${result?.status}`);
          return failures;
        }
        if (result.error.kind !== "precondition_unmet") {
          failures.push(`expected precondition_unmet, got ${result.error.kind}`);
        }
        const suggests = (result.error.unmetRequirements ?? []).some(
          (r) => r.satisfyWith.tool === "assemble_timeline"
        );
        if (!suggests) failures.push("expected the miss to suggest assemble_timeline");
        return failures;
      },
    },
    {
      name: "persists a critique asset linked to the active timeline",
      instruction: "Critique the active assembled timeline and save the notes for the run.",
      setup: async ({ sandbox }) => {
        await seedTimeline(sandbox);
      },
      expect: {
        tool: "critique_timeline",
        callStatus: "succeeded",
      },
      verify: async ({ sandbox, db }) => {
        const failures: string[] = [];
        const { data: critiques, error: critiqueError } = await db
          .from("assets")
          .select("id, kind, media, role, inputs")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "critique")
          .eq("role", "timeline_critique");
        if (critiqueError) failures.push(`critique query failed: ${critiqueError.message}`);
        if (!critiques || critiques.length === 0) {
          failures.push("missing persisted timeline_critique asset");
          return failures;
        }

        const critique = critiques[0];
        const inputs = (critique.inputs as Array<{ assetId?: string; role?: string }> | null) ?? [];
        const timelineInput = inputs.find((input) => input.role === "timeline");
        if (!timelineInput?.assetId) {
          failures.push("critique inputs do not reference a timeline asset");
        }

        if (timelineInput?.assetId) {
          const { data: edges } = await db
            .from("asset_edges")
            .select("from_id, to_id, role")
            .eq("project_id", sandbox.projectId)
            .eq("from_id", critique.id)
            .eq("to_id", timelineInput.assetId)
            .eq("role", "timeline");
          if (!edges || edges.length === 0) {
            failures.push("expected an asset edge from critique to timeline");
          }
        }

        const { data: selections } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "critique");
        if (!selections || selections[0]?.active_asset_id !== critique.id) {
          failures.push("critique asset is not the active critique selection");
        }

        return failures;
      },
    },
    {
      name: "does not accept caller-supplied timeline ids",
      instruction:
        "Critique the timeline, but pass a timelineId field with the exact value timeline_123.",
      setup: async ({ sandbox }) => {
        await seedTimeline(sandbox);
      },
      expect: {
        tool: "critique_timeline",
        callStatus: ["succeeded", "failed"],
      },
      verify: ({ actualInput, result }) => {
        const failures: string[] = [];
        if (result?.status === "succeeded" && typeof actualInput.timelineId === "string") {
          failures.push("unsupported timelineId field was accepted");
        }
        return failures;
      },
    },
  ],
};
