import type { ToolName } from "../types";

// A prior tool result exactly as the orchestrator model sees it each turn —
// mirrors engine.ts `toPriorResult` (IDs + status, plus error guidance on
// failures). Scenarios fabricate these to represent "state so far."
export interface PriorResult {
  tool: ToolName;
  status: "applied" | "failed" | "running";
  outputAssetIds: string[];
  error?: {
    kind: string;
    message: string;
    recoverable: boolean;
    unmetRequirements?: Array<{
      requirement: string;
      because: string;
      satisfyWith: { tool: ToolName; inputHint: Record<string, unknown> };
    }>;
    suggestedNextTools?: Array<{ tool: ToolName; inputHint: Record<string, unknown> }>;
  };
}

// What the orchestrator should decide given the scenario. `oneOf` is an
// acceptable set (not a single golden) so the eval catches gross misroutes
// without being brittle to the model's legitimate latitude.
export type DecisionExpectation =
  | { type: "tool_call"; oneOf: ToolName[] }
  | { type: "done" };

export interface DecisionScenario {
  id: string;
  description: string;
  inputSummary: string;
  priorResults: PriorResult[];
  availableTools: ToolName[];
  expect: DecisionExpectation;
}

export interface SampleOutcome {
  decision: "tool_call" | "done";
  toolName?: string;
  ok: boolean;
}

export interface ScenarioResult {
  scenario: DecisionScenario;
  samples: SampleOutcome[];
  passed: boolean; // every sample landed in the acceptable set
}
