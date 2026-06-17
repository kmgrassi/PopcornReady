import {
  addAsset,
  addProjectBrief,
  addProjectPlan,
  getActiveProjectBrief,
  getActiveProjectPlan,
  selectProjectAssetSlot,
} from "@/lib/api/v1/store";
import type { ToolBattery } from "../types";

async function seedPlanAndBeatClips(sandbox: { workspaceId: string; projectId: string }) {
  await addProjectBrief({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    brief: {
      goal: "A cafe opens for a warm morning rush.",
      targetLengthSec: 12,
      aspectRatio: "16:9",
      style: "warm documentary",
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
            { id: "beat_1", name: "Open", durationSec: 5, intent: "Maya opens the cafe." },
            {
              id: "beat_2",
              name: "Rush",
              durationSec: 7,
              intent: "Regulars gather at the counter.",
            },
          ],
        },
      ],
    },
  });

  const now = new Date().toISOString();
  for (const beatId of ["beat_1", "beat_2"]) {
    const asset = await addAsset({
      id: "",
      schemaVersion: "asset.v1",
      workspaceId: sandbox.workspaceId,
      projectId: sandbox.projectId,
      kind: "video",
      role: "beat_clip",
      filename: `${beatId}.mp4`,
      status: "ready",
      source: { type: "generated", generatedAssetId: beatId },
      remoteUrl: `https://example.com/${beatId}.mp4`,
      durationSec: 5,
      context: { summary: `Generated clip for ${beatId}` },
      createdAt: now,
      updatedAt: now,
    });
    await selectProjectAssetSlot({
      workspaceId: sandbox.workspaceId,
      projectId: sandbox.projectId,
      assetId: asset.id,
      slotRole: `beat_clip:${beatId}`,
    });
  }
}

export const assembleTimelineBattery: ToolBattery = {
  tool: "assemble_timeline",
  cases: [
    {
      name: "requires a plan before assembling",
      instruction: "Assemble the project's timeline from the generated clips.",
      expect: { tool: "assemble_timeline", callStatus: "failed" },
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
      name: "requires selected beat clips before assembling",
      instruction: "Assemble the project's timeline from the generated clips.",
      setup: async ({ sandbox }) => {
        await seedPlanAndBeatClips(sandbox);
        const active = await getActiveProjectPlan(sandbox.projectId);
        if (!active) return;
        // Add a third beat after clips are selected so the precondition catches
        // an uncovered beat slot and suggests generate_clip.
        await addProjectPlan({
          workspaceId: sandbox.workspaceId,
          projectId: sandbox.projectId,
          plan: {
            ...active.plan,
            scenes: [
              {
                ...active.plan.scenes[0],
                beats: [
                  ...active.plan.scenes[0].beats,
                  { id: "beat_3", name: "Close", durationSec: 3, intent: "The cafe is full." },
                ],
              },
            ],
          },
          briefAssetId: active.assetId,
          briefContentHash: active.contentHash,
        });
      },
      expect: { tool: "assemble_timeline", callStatus: "failed" },
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
          (r) => r.satisfyWith.tool === "generate_clip"
        );
        if (!suggests) failures.push("expected the miss to suggest generate_clip");
        return failures;
      },
    },
    {
      name: "assembles a selected timeline asset with provenance",
      instruction: "Assemble the project's timeline from the generated clips.",
      setup: async ({ sandbox }) => {
        await seedPlanAndBeatClips(sandbox);
      },
      expect: { tool: "assemble_timeline", callStatus: "succeeded" },
      verify: async ({ result, sandbox, db }) => {
        const failures: string[] = [];
        if (result?.status !== "succeeded") {
          failures.push(`expected succeeded, got ${result?.status}`);
          return failures;
        }
        const output = result.output as { timelineAssetId?: string } | undefined;
        const timelineAssetId = output?.timelineAssetId;
        if (!timelineAssetId) {
          failures.push("result did not include timelineAssetId");
          return failures;
        }

        const { data: timeline, error: timelineError } = await db
          .from("assets")
          .select("id, kind, media, role, content, inputs")
          .eq("project_id", sandbox.projectId)
          .eq("id", timelineAssetId)
          .maybeSingle();
        if (timelineError) failures.push(`timeline query failed: ${timelineError.message}`);
        if (!timeline) {
          failures.push("timeline asset was not persisted");
        } else {
          if (timeline.kind !== "composite") failures.push(`expected composite, got ${timeline.kind}`);
          if (timeline.media !== "data") failures.push(`expected data media, got ${timeline.media}`);
          if (timeline.role !== "timeline") failures.push(`expected timeline role, got ${timeline.role}`);
          const content = timeline.content as { segments?: unknown[] } | null;
          if (!Array.isArray(content?.segments) || content.segments.length === 0) {
            failures.push("timeline content has no segments");
          }
        }

        const { data: selection } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "cut")
          .maybeSingle();
        if (selection?.active_asset_id !== timelineAssetId) {
          failures.push("timeline asset is not the active cut selection");
        }

        const inputs = (timeline?.inputs as Array<{ assetId?: string }> | null) ?? [];
        const inputIds = inputs.map((input) => input.assetId).filter(Boolean);
        if (inputIds.length < 3) {
          failures.push("timeline inputs should include the plan and both beat clips");
        }
        const { data: edges } = await db
          .from("asset_edges")
          .select("from_id, to_id")
          .eq("project_id", sandbox.projectId)
          .eq("from_id", timelineAssetId);
        if (!edges || edges.length < inputIds.length) {
          failures.push("missing timeline asset_edges for its graph inputs");
        }

        return failures;
      },
    },
    {
      name: "rejects unsupported input fields",
      instruction: "Assemble the timeline with unsupported field banana set to true.",
      setup: async ({ sandbox }) => {
        await seedPlanAndBeatClips(sandbox);
      },
      expect: { tool: "assemble_timeline", callStatus: ["succeeded", "failed"] },
      verify: ({ actualInput, result }) => {
        const failures: string[] = [];
        if (result?.status === "failed") {
          if (result.error.kind !== "invalid_input") {
            failures.push(`expected invalid_input, got ${result.error.kind}`);
          }
        } else if (actualInput.banana !== undefined) {
          failures.push("unsupported banana field reached a successful tool call");
        }
        return failures;
      },
    },
  ],
};
