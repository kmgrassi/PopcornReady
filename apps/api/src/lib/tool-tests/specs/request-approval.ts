import type { ToolBattery } from "../types";

export const requestApprovalBattery: ToolBattery = {
  tool: "request_approval",
  cases: [
    {
      name: "creates a resolvable reached approval gate",
      instruction:
        "Pause for user approval before export. Ask the user to review the current timeline preview.",
      expect: {
        tool: "request_approval",
        callStatus: "waiting_for_approval",
      },
      verify: async ({ result, db }) => {
        const failures: string[] = [];
        if (result?.status !== "waiting_for_approval") {
          failures.push(`expected waiting_for_approval, got ${result?.status}`);
          return failures;
        }

        const { data: gate, error } = await db
          .from("orchestrator_run_gates")
          .select("id, stage, status")
          .eq("id", result.gateId)
          .maybeSingle();
        if (error) failures.push(`gate query failed: ${error.message}`);
        if (!gate) {
          failures.push("approval gate was not persisted");
        } else {
          if (gate.stage !== "request_approval") {
            failures.push(`gate stage expected request_approval, got ${gate.stage}`);
          }
          if (gate.status !== "reached") {
            failures.push(`gate status expected reached, got ${gate.status}`);
          }
        }
        return failures;
      },
    },
    {
      name: "rejects malformed preview artifact ids before writing a gate",
      instruction:
        "Pause for approval with previewArtifactIds set to the number 42 instead of an array.",
      expect: {
        tool: "request_approval",
        callStatus: ["waiting_for_approval", "failed"],
      },
      verify: ({ actualInput, result }) => {
        const failures: string[] = [];
        const supplied = actualInput.previewArtifactIds;
        if (result?.status === "failed") {
          if (result.error.kind !== "invalid_input") {
            failures.push(`expected invalid_input, got ${result.error.kind}`);
          }
        } else if (supplied !== undefined && !Array.isArray(supplied)) {
          failures.push("non-array previewArtifactIds reached a successful tool call");
        }
        return failures;
      },
    },
  ],
};
