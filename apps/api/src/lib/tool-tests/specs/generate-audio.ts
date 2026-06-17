import { agentApiStore } from "@/lib/agent-api/jobs";
import {
  addProjectBrief,
  addProjectPlan,
  getActiveProjectBrief,
} from "@/lib/api/v1/store";
import type { ToolBattery } from "../types";

async function pollJob(jobId: string, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    const job = await agentApiStore.getJob(jobId);
    if (job && (job.status === "succeeded" || job.status === "failed")) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function seedPlan(sandbox: { workspaceId: string; projectId: string }) {
  await addProjectBrief({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    brief: {
      goal: "A neighborhood cafe opens for a warm morning rush.",
      targetLengthSec: 12,
      aspectRatio: "16:9",
      style: "warm documentary",
      narration: {
        mode: "provided_text",
        script: "The neighborhood wakes up with fresh coffee and familiar faces.",
      },
    },
  });
  const brief = await getActiveProjectBrief(sandbox.projectId);
  await addProjectPlan({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    ...(brief ? { briefAssetId: brief.assetId, briefContentHash: brief.contentHash } : {}),
    plan: {
      targetLengthSec: 12,
      style: "warm documentary",
      aspectRatio: "16:9",
      scenes: [
        {
          id: "scene_1",
          name: "Cafe opening",
          beats: [
            { id: "beat_1", name: "Hook", durationSec: 5, intent: "Maya opens the cafe." },
            { id: "beat_2", name: "Payoff", durationSec: 7, intent: "Regulars gather." },
          ],
        },
      ],
    },
  });
}

export const generateAudioBattery: ToolBattery = {
  tool: "generate_audio",
  cases: [
    {
      name: "requires a plan before generating audio",
      instruction: "Generate the narration and music for this project.",
      expect: { tool: "generate_audio", callStatus: "failed" },
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
          (r) => r.satisfyWith.tool === "plan_shots"
        );
        if (!suggests) failures.push("expected the miss to suggest plan_shots");
        return failures;
      },
    },
    {
      name: "generates voiceover and soundtrack assets from the plan",
      instruction:
        "Generate the narration and soundtrack audio for this plan. Use provider mock.",
      setup: async ({ sandbox }) => {
        await seedPlan(sandbox);
      },
      expect: {
        tool: "generate_audio",
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
          failures.push("audio job never reached a terminal state");
          return failures;
        }
        if (job.status !== "succeeded") {
          failures.push(`job ended ${job.status}: ${JSON.stringify(job.error)}`);
          return failures;
        }
        const assetIds = (job.result as { assetIds?: string[] } | undefined)?.assetIds ?? [];
        if (assetIds.length !== 3) {
          failures.push(`expected 2 voiceovers + 1 soundtrack, got ${assetIds.length}`);
        }

        const { data: audioAssets, error: audioError } = await db
          .from("assets")
          .select("id, kind, media, role, inputs")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "audio_track")
          .eq("media", "audio");
        if (audioError) failures.push(`audio query failed: ${audioError.message}`);

        const roles = new Set((audioAssets ?? []).map((asset) => asset.role));
        if (!roles.has("voiceover")) failures.push("missing generated voiceover assets");
        if (!roles.has("soundtrack")) failures.push("missing generated soundtrack asset");

        const { data: plans } = await db
          .from("assets")
          .select("id")
          .eq("project_id", sandbox.projectId)
          .eq("role", "current_plan");
        const planId = plans?.[0]?.id as string | undefined;
        if (planId) {
          for (const asset of audioAssets ?? []) {
            const inputs = (asset.inputs as Array<{ assetId?: string }> | null) ?? [];
            if (!inputs.some((input) => input.assetId === planId)) {
              failures.push(`${asset.id} inputs do not reference the active plan`);
            }
          }
          const { data: edges } = await db
            .from("asset_edges")
            .select("from_id, to_id")
            .eq("project_id", sandbox.projectId)
            .eq("to_id", planId)
            .in("from_id", assetIds);
          if (!edges || edges.length < assetIds.length) {
            failures.push("expected asset_edges from generated audio to the plan");
          }
        } else {
          failures.push("seed plan not found");
        }

        const { data: selections } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId);
        const slotRoles = new Set((selections ?? []).map((selection) => selection.slot_role));
        if (!slotRoles.has("voiceover:beat_1")) failures.push("missing beat_1 voiceover selection");
        if (!slotRoles.has("voiceover:beat_2")) failures.push("missing beat_2 voiceover selection");
        if (!slotRoles.has("soundtrack:main")) failures.push("missing soundtrack selection");

        return failures;
      },
    },
    {
      name: "does not accept unsupported provider values",
      instruction: "Generate audio, but set provider to exactly banana.",
      setup: async ({ sandbox }) => {
        await seedPlan(sandbox);
      },
      expect: {
        tool: "generate_audio",
        callStatus: ["waiting_for_job", "failed"],
      },
      verify: ({ actualInput, result }) => {
        const failures: string[] = [];
        if (result?.status === "accepted" && actualInput.provider === "banana") {
          failures.push("unsupported provider banana was accepted");
        }
        return failures;
      },
    },
  ],
};
