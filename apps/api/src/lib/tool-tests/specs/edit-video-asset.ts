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

function assetIdsFromJob(result: { body: Record<string, unknown> }): string[] {
  const job = result.body.job as { result?: { assetIds?: unknown } };
  return Array.isArray(job.result?.assetIds)
    ? job.result.assetIds.filter((id): id is string => typeof id === "string")
    : [];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function seedUploadedVideo(sandbox: { workspaceId: string; projectId: string }) {
  const result = await createGeneratedAsset({
    auth: localAuth(sandbox.workspaceId),
    projectId: sandbox.projectId,
    body: {
      kind: "video",
      provider: "mock",
      prompt: "uploaded office couch clip",
      description: "Uploaded office clip with a couch.",
      durationSec: 6,
      assetRole: "primary_footage",
      name: "Uploaded office clip",
      slug: "source_office_clip",
    },
  });
  const [assetId] = assetIdsFromJob(result);
  if (!assetId) throw new Error("Failed to seed uploaded office clip.");
  return assetId;
}

async function waitForEditedAsset(
  db: Parameters<NonNullable<ToolBattery["cases"][number]["verify"]>>[0]["db"],
  projectId: string,
  sourceAssetId: string
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data } = await db
      .from("asset_edges")
      .select("from_asset_id, to_asset_id, role")
      .eq("project_id", projectId)
      .eq("to_asset_id", sourceAssetId)
      .eq("role", "edited_from");
    if (data && data.length > 0) return data[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const { data } = await db
    .from("asset_edges")
    .select("from_asset_id, to_asset_id, role")
    .eq("project_id", projectId)
    .eq("to_asset_id", sourceAssetId)
    .eq("role", "edited_from");
  return data?.[0] ?? null;
}

export const editVideoAssetBattery: ToolBattery = {
  tool: "edit_video_asset",
  cases: [
    {
      name: "routes uploaded-footage request changes to video edit",
      instruction:
        "Request Changes target asset source_office_clip. Add a dinosaur sitting on the couch in the uploaded office clip. Use provider mock.",
      setup: async ({ sandbox }) => {
        const sourceAssetId = await seedUploadedVideo(sandbox);
        const { error } = await (
          await import("@/lib/supabase/clients")
        )
          .getServiceSupabase()
          .from("selections")
          .insert({
            project_id: sandbox.projectId,
            slot_owner_lineage_id: null,
            slot_role: "primary_footage",
            active_asset_id: sourceAssetId,
          });
        if (error) throw error;
      },
      expect: {
        tool: "edit_video_asset",
        callStatus: "waiting_for_job",
        input: { provider: "mock" },
      },
      verify: async ({ actualInput, sandbox, db }) => {
        const failures: string[] = [];
        const sourceRef =
          typeof actualInput.sourceAssetId === "string" ? actualInput.sourceAssetId : "";
        if (!sourceRef) {
          failures.push("missing sourceAssetId in model input");
          return failures;
        }
        const sourceQuery = db.from("assets").select("id").eq("project_id", sandbox.projectId);
        const { data: source } = await (isUuid(sourceRef)
          ? sourceQuery.eq("id", sourceRef).maybeSingle()
          : sourceQuery.eq("slug", sourceRef).maybeSingle());
        const sourceAssetId = typeof source?.id === "string" ? source.id : "";
        if (!sourceAssetId) {
          failures.push(`source asset did not resolve: ${sourceRef}`);
          return failures;
        }
        const edge = await waitForEditedAsset(db, sandbox.projectId, sourceAssetId);
        if (!edge) {
          failures.push("missing edited_from edge for uploaded source video");
          return failures;
        }
        const editedAssetId =
          typeof edge.from_asset_id === "string" ? edge.from_asset_id : "";
        if (!editedAssetId) {
          failures.push("edited_from edge did not identify an edited asset");
          return failures;
        }

        const { data: edited } = await db
          .from("assets")
          .select("id, media, kind, role")
          .eq("project_id", sandbox.projectId)
          .eq("id", editedAssetId)
          .maybeSingle();
        if (!edited) {
          failures.push(`edited asset not found: ${editedAssetId}`);
        } else {
          if (edited.media !== "video" || edited.kind !== "clip") {
            failures.push(`edited asset is not a video clip: ${edited.media}/${edited.kind}`);
          }
          if (edited.role !== "primary_footage") {
            failures.push(`edited asset did not keep source role: ${edited.role}`);
          }
        }

        const { data: selection } = await db
          .from("current_selections")
          .select("active_asset_id")
          .eq("project_id", sandbox.projectId)
          .eq("slot_role", "primary_footage")
          .maybeSingle();
        if (selection?.active_asset_id !== editedAssetId) {
          failures.push("primary_footage selection did not swap to edited asset");
        }
        return failures;
      },
    },
  ],
};
