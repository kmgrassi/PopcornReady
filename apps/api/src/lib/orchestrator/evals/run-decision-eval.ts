// The decision-eval harness: given a scenario's fabricated state, call the REAL
// orchestrator model and score whether it picks an acceptable next tool. This
// exercises only the routing decision (orchestratorModel.chooseTool) — no engine
// loop, no tool execution, no DB. See docs/scopes/orchestrator-decision-evals.md.

import { createDefaultToolRegistry } from "@/lib/orchestrator-tools/default-registry";
import { toOrchestratorRegistry } from "@/lib/orchestrator-tools/to-orchestrator-registry";
import { orchestratorModel, type OrchestratorModel } from "../model";
import { type ToolRegistry } from "../registry";
import type { OrchestratorModelDecision, ToolName } from "../types";
import type { DecisionScenario, SampleOutcome, ScenarioResult } from "./types";

// Build the SAME registry production uses (engine.ts): the wired tools carry
// their composed schema + precondition/usage guidance (e.g. plan_shots' "requires
// a brief first"), so the model reasons over the real prompt surface rather than
// generic stubs. `includeStubs` fills the rest of the 14-tool vocabulary so
// scenarios can still route through not-yet-wired stages (clip, export, …).
// Restricted to the scenario's available tools; execution is never invoked here.
function registryFor(tools: ToolName[]): ToolRegistry {
  const full = toOrchestratorRegistry(createDefaultToolRegistry(), { includeStubs: true });
  const map: ToolRegistry = new Map();
  for (const tool of tools) {
    const def = full.get(tool);
    if (def) map.set(tool, def);
  }
  return map;
}

function scoreDecision(scenario: DecisionScenario, decision: OrchestratorModelDecision): SampleOutcome {
  if (decision.type === "done") {
    return { decision: "done", ok: scenario.expect.type === "done" };
  }
  const ok =
    scenario.expect.type === "tool_call" && scenario.expect.oneOf.includes(decision.toolName);
  return { decision: "tool_call", toolName: decision.toolName, ok };
}

export interface DecisionEvalOptions {
  /** Defaults to the real orchestratorModel; injectable for offline harness tests. */
  model?: OrchestratorModel;
  /** Sample the decision N times; the scenario passes only if every sample is acceptable. Default 1. */
  samples?: number;
}

export async function runDecisionScenario(
  scenario: DecisionScenario,
  opts: DecisionEvalOptions = {}
): Promise<ScenarioResult> {
  const model = opts.model ?? orchestratorModel;
  const samples = Math.max(1, opts.samples ?? 1);
  const registry = registryFor(scenario.availableTools);

  const outcomes: SampleOutcome[] = [];
  for (let i = 0; i < samples; i += 1) {
    const decision = await model({
      projectId: scenario.id,
      inputSummary: scenario.inputSummary,
      priorResults: scenario.priorResults,
      registry,
    });
    outcomes.push(scoreDecision(scenario, decision));
  }

  return { scenario, samples: outcomes, passed: outcomes.every((o) => o.ok) };
}

export async function runScenarios(
  scenarios: DecisionScenario[],
  opts: DecisionEvalOptions = {}
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runDecisionScenario(scenario, opts));
  }
  return results;
}

// Human-readable summary of what a scenario expected vs. what the model chose.
export function describeOutcome(result: ScenarioResult): string {
  const { scenario, samples } = result;
  const want =
    scenario.expect.type === "done" ? "done" : `one of [${scenario.expect.oneOf.join(", ")}]`;
  const got = samples
    .map((s) => (s.decision === "done" ? "done" : s.toolName ?? "?"))
    .join(", ");
  return `${result.passed ? "PASS" : "FAIL"}  ${scenario.id}  want ${want}  got [${got}]`;
}
