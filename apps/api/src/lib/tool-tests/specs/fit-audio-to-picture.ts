import { randomUUID } from "node:crypto";

import {
  addAsset,
  addProjectBrief,
  addProjectPlan,
  getActiveProjectBrief,
} from "@/lib/api/v1/store";
import type { ToolBattery } from "../types";

async function seedPlanAndAudio(sandbox: { workspaceId: string; projectId: string }) {
  await addProjectBrief({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    brief: {
      goal: "A warm home movie recap.",
      targetLengthSec: 10,
      aspectRatio: "16:9",
      style: "gentle documentary",
    },
  });
  const brief = await getActiveProjectBrief(sandbox.projectId);
  await addProjectPlan({
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    ...(brief ? { briefAssetId: brief.assetId, briefContentHash: brief.contentHash } : {}),
    plan: {
      targetLengthSec: 10,
      style: "gentle documentary",
      aspectRatio: "16:9",
      scenes: [
        {
          id: "scene_1",
          name: "Pool day",
          beats: [
            { id: "beat_1", name: "Splash", durationSec: 5, intent: "A child jumps in." },
            { id: "beat_2", name: "Laugh", durationSec: 5, intent: "The family laughs." },
          ],
        },
      ],
    },
  });

  const now = new Date().toISOString();
  const placeholderId = randomUUID();
  const audio = await addAsset({
    id: placeholderId,
    schemaVersion: "asset.v1",
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    kind: "audio",
    status: "ready",
    role: "voiceover",
    slug: "tool-test-voiceover",
    filename: "tool-test-voiceover.mp3",
    remoteUrl: "https://example.invalid/tool-test-voiceover.mp3",
    durationSec: 5.3,
    source: { type: "generated", generatedAssetId: "tool_test_voiceover" },
    createdAt: now,
    updatedAt: now,
  });
  return audio.id;
}

export const fitAudioToPictureBattery: ToolBattery = {
  tool: "fit_audio_to_picture",
  cases: [
    {
      name: "requires a ready audio asset",
      instruction: "Fit the generated voiceover to beat_1.",
      expect: { tool: "fit_audio_to_picture", callStatus: "failed" },
      verify: ({ result }) => {
        const failures: string[] = [];
        if (result?.status !== "failed") {
          failures.push(`expected a failed result, got ${result?.status}`);
        }
        return failures;
      },
    },
    {
      name: "persists an audio fit critique for a planned beat",
      instruction:
        "Fit audio asset tool-test-voiceover to beat_1 and save the sync report.",
      setup: async ({ sandbox }) => {
        await seedPlanAndAudio(sandbox);
      },
      expect: {
        tool: "fit_audio_to_picture",
        callStatus: "succeeded",
        input: { beatId: "beat_1" },
      },
      verify: async ({ sandbox, db }) => {
        const failures: string[] = [];
        const { data: critiques, error } = await db
          .from("assets")
          .select("id, kind, media, role, inputs")
          .eq("project_id", sandbox.projectId)
          .eq("kind", "critique")
          .eq("role", "audio_fit");
        if (error) failures.push(`audio_fit query failed: ${error.message}`);
        if (!critiques || critiques.length === 0) {
          failures.push("missing persisted audio_fit critique asset");
          return failures;
        }

        const inputs = (critiques[0].inputs as Array<{ role?: string }> | null) ?? [];
        if (!inputs.some((input) => input.role === "audio_track")) {
          failures.push("critique inputs do not reference the audio track");
        }
        const { data: selections } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "audio_fit:beat_1");
        if (!selections || selections[0]?.active_asset_id !== critiques[0].id) {
          failures.push("audio_fit critique is not selected for beat_1");
        }
        return failures;
      },
    },
  ],
};
