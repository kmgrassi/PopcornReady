import { getStore } from "@/lib/v1/store";
import { SCHEMA, type VersionedTimeline } from "@popcorn/shared/v1/types";
import type { ToolBattery } from "../types";

async function seedTimeline(sandbox: { projectId: string }) {
  const now = new Date().toISOString();
  const timeline: VersionedTimeline = {
    id: "",
    schemaVersion: SCHEMA.timeline,
    projectId: sandbox.projectId,
    briefVersionId: "tool_test_brief",
    aspectRatio: "16:9",
    fps: 30,
    segments: [
      {
        id: "seg_1",
        clipId: "clip_tool_test",
        sourceInSec: 0,
        sourceOutSec: 4,
        role: "Hook",
        beatId: "beat_1",
        reason: "Seeded timeline segment for export tool verification.",
      },
    ],
    provenance: {
      briefVersionId: "tool_test_brief",
      sourceAssetIds: ["clip_tool_test"],
      generatedAssetJobIds: [],
      criticReport: null,
      appliedPatchCount: 0,
    },
    createdBy: { jobId: "tool_test_assemble" },
    createdAt: now,
  };
  await getStore().saveTimeline(timeline);
}

export const exportVideoBattery: ToolBattery = {
  tool: "export_video",
  cases: [
    {
      name: "requires an assembled timeline before exporting",
      instruction: "Export the final video for this project.",
      expect: { tool: "export_video", callStatus: "failed" },
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
      name: "exports the active timeline into an output asset",
      instruction:
        "Export the assembled timeline as an mp4 final video. Use timeline_only duration.",
      setup: async ({ sandbox }) => {
        await seedTimeline(sandbox);
      },
      expect: {
        tool: "export_video",
        callStatus: "waiting_for_job",
        input: { format: "mp4", durationPolicy: "timeline_only" },
      },
      verify: async ({ sandbox, db }) => {
        const failures: string[] = [];

        const { data: assets, error: assetError } = await db
          .from("assets")
          .select("id, kind, media, role, status")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "render")
          .eq("role", "export_video");
        if (assetError) failures.push(`asset query failed: ${assetError.message}`);
        if (!assets || assets.length === 0) {
          failures.push("missing export_video render asset");
        } else {
          const asset = assets[0];
          if (asset.media !== "video") failures.push(`expected video media, got ${asset.media}`);
          if (asset.status !== "pending" && asset.status !== "ready") {
            failures.push(`expected pending or ready status, got ${asset.status}`);
          }
        }

        const assetId = assets?.[0]?.id as string | undefined;
        const { data: selections, error: selectionError } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "export_video");
        if (selectionError) {
          failures.push(`selection query failed: ${selectionError.message}`);
        }
        if (!selections || selections.length === 0) {
          failures.push("missing active export_video selection");
        } else if (assetId && selections[0].active_asset_id !== assetId) {
          failures.push("active export_video selection does not point at the export asset");
        }

        const { data: actions, error: actionError } = await db
          .from("actions")
          .select("tool, status, params, job_ids, output_asset_ids")
          .eq("project_id", sandbox.projectId)
          .eq("tool", "export_video");
        if (actionError) failures.push(`action query failed: ${actionError.message}`);
        if (!actions || actions.length === 0) {
          failures.push("missing export_video action");
        } else if (actions[0].status !== "applied") {
          failures.push(`expected applied action, got ${actions[0].status}`);
        } else {
          const jobIds = (actions[0].job_ids as string[] | null) ?? [];
          if (jobIds.length !== 0) {
            failures.push("export_video action stored non-UUID agent job ids in job_ids");
          }
          const params = actions[0].params as { agentJobId?: unknown } | null;
          if (typeof params?.agentJobId !== "string") {
            failures.push("export_video action params did not retain the agent job id");
          }
        }

        return failures;
      },
    },
    {
      name: "does not accept unsupported duration policies",
      instruction:
        "Export the video, but set durationPolicy to exactly stretch_forever.",
      setup: async ({ sandbox }) => {
        await seedTimeline(sandbox);
      },
      expect: {
        tool: "export_video",
        callStatus: ["waiting_for_job", "failed"],
      },
      verify: ({ actualInput, result }) => {
        const failures: string[] = [];
        if (result?.status === "accepted" && actualInput.durationPolicy === "stretch_forever") {
          failures.push("unsupported durationPolicy stretch_forever was accepted");
        }
        return failures;
      },
    },
  ],
};
