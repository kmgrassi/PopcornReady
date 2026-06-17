import { agentApiStore } from "@/lib/agent-api/jobs";
import { addProjectBrief } from "@/lib/api/v1/store";
import type { ToolBattery } from "../types";

async function pollJob(jobId: string, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const job = await agentApiStore.getJob(jobId);
    if (job && (job.status === "succeeded" || job.status === "failed")) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

export const generatePosterBattery: ToolBattery = {
  tool: "generate_poster",
  cases: [
    {
      name: "requires a brief before generating poster art",
      instruction: "Generate poster key art for this project.",
      expect: { tool: "generate_poster", callStatus: "failed" },
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
          (r) => r.satisfyWith.tool === "create_or_load_brief"
        );
        if (!suggests) failures.push("expected the miss to suggest create_or_load_brief");
        return failures;
      },
    },
    {
      name: "generates and selects project poster art from the brief",
      instruction: "Generate poster key art for this project. Use provider mock.",
      setup: async ({ sandbox }) => {
        await addProjectBrief({
          workspaceId: sandbox.workspaceId,
          projectId: sandbox.projectId,
          brief: {
            goal: "A true beginner explainer about correlation versus causation.",
            targetLengthSec: 60,
            aspectRatio: "9:16",
            style: "clear, friendly, visual",
          },
        });
      },
      expect: {
        tool: "generate_poster",
        callStatus: "waiting_for_job",
        input: { provider: "mock" },
      },
      verify: async ({ result, sandbox, db }) => {
        const failures: string[] = [];
        if (result?.status !== "accepted") {
          failures.push(`expected accepted, got ${result?.status}`);
          return failures;
        }

        const job = await pollJob(result.jobId);
        if (!job) {
          failures.push("poster job never reached a terminal state");
          return failures;
        }
        if (job.status !== "succeeded") {
          failures.push(`job ended ${job.status}: ${JSON.stringify(job.error)}`);
          return failures;
        }
        const assetIds = (job.result as { assetIds?: string[] } | undefined)?.assetIds ?? [];
        if (assetIds.length !== 1) {
          failures.push(`expected one poster asset, got ${assetIds.length}`);
        }

        const { data: posterAssets, error: posterError } = await db
          .from("assets")
          .select("id, kind, media, role")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "poster")
          .eq("media", "image")
          .eq("role", "poster");
        if (posterError) failures.push(`poster query failed: ${posterError.message}`);
        if (!posterAssets || posterAssets.length !== 1) {
          failures.push(`expected one poster asset row, got ${posterAssets?.length ?? 0}`);
        }

        const { data: selections } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "project_poster");
        const selection = selections?.[0];
        if (!selection) {
          failures.push("missing project_poster selection");
        } else if (assetIds[0] && selection.active_asset_id !== assetIds[0]) {
          failures.push("project_poster selection does not point at the generated poster");
        }

        return failures;
      },
    },
  ],
};
