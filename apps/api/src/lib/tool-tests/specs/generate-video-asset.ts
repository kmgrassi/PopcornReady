import type { ToolBattery } from "../types";

export const generateVideoAssetBattery: ToolBattery = {
  tool: "generate_video_asset",
  cases: [
    {
      name: "creates a pooled standalone clip without a fabricated beat",
      instruction:
        "Create one six-second standalone video of a slow dolly through a foggy arcade. Do not fabricate a beat or storyboard.",
      expect: {
        tool: "generate_video_asset",
        callStatus: "waiting_for_job",
        input: { durationSec: 6 },
      },
      verify: async ({ result, sandbox, db }) => {
        if (result?.status !== "accepted") return [];
        const { data } = await db
          .from("jobs")
          .select("id, project_id")
          .eq("id", result.jobId)
          .eq("project_id", sandbox.projectId)
          .maybeSingle();
        return data ? [] : ["standalone video job was not persisted"];
      },
    },
  ],
};
