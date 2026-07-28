import type { ToolBattery } from "../types";

export const generateImageAssetBattery: ToolBattery = {
  tool: "generate_image_asset",
  cases: [
    {
      name: "creates a pooled standalone image without production prerequisites",
      instruction:
        "Create one standalone cinematic image of a moonlit roadside diner. Do not create a story, beat, storyboard, or selection.",
      expect: {
        tool: "generate_image_asset",
        callStatus: "waiting_for_job",
      },
      verify: async ({ result, sandbox, db }) => {
        if (result?.status !== "accepted") return [];
        const { data } = await db
          .from("jobs")
          .select("id, project_id")
          .eq("id", result.jobId)
          .eq("project_id", sandbox.projectId)
          .maybeSingle();
        return data ? [] : ["standalone image job was not persisted"];
      },
    },
  ],
};
