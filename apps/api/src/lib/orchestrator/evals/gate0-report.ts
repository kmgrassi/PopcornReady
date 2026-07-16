// Gate-0 baseline report for the specialist-agent adoption decision
// (docs/scopes/specialist-agent-orchestration-prs.md, PR 1 / Decision Gate 0).
//
// Classifies every sampled decision into the Gate-0 failure taxonomy and
// aggregates per-family + overall baselines so repeated real-model runs of the
// flat production registry and the fixture-only hierarchy simulation produce
// directly comparable numbers. Pure scoring — no model calls, no execution.

import type { ToolName } from "../types";
import { runScenarios, type DecisionEvalOptions } from "./run-decision-eval";
import type { DecisionScenario, PriorResult, SampleOutcome } from "./types";

// The Gate-0 scenario families from Decision Gate 0. `forward_chain` and
// `approval` tag the pre-existing scenarios so one report covers everything.
export type Gate0Family =
  | "forward_chain"
  | "approval"
  | "long_context"
  | "tool_overload"
  | "cross_modality"
  | "selective_regeneration"
  | "premature_done"
  | "recovery";

export const GATE0_FAMILIES: readonly Gate0Family[] = [
  "forward_chain",
  "approval",
  "long_context",
  "tool_overload",
  "cross_modality",
  "selective_regeneration",
  "premature_done",
  "recovery",
];

/** A decision scenario tagged with the Gate-0 family it measures. */
export interface Gate0Scenario extends DecisionScenario {
  family: Gate0Family;
}

// How one sampled decision counts against the Gate-0 baseline dimensions:
// - acceptable            → counts toward accuracy
// - premature_done        → said "done" while work clearly remained
// - unnecessary_turn      → called a tool after the run was complete
// - repeated_failed_call  → re-chose the tool that just failed instead of
//                           satisfying its surfaced precondition
// - wrong_tool            → any other misroute
export type SampleClassification =
  | "acceptable"
  | "wrong_tool"
  | "premature_done"
  | "unnecessary_turn"
  | "repeated_failed_call";

export interface ClassifiableExpectation {
  type: "tool_call" | "done";
  oneOf?: readonly string[];
}

export interface ClassifiableDecision {
  decision: "tool_call" | "done";
  toolName?: string;
}

/**
 * The tool whose failure the model is being asked to recover from: the latest
 * prior result iff it failed. Re-choosing it counts as a repeated failed call.
 */
export function lastFailedTool(
  priorResults: ReadonlyArray<Pick<PriorResult, "tool" | "status"> | { tool: string; status: string }>
): string | undefined {
  const latest = priorResults.at(-1);
  return latest?.status === "failed" ? latest.tool : undefined;
}

export function classifyDecision(input: {
  expect: ClassifiableExpectation;
  sample: ClassifiableDecision;
  lastFailedTool?: string;
}): SampleClassification {
  const { expect, sample } = input;
  if (expect.type === "done") {
    return sample.decision === "done" ? "acceptable" : "unnecessary_turn";
  }
  if (sample.decision === "done") return "premature_done";
  if (sample.toolName && expect.oneOf?.includes(sample.toolName)) return "acceptable";
  if (input.lastFailedTool && sample.toolName === input.lastFailedTool) {
    return "repeated_failed_call";
  }
  return "wrong_tool";
}

/** Per-scenario classifications, the surface-neutral input to the report. */
export interface ScoredScenario {
  scenarioId: string;
  family: Gate0Family;
  classifications: SampleClassification[];
  /** Raw decisions, kept so failures stay inspectable in the report. */
  sampledDecisions: ClassifiableDecision[];
}

export interface Gate0FamilyBaseline {
  family: Gate0Family | "overall";
  scenarios: number;
  samples: number;
  acceptable: number;
  /** acceptable / samples — the Gate-0 accuracy baseline. */
  accuracy: number;
  wrongTool: number;
  prematureDone: number;
  unnecessaryTurns: number;
  repeatedFailedCalls: number;
}

export interface Gate0FailureRecord {
  scenarioId: string;
  family: Gate0Family;
  classification: Exclude<SampleClassification, "acceptable">;
  got: string;
}

export type Gate0Surface = "flat_production" | "hierarchy_fixture";

export interface Gate0Report {
  surface: Gate0Surface;
  samplesPerScenario: number;
  families: Gate0FamilyBaseline[];
  overall: Gate0FamilyBaseline;
  failures: Gate0FailureRecord[];
}

function emptyBaseline(family: Gate0FamilyBaseline["family"]): Gate0FamilyBaseline {
  return {
    family,
    scenarios: 0,
    samples: 0,
    acceptable: 0,
    accuracy: 0,
    wrongTool: 0,
    prematureDone: 0,
    unnecessaryTurns: 0,
    repeatedFailedCalls: 0,
  };
}

function addSample(baseline: Gate0FamilyBaseline, classification: SampleClassification): void {
  baseline.samples += 1;
  switch (classification) {
    case "acceptable":
      baseline.acceptable += 1;
      break;
    case "wrong_tool":
      baseline.wrongTool += 1;
      break;
    case "premature_done":
      baseline.prematureDone += 1;
      break;
    case "unnecessary_turn":
      baseline.unnecessaryTurns += 1;
      break;
    case "repeated_failed_call":
      baseline.repeatedFailedCalls += 1;
      break;
  }
}

function finalize(baseline: Gate0FamilyBaseline): Gate0FamilyBaseline {
  baseline.accuracy = baseline.samples === 0 ? 0 : baseline.acceptable / baseline.samples;
  return baseline;
}

/** Pure aggregation: scored scenarios in, per-family + overall baselines out. */
export function buildGate0Report(
  surface: Gate0Surface,
  samplesPerScenario: number,
  scored: ScoredScenario[]
): Gate0Report {
  const byFamily = new Map<Gate0Family, Gate0FamilyBaseline>();
  const overall = emptyBaseline("overall");
  const failures: Gate0FailureRecord[] = [];

  for (const entry of scored) {
    const baseline = byFamily.get(entry.family) ?? emptyBaseline(entry.family);
    baseline.scenarios += 1;
    entry.classifications.forEach((classification, index) => {
      addSample(baseline, classification);
      addSample(overall, classification);
      if (classification !== "acceptable") {
        const sample = entry.sampledDecisions[index];
        failures.push({
          scenarioId: entry.scenarioId,
          family: entry.family,
          classification,
          got: sample?.decision === "done" ? "done" : sample?.toolName ?? "?",
        });
      }
    });
    byFamily.set(entry.family, baseline);
  }
  overall.scenarios = scored.length;

  return {
    surface,
    samplesPerScenario,
    families: [...byFamily.values()].map(finalize),
    overall: finalize(overall),
    failures,
  };
}

/** Score already-sampled outcomes from the existing decision-eval runner. */
export function scoreScenarioSamples(
  scenario: Gate0Scenario,
  samples: SampleOutcome[]
): ScoredScenario {
  const failedTool = lastFailedTool(scenario.priorResults);
  return {
    scenarioId: scenario.id,
    family: scenario.family,
    classifications: samples.map((sample) =>
      classifyDecision({ expect: scenario.expect, sample, lastFailedTool: failedTool })
    ),
    sampledDecisions: samples.map((sample) => ({
      decision: sample.decision,
      ...(sample.toolName ? { toolName: sample.toolName } : {}),
    })),
  };
}

/**
 * Run Gate-0 scenarios against the FLAT PRODUCTION registry surface (the same
 * bridged registry + orchestrator model the engine uses) and aggregate the
 * baseline. Real-model usage is opt-in exactly like the existing harness: the
 * default model performs billable LLM calls, so tests must inject a fixture
 * model via `opts.model`.
 */
export async function runFlatBaseline(
  scenarios: Gate0Scenario[],
  opts: DecisionEvalOptions = {}
): Promise<Gate0Report> {
  const results = await runScenarios(scenarios, opts);
  const scored = results.map((result, index) =>
    scoreScenarioSamples(scenarios[index]!, result.samples)
  );
  return buildGate0Report("flat_production", Math.max(1, opts.samples ?? 1), scored);
}

/** Tag pre-existing untagged scenarios so one report covers the whole matrix. */
export function tagScenarios(
  scenarios: DecisionScenario[],
  family: Gate0Family
): Gate0Scenario[] {
  return scenarios.map((scenario) => ({ ...scenario, family }));
}

export function describeGate0Report(report: Gate0Report): string {
  const lines: string[] = [
    `Gate-0 decision baseline — surface=${report.surface}, samples/scenario=${report.samplesPerScenario}`,
  ];
  const row = (b: Gate0FamilyBaseline) =>
    `  ${String(b.family).padEnd(24)} accuracy ${(b.accuracy * 100).toFixed(1).padStart(5)}%` +
    ` (${b.acceptable}/${b.samples})  wrong=${b.wrongTool} prematureDone=${b.prematureDone}` +
    ` unnecessaryTurn=${b.unnecessaryTurns} repeatedFailedCall=${b.repeatedFailedCalls}`;
  for (const family of report.families) lines.push(row(family));
  lines.push(row(report.overall));
  for (const failure of report.failures) {
    lines.push(
      `  FAIL ${failure.scenarioId} [${failure.family}] ${failure.classification} got=${failure.got}`
    );
  }
  return lines.join("\n");
}

// Re-exported for scenario authors: recovery scenarios must reference real tool
// names so repeated-failed-call detection stays observable.
export type { ToolName };
