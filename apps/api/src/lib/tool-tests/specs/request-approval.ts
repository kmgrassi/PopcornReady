import { resolveGate } from "@/lib/api/v1/orchestrator-store";
import type { ToolBattery } from "../types";

// request_approval is the one tool that intentionally parks the run on a user
// decision. These cases pin the regression that a dynamically-created gate must
// be immediately UI-resolvable (`reached`), not inserted as unreachable `pending`.
export const requestApprovalBattery: ToolBattery = {
  tool: "request_approval",
  cases: [
    {
      name: "parks on a reached gate the approve route can resolve",
      instruction:
        "Request user approval for the generated storyboard before continuing. " +
        "Set step to generate_storyboard and previewArtifactIds to storyboard_asset_1.",
      expect: {
        tool: "request_approval",
        callStatus: "waiting_for_approval",
        input: { step: "generate_storyboard" },
      },
      verify: async ({ actualInput, result, db }) => {
        const failures: string[] = [];
        if (result?.status !== "waiting_for_approval") {
          failures.push(`expected waiting_for_approval, got ${result?.status}`);
          return failures;
        }

        const { data: gateRows, error: gateError } = await db
          .from("orchestrator_run_gates")
          .select("id, orchestrator_run_id, stage, status")
          .eq("id", result.gateId);
        if (gateError) failures.push(`gate query failed: ${gateError.message}`);
        const gate = gateRows?.[0];
        if (!gate) {
          failures.push("no approval gate row was persisted");
          return failures;
        }
        if (gate.stage !== "generate_storyboard") {
          failures.push(`expected gate stage generate_storyboard, got ${gate.stage}`);
        }
        if (gate.status !== "reached") {
          failures.push(`expected gate status reached, got ${gate.status}`);
        }

        const { data: reachable } = await db
          .from("orchestrator_run_gates")
          .select("id")
          .eq("orchestrator_run_id", gate.orchestrator_run_id)
          .eq("status", "reached");
        if (!reachable?.some((candidate) => candidate.id === result.gateId)) {
          failures.push("approve route lookup would not find the parked gate");
        }

        const step = actualInput.step;
        if (step !== "generate_storyboard") {
          failures.push(`expected step generate_storyboard, got ${String(step)}`);
        }

        const resolvedGate = await resolveGate(result.gateId, "approved");
        if (resolvedGate.status !== "approved") {
          failures.push(`approve route helper did not resolve gate, got ${resolvedGate.status}`);
        }
        return failures;
      },
    },
    {
      name: "does not create a gate from invalid preview ids",
      instruction:
        "Request approval for generate_storyboard, but set previewArtifactIds to the string " +
        '"storyboard_asset_1" instead of an array.',
      expect: {
        tool: "request_approval",
        callStatus: ["waiting_for_approval", "failed"],
      },
      verify: async ({ actualInput, result, sandbox, db }) => {
        const failures: string[] = [];
        const ids = actualInput.previewArtifactIds;
        if (result?.status === "waiting_for_approval" && !Array.isArray(ids)) {
          failures.push("non-array previewArtifactIds created an approval gate");
        }

        if (result?.status === "failed") {
          const { data: runs } = await db
            .from("orchestrator_runs")
            .select("id")
            .eq("project_id", sandbox.projectId);
          const runId = runs?.[0]?.id as string | undefined;
          if (runId) {
            const { data: gates } = await db
              .from("orchestrator_run_gates")
              .select("id")
              .eq("orchestrator_run_id", runId);
            if ((gates ?? []).length > 0) {
              failures.push("a gate was persisted despite the tool returning failed");
            }
          }
        }

        return failures;
      },
    },
  ],
};
