import type { AuthContext } from "@/lib/api/v1/auth";
import { createGeneratedAsset } from "@/lib/api/v1/generated-assets";
import {
  addProjectBrief,
  addProjectPlan,
  getActiveProjectBrief,
  selectGeneratedBeatKeyframeAsset,
} from "@/lib/api/v1/store";
import type { ToolBattery } from "../types";

const PLAN = {
  targetLengthSec: 12,
  style: "warm documentary",
  aspectRatio: "16:9" as const,
  scenes: [
    {
      id: "scene_1",
      name: "Cafe opening",
      setting: "sunny neighborhood cafe",
      mood: "welcoming",
      characterIds: ["barista_maya"],
      beats: [
        { id: "beat_1", name: "Hook", durationSec: 5, intent: "Maya unlocks the cafe." },
        { id: "beat_2", name: "Payoff", durationSec: 7, intent: "Regulars enter." },
      ],
    },
  ],
};

function localAuth(workspaceId: string): AuthContext {
  return {
    mode: "local",
    actor: { id: "tool_test", type: "local" },
    workspaceId,
    isLocal: true,
  };
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
    },
  });
  const brief = await getActiveProjectBrief(sandbox.projectId);
  await addProjectPlan({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    ...(brief ? { briefAssetId: brief.assetId, briefContentHash: brief.contentHash } : {}),
    plan: PLAN,
  });
}

async function seedKeyframes(sandbox: { workspaceId: string; projectId: string }) {
  await seedPlan(sandbox);
  const auth = localAuth(sandbox.workspaceId);
  for (const beat of PLAN.scenes.flatMap((scene) => scene.beats)) {
    const result = await createGeneratedAsset({
      auth,
      projectId: sandbox.projectId,
      body: {
        kind: "image",
        provider: "mock",
        prompt: beat.intent,
        description: beat.intent,
        assetRole: "beat_keyframe",
        beatId: beat.id,
      },
    });
    const job = result.body.job as { result?: { assetIds?: string[] } };
    const assetId = job.result?.assetIds?.[0];
    if (!assetId) throw new Error(`Failed to seed keyframe for ${beat.id}`);
    await selectGeneratedBeatKeyframeAsset({
      workspaceId: sandbox.workspaceId,
      projectId: sandbox.projectId,
      assetId,
      beatId: beat.id,
    });
  }
}

async function waitForClipAssets(
  db: Parameters<NonNullable<ToolBattery["cases"][number]["verify"]>>[0]["db"],
  projectId: string
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data } = await db
      .from("assets")
      .select("id, kind, media, role, inputs")
      .eq("project_id", projectId)
      .eq("kind", "clip")
      .eq("role", "beat_clip");
    if ((data?.length ?? 0) >= 2) return data ?? [];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const { data } = await db
    .from("assets")
    .select("id, kind, media, role, inputs")
    .eq("project_id", projectId)
    .eq("kind", "clip")
    .eq("role", "beat_clip");
  return data ?? [];
}

export const generateClipBattery: ToolBattery = {
  tool: "generate_clip",
  cases: [
    {
      name: "requires beat keyframes before generating clips",
      instruction: "Generate motion clips for this project's planned beats.",
      setup: async ({ sandbox }) => {
        await seedPlan(sandbox);
      },
      expect: { tool: "generate_clip", callStatus: "failed" },
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
          (r) => r.satisfyWith.tool === "generate_keyframe"
        );
        if (!suggests) failures.push("expected the miss to suggest generate_keyframe");
        return failures;
      },
    },
    {
      name: "generates pooled beat clips from active keyframes",
      instruction:
        "Generate motion clips for every planned beat. Use provider mock.",
      setup: async ({ sandbox }) => {
        await seedKeyframes(sandbox);
      },
      expect: {
        tool: "generate_clip",
        callStatus: "waiting_for_job",
        input: { provider: "mock" },
      },
      verify: async ({ sandbox, db }) => {
        const failures: string[] = [];
        const clips = await waitForClipAssets(db, sandbox.projectId);
        if (clips.length < 2) failures.push(`expected 2 generated beat clips, got ${clips.length}`);
        for (const clip of clips) {
          const inputs = (clip.inputs as Array<{ role?: string }> | null) ?? [];
          if (!inputs.some((input) => input.role === "beat_keyframe")) {
            failures.push(`${clip.id} inputs do not reference a beat_keyframe`);
          }
        }

        const { data: selections } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId);
        const slotRoles = new Set((selections ?? []).map((selection) => selection.slot_role));
        if (!slotRoles.has("beat_clip:beat_1")) {
          failures.push("missing active beat_clip selection for beat_1");
        }
        if (!slotRoles.has("beat_clip:beat_2")) {
          failures.push("missing active beat_clip selection for beat_2");
        }
        return failures;
      },
    },
    {
      name: "does not accept unsupported provider values",
      instruction: "Generate the beat clips, but set provider to exactly banana.",
      setup: async ({ sandbox }) => {
        await seedKeyframes(sandbox);
      },
      expect: {
        tool: "generate_clip",
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
