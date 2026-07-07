import type { AuthContext } from "@/lib/api/v1/auth";
import { createGeneratedAsset } from "@/lib/api/v1/generated-assets";
import type { ToolBattery } from "../types";

function localAuth(workspaceId: string): AuthContext {
  return {
    mode: "local",
    actor: { id: "tool_test", type: "local" },
    workspaceId,
    isLocal: true,
  };
}

async function seedSourceVideo(sandbox: {
  workspaceId: string;
  projectId: string;
}): Promise<void> {
  const result = await createGeneratedAsset({
    auth: localAuth(sandbox.workspaceId),
    projectId: sandbox.projectId,
    body: {
      kind: "video",
      provider: "mock",
      prompt: "A static office couch shot.",
      description: "A static office couch shot.",
      durationSec: 4,
      seconds: 4,
      assetRole: "beat_clip",
      beatId: "beat_1",
      slug: "source_clip",
      name: "Source clip",
    },
  });
  const job = result.body.job as { result?: { assetIds?: string[] } };
  const assetId = job.result?.assetIds?.[0];
  if (!assetId) throw new Error("Failed to seed source video for edit_video_asset.");
}

async function waitForEditedAsset(
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
    const edited = (data ?? []).find((asset) => {
      const inputs = (asset.inputs as Array<{ role?: string }> | null) ?? [];
      return inputs.some((input) => input.role === "edited_from");
    });
    if (edited) return edited;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export const editVideoAssetBattery: ToolBattery = {
  tool: "edit_video_asset",
  cases: [
    {
      name: "edits an existing ready video asset with the mock provider",
      instruction:
        "Edit sourceAssetId source_clip. Add a dinosaur sitting on the couch. Use provider mock and beatId beat_1.",
      setup: async ({ sandbox }) => {
        await seedSourceVideo(sandbox);
      },
      expect: {
        tool: "edit_video_asset",
        callStatus: "waiting_for_job",
        input: {
          sourceAssetId: "source_clip",
          instruction: "Add a dinosaur sitting on the couch.",
          provider: "mock",
          beatId: "beat_1",
        },
      },
      verify: async ({ sandbox, db }) => {
        const failures: string[] = [];
        const { data: source } = await db
          .from("assets")
          .select("id")
          .eq("project_id", sandbox.projectId)
          .eq("slug", "source_clip")
          .maybeSingle();
        const sourceAssetId = source?.id;
        if (!sourceAssetId) failures.push("missing seeded source_clip asset");
        const edited = await waitForEditedAsset(db, sandbox.projectId);
        if (!edited) {
          failures.push("missing edited beat_clip asset");
          return failures;
        }

        const inputs = (edited.inputs as Array<{ assetId?: string; role?: string }> | null) ?? [];
        const editInput = inputs.find((input) => input.role === "edited_from");
        if (!editInput) {
          failures.push("edited asset is missing edited_from graph input");
        } else if (editInput.assetId !== sourceAssetId) {
          failures.push("edited_from graph input does not point to the source asset");
        }

        const { data: selection } = await db
          .from("current_selections")
          .select("slot_role, active_asset_id")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "beat_clip:beat_1")
          .maybeSingle();
        if (selection?.active_asset_id !== edited.id) {
          failures.push("beat_clip:beat_1 selection does not point at the edited asset");
        }
        return failures;
      },
    },
  ],
};
