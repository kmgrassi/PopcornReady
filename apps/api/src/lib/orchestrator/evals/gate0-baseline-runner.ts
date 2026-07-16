// Composition for the Gate-0 baseline report (scripts/gate0-decision-baseline.ts
// is a thin CLI over this module, keeping the output contract unit-testable).
//
// Gate comparison contract:
// - PAIRED scenarios only: every flat scenario in the matrix is scored on the
//   flat production registry AND, via its deterministic projection
//   (paired-projection.ts), on the fixture hierarchy surface — same ids, same
//   samples, same provider. Unpaired hand-written HIERARCHY_SCENARIOS run as
//   labeled diagnostics and are excluded from the gate comparison.
// - JSON mode writes exactly ONE parseable document to stdout; every
//   human-readable banner goes to stderr.

import { resolveLlmConfig } from "@/lib/llm";
import type { OrchestratorModel } from "../model";
import {
  buildGate0Report,
  describeGate0Report,
  runFlatBaseline,
  tagScenarios,
  type Gate0Report,
  type Gate0Scenario,
} from "./gate0-report";
import { GATE0_FLAT_SCENARIOS } from "./gate0-scenarios";
import {
  createRealFixtureDecisionModel,
  HIERARCHY_SCENARIOS,
  runHierarchyScenarios,
  type FixtureDecisionModel,
  type HierarchyScenario,
} from "./hierarchy-fixture";
import { buildPairedMatrix, type PairedScenario } from "./paired-projection";
import { APPROVAL, FORWARD_CHAIN, RECOVERY } from "./scenarios";

export interface Gate0RunnerOptions {
  samples: number;
  surface: "flat" | "hierarchy" | "both";
  /** Offline plumbing check: scripted decisions, zero model calls. */
  fixture: boolean;
  json: boolean;
}

export interface Gate0RunnerIo {
  /** stdout — in JSON mode receives exactly one document. */
  out(text: string): void;
  /** stderr — banners, progress, and errors. */
  err(text: string): void;
}

/** The single top-level JSON document emitted in --json mode. */
export interface Gate0JsonDocument {
  mode: "real_model" | "offline_fixture";
  comparison: "paired_scenarios";
  samplesPerScenario: number;
  pairedScenarioCount: number;
  flat?: Gate0Report;
  hierarchy?: Gate0Report;
  /** Unpaired hand-written cases; NOT part of the gate comparison. */
  hierarchyDiagnostics?: Gate0Report;
}

export interface Gate0RunnerResult {
  exitCode: number;
  document: Gate0JsonDocument;
}

// The complete flat matrix: the pre-existing forward-chain/recovery/approval
// scenarios plus the six Gate-0 families, all against the production registry.
export function flatMatrix(): Gate0Scenario[] {
  return [
    ...tagScenarios(FORWARD_CHAIN, "forward_chain"),
    ...tagScenarios(RECOVERY, "recovery"),
    ...tagScenarios(APPROVAL, "approval"),
    ...GATE0_FLAT_SCENARIOS,
  ];
}

// Offline plumbing models: scripted to follow each scenario's own expectation.
// They verify wiring and aggregation end to end with ZERO model calls; a
// fixture run is not a baseline measurement.
function fixtureFlatModel(scenarios: Gate0Scenario[]): OrchestratorModel {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  return async ({ projectId }) => {
    const scenario = byId.get(projectId);
    if (!scenario || scenario.expect.type === "done") {
      return { type: "done", summary: "fixture", model: "gate0-fixture" };
    }
    return {
      type: "tool_call",
      toolName: scenario.expect.oneOf[0]!,
      input: {},
      model: "gate0-fixture",
    };
  };
}

function fixtureHierarchyModel(scenarios: HierarchyScenario[]): FixtureDecisionModel {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  return async ({ scenarioId }) => {
    const scenario = byId.get(scenarioId);
    if (!scenario || scenario.expect.type === "done") return { type: "done" };
    return { type: "tool_call", toolName: scenario.expect.oneOf[0]! };
  };
}

function hasFailures(report: Gate0Report): boolean {
  return (
    report.overall.wrongTool > 0 ||
    report.overall.prematureDone > 0 ||
    report.overall.unnecessaryTurns > 0 ||
    report.overall.repeatedFailedCalls > 0
  );
}

export async function runGate0Baseline(
  options: Gate0RunnerOptions,
  io: Gate0RunnerIo
): Promise<Gate0RunnerResult> {
  const pairs: PairedScenario[] = buildPairedMatrix(flatMatrix());
  const flatScenarios = pairs.map((pair) => pair.flat);
  const hierarchyScenarios = pairs.map((pair) => pair.hierarchy);

  const document: Gate0JsonDocument = {
    mode: options.fixture ? "offline_fixture" : "real_model",
    comparison: "paired_scenarios",
    samplesPerScenario: options.samples,
    pairedScenarioCount: pairs.length,
  };

  if (!options.fixture) {
    const provider = resolveLlmConfig().provider;
    const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    if (!process.env[keyName]) {
      io.err(
        `Missing ${keyName}. Real Gate-0 baseline runs are opt-in and billable; ` +
          "put a key in a repo-root .env/.env.local, or use --fixture for an offline plumbing check."
      );
      return { exitCode: 1, document };
    }
    io.err(
      `Gate-0 decision baseline — provider=${provider}, samples=${options.samples}, ` +
        `paired scenarios=${pairs.length} (scored on both surfaces), ` +
        `unpaired hierarchy diagnostics=${HIERARCHY_SCENARIOS.length}`
    );
  } else {
    io.err(
      "Gate-0 OFFLINE plumbing check (--fixture): scripted decisions, no model calls, not a baseline."
    );
  }

  let failed = false;
  const humanSections: string[] = [];

  if (options.surface !== "hierarchy") {
    const report = await runFlatBaseline(flatScenarios, {
      samples: options.samples,
      ...(options.fixture ? { model: fixtureFlatModel(flatScenarios) } : {}),
    });
    document.flat = report;
    humanSections.push(
      `[paired gate comparison — flat side]\n${describeGate0Report(report)}`
    );
    failed = failed || hasFailures(report);
  }

  if (options.surface !== "flat") {
    const pairedScored = await runHierarchyScenarios(hierarchyScenarios, {
      model: options.fixture
        ? fixtureHierarchyModel(hierarchyScenarios)
        : createRealFixtureDecisionModel(),
      samples: options.samples,
    });
    const pairedReport = buildGate0Report("hierarchy_fixture", options.samples, pairedScored);
    document.hierarchy = pairedReport;
    humanSections.push(
      `[paired gate comparison — hierarchy side]\n${describeGate0Report(pairedReport)}`
    );
    failed = failed || hasFailures(pairedReport);

    const diagnosticScored = await runHierarchyScenarios(HIERARCHY_SCENARIOS, {
      model: options.fixture
        ? fixtureHierarchyModel(HIERARCHY_SCENARIOS)
        : createRealFixtureDecisionModel(),
      samples: options.samples,
    });
    const diagnosticsReport = buildGate0Report(
      "hierarchy_fixture",
      options.samples,
      diagnosticScored
    );
    document.hierarchyDiagnostics = diagnosticsReport;
    humanSections.push(
      `[unpaired hierarchy diagnostics — excluded from the gate comparison]\n${describeGate0Report(diagnosticsReport)}`
    );
    failed = failed || hasFailures(diagnosticsReport);
  }

  if (options.json) {
    io.out(JSON.stringify(document, null, 2));
  } else {
    for (const section of humanSections) io.out(`${section}\n`);
  }

  // Baseline runs report; only the offline plumbing check treats any failure
  // as a hard error (the fixture model must reproduce every expectation).
  if (options.fixture && failed) {
    io.err("Fixture plumbing check produced unexpected classifications.");
    return { exitCode: 1, document };
  }
  return { exitCode: 0, document };
}
